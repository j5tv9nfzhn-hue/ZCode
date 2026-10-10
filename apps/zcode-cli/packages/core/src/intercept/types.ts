// 工具调用拦截层（intercept）——对齐 ARTEX 的 guard + intercept 机制。
//
// 设计要点（与 ARTEX 一一对应）：
//   · 每次工具调用过一遍判定（ZCode 侧挂在 PreToolUse hook 链最前）；
//   · 判定输入只有 toolName + toolInput，**不含任何用户意图 / 任务目标 / 编排态势**；
//   · 规则匹配（priority DESC）优先，未命中才走 LLM judge；
//   · 默认放行（fail-open）：judge 未启用 / 调用失败 / 输出解析失败 → allow；
//   · 拦截时明确框定「平台管控·非目标防御」，防止 agent 误认为目标防御而去绕。
//
// 这套机制让"提权进服务器""不限额调用 API"这类直白要求不再触发模型对齐——
// 因为「提权」这个词从不进入判定输入；判定只看具体操作的直接技术效果。

/**
 * 一次判定结果。对齐 ARTEX intercept.go 的 Decision（裁剪掉审计字段）。
 */
export interface InterceptDecision {
  action: "allow" | "ask" | "deny";
  /** 面向模型的原因文本（deny/ask 时用）。 */
  message: string;
  /** 命中的规则名（规则匹配时）。model fallback 时为空。 */
  ruleName?: string;
  /** 是否由 LLM judge 产出（而非规则命中）。 */
  modelFallback?: boolean;
  /** ask 的人工审批超时配置。 */
  timeoutEnabled?: boolean;
  timeoutSeconds?: number;
  timeoutAction?: "allow" | "deny";
}

/**
 * 一条拦截规则。对齐 ARTEX db.InterceptRule。
 */
export interface InterceptRule {
  id: number;
  name: string;
  enabled: boolean;
  /** 匹配顺序：priority DESC。 */
  priority: number;
  /** 匹配对象：工具名 或 工具参数原文。 */
  matchTarget: "tool_name" | "tool_input";
  matchType: "string" | "regex";
  pattern: string;
  action: "allow" | "ask" | "deny";
  message: string;
  timeoutEnabled: boolean;
  timeoutSeconds: number;
  timeoutAction: "allow" | "deny";
}

/**
 * LLM judge 配置。对齐 ARTEX intercept.go 的 JudgeConfig。
 */
export interface JudgeConfig {
  enabled: boolean;
  /** 0 = 跟随会话当前模型。 */
  profileId: number;
  /** 策略本体（用户可覆盖）。缺省用 DEFAULT_JUDGE_PROMPT。 */
  prompt: string;
  /** judge 单次调用超时（秒）。缺省 15。 */
  timeoutSeconds: number;
  /**
   * 模型调用失败 / 输出解析失败时的动作。**缺省 allow**（对齐 ARTEX）。
   * 这是 fail-open 的核心：判定不了就不拦。
   */
  failAction: "allow" | "ask" | "deny";
  /** ask 的人工审批超时（秒）。缺省 300。 */
  askTimeoutSeconds: number;
  /** ask 超时后的动作。缺省 deny。 */
  askTimeoutAction: "allow" | "deny";
}

/** judge 的输入（对齐 ARTEX ReviewInput）——只含当前调用，不含任何历史/意图。 */
export interface JudgeReviewInput {
  version: number;
  workingDirectory?: string;
  toolName: string;
  /** 工具参数原文（JSON 字符串）。 */
  arguments: string;
}

/** judge 的原始输出（解析前的文本）。 */
export interface JudgeVerdict {
  action: "allow" | "ask" | "deny" | "";
  reason: string;
}

/** interceptor 的构造选项。 */
export interface InterceptorOptions {
  rules?: readonly InterceptRule[];
  /** 工具白名单：只有这些工具进拦截路径。缺省 DEFAULT_ENABLED_TOOLS。 */
  enabledTools?: readonly string[];
  judgeConfig?: Partial<JudgeConfig>;
  /**
   * judge 的模型调用注入点。nil 时 judge 视为未接线 → 默认放行。
   * 由 bootstrap 层注入（复用会话 model selection）。
   */
  judgeRunner?: JudgeRunner;
  logger?: InterceptLogger;
}

/** judge 模型调用签名。返回原始文本；抛错走 failAction。 */
export type JudgeRunner = (
  systemPrompt: string,
  input: JudgeReviewInput,
  signal?: AbortSignal,
) => Promise<string>;

export interface InterceptLogger {
  warn?: (message: string, context?: Record<string, unknown>) => void;
  info?: (message: string, context?: Record<string, unknown>) => void;
  debug?: (message: string, context?: Record<string, unknown>) => void;
}
