// 拦截层主入口——对齐 ARTEX guard.applyIntercept + intercept.Match/Judge。
//
// 判定链（每次工具调用）：
//   ① 工具白名单 → 不在白名单直接放行（不进拦截系统）
//   ② 规则匹配（priority DESC）→ 命中即返回
//   ③ LLM judge（未命中且启用）→ 严格解析 → 失败走 failAction
//
// 核心保证：判定输入**只有 toolName + toolInput**，不含任何意图/目标/态势。

import { effectiveJudgePrompt, DEFAULT_JUDGE_PROMPT } from "./judge-prompt.js";
import { parseVerdict } from "./judge-verdict.js";
import { DEFAULT_ENABLED_TOOLS, DEFAULT_INTERCEPT_RULES } from "./rules.js";
import type {
  InterceptDecision,
  InterceptLogger,
  InterceptRule,
  JudgeConfig,
  JudgeReviewInput,
  JudgeRunner,
} from "./types.js";

/** judge 缺省配置——对齐 ARTEX intercept.go:330-335。 */
const DEFAULT_JUDGE_CONFIG: JudgeConfig = {
  enabled: false,
  profileId: 0,
  prompt: DEFAULT_JUDGE_PROMPT,
  timeoutSeconds: 15,
  failAction: "allow",
  askTimeoutSeconds: 300,
  askTimeoutAction: "deny",
};

/** 预编译规则：regex 一次编译，避免每次调用重编。 */
interface CompiledRule {
  rule: InterceptRule;
  regex?: RegExp;
}

export class Interceptor {
  private readonly compiledRules: CompiledRule[];
  private readonly enabledTools: ReadonlySet<string>;
  private readonly judgeConfig: JudgeConfig;
  private readonly judgeRunner?: JudgeRunner;
  private readonly logger?: InterceptLogger;

  constructor(options: {
    rules?: readonly InterceptRule[];
    enabledTools?: readonly string[];
    judgeConfig?: Partial<JudgeConfig>;
    judgeRunner?: JudgeRunner;
    logger?: InterceptLogger;
  }) {
    const rules = options.rules ?? DEFAULT_INTERCEPT_RULES;
    // priority DESC 排序；同优先级按 id ASC（稳定）。
    const sorted = [...rules]
      .filter((rule) => rule.enabled)
      .sort((left, right) => right.priority - left.priority || left.id - right.id);
    this.compiledRules = sorted.map((rule) => {
      if (rule.matchType === "regex") {
        try {
          return { rule, regex: new RegExp(rule.pattern, "i") };
        } catch {
          // 坏正则跳过该规则（对齐 ARTEX loadLocked 的做法）。
          return { rule };
        }
      }
      return { rule };
    });
    this.enabledTools = new Set(options.enabledTools ?? DEFAULT_ENABLED_TOOLS);
    this.judgeConfig = { ...DEFAULT_JUDGE_CONFIG, ...options.judgeConfig };
    if (options.judgeRunner !== undefined) {
      this.judgeRunner = options.judgeRunner;
    }
    if (options.logger !== undefined) {
      this.logger = options.logger;
    }
  }

  /**
   * 判定一次工具调用。返回 undefined 表示「不拦截」（放行）。
   *
   * 对齐 ARTEX guard.applyIntercept：白名单外 / 规则未命中且 judge 未启用 → 放行。
   */
  async evaluate(input: {
    toolName: string;
    toolInput: unknown;
    workingDirectory?: string;
    signal?: AbortSignal;
  }): Promise<InterceptDecision | undefined> {
    // ① 工具白名单
    if (!this.enabledTools.has(input.toolName)) {
      return undefined;
    }

    // ② 规则匹配
    const matched = this.match(input.toolName, input.toolInput);
    if (matched) {
      return matched;
    }

    // ③ LLM judge
    return await this.judge(input);
  }

  /** 规则匹配。返回命中决策，或 undefined。 */
  private match(toolName: string, toolInput: unknown): InterceptDecision | undefined {
    const inputText = stringifyToolInput(toolInput);
    for (const compiled of this.compiledRules) {
      const { rule, regex } = compiled;
      const subject = rule.matchTarget === "tool_name" ? toolName : inputText;
      const hit =
        rule.matchType === "regex"
          ? regex !== undefined && regex.test(subject)
          : subject.includes(rule.pattern);
      if (!hit) continue;
      return {
        action: rule.action,
        message: rule.message,
        ruleName: rule.name,
        ...(rule.action === "ask"
          ? {
              timeoutEnabled: rule.timeoutEnabled,
              timeoutSeconds: rule.timeoutSeconds,
              timeoutAction: rule.timeoutAction,
            }
          : {}),
      };
    }
    return undefined;
  }

  /**
   * LLM judge。未启用 / 未接线 → undefined（默认放行）。
   * 调用失败 / 解析失败 → failAction（默认 allow）。
   */
  private async judge(input: {
    toolName: string;
    toolInput: unknown;
    workingDirectory?: string;
    signal?: AbortSignal;
  }): Promise<InterceptDecision | undefined> {
    if (!this.judgeConfig.enabled || this.judgeRunner === undefined) {
      return undefined;
    }

    const reviewInput: JudgeReviewInput = {
      version: 4,
      ...(input.workingDirectory === undefined
        ? {}
        : { workingDirectory: input.workingDirectory }),
      toolName: input.toolName,
      arguments: stringifyToolInput(input.toolInput),
    };
    const systemPrompt = effectiveJudgePrompt(this.judgeConfig.prompt);

    let text: string;
    try {
      text = await this.runJudgeWithTimeout(systemPrompt, reviewInput, input.signal);
    } catch (error) {
      // 模型调用失败 → failAction（默认 allow）。对齐 ARTEX intercept.go:474-476。
      this.logger?.warn?.("Intercept judge model call failed", {
        event: "intercept.judge.model_failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        failAction: this.judgeConfig.failAction,
        toolName: input.toolName,
      });
      return this.failActionDecision();
    }

    const verdict = parseVerdict(text);
    if (verdict.action === "") {
      // 解析失败 → failAction。对齐 ARTEX intercept.go:477-482。
      this.logger?.warn?.("Intercept judge verdict unparsable", {
        event: "intercept.judge.unparsable",
        failAction: this.judgeConfig.failAction,
        replyPreview: text.slice(0, 200),
        toolName: input.toolName,
      });
      return this.failActionDecision();
    }

    const decision: InterceptDecision = {
      action: verdict.action,
      message: verdict.reason || `[模型] ${judgeActionLabel(verdict.action)}`,
      modelFallback: true,
    };
    if (verdict.action === "ask") {
      decision.timeoutEnabled = true;
      decision.timeoutSeconds = this.judgeConfig.askTimeoutSeconds;
      decision.timeoutAction = this.judgeConfig.askTimeoutAction;
    }
    return decision;
  }

  /**
   * judge 失败时的决策。**failAction === "allow" 时返回 undefined**（而非
   * {action: "allow"}）——因为 evaluate 的契约是「undefined = 不拦截」，
   * 调用方据此放行。返回一个 allow 决策会让上层误以为有显式判定。
   */
  private failActionDecision(): InterceptDecision | undefined {
    if (this.judgeConfig.failAction === "allow") {
      return undefined;
    }
    return {
      action: this.judgeConfig.failAction,
      message: "[模型] 判定不可用，按失败策略处理",
      modelFallback: true,
    };
  }

  private async runJudgeWithTimeout(
    systemPrompt: string,
    input: JudgeReviewInput,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    const runner = this.judgeRunner;
    if (runner === undefined) {
      throw new Error("judge runner 未接线");
    }
    const timeoutMs = this.judgeConfig.timeoutSeconds * 1000;
    if (timeoutMs <= 0) {
      return await runner(systemPrompt, input, signal);
    }
    const controller = new AbortController();
    const onAbort = (): void => controller.abort(signal?.reason);
    if (signal !== undefined) {
      if (signal.aborted) {
        controller.abort(signal.reason);
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }
    const timer = setTimeout(() => controller.abort(new Error("judge timeout")), timeoutMs);
    try {
      return await runner(systemPrompt, input, controller.signal);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
}

function judgeActionLabel(action: "allow" | "ask" | "deny"): string {
  switch (action) {
    case "allow":
      return "允许";
    case "deny":
      return "阻断";
    case "ask":
      return "请求确认";
  }
}

/** 把任意工具输入序列化成字符串（规则匹配与 judge 输入共用）。 */
function stringifyToolInput(toolInput: unknown): string {
  if (typeof toolInput === "string") return toolInput;
  try {
    return JSON.stringify(toolInput ?? null);
  } catch {
    return String(toolInput);
  }
}
