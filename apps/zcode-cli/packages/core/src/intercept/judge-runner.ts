// JudgeRunner 接线——把拦截层的 judge 接到实际模型。
//
// 对齐 ARTEX server/intercept.go:65-95 的 reviewCompletion：
//   · 单次非流式调用；
//   · 低温度（0）、关思考、1024 token 上限；
//   · 输出是纯文本 JSON，交给 parseVerdict 严格解析。
//
// 模型来源：复用会话当前的 modelFactory + selection（与 ARTEX 的 profileID
// 语义等价——都用「当前生效的模型」）。这样 judge 走与主链路相同的 provider、
// 相同的限流/重试治理，不需要独立配置。

import type { Model, ModelInputMessage, ModelSelection } from "@zcode/contracts";
import type { JudgeReviewInput, JudgeRunner } from "./types.js";

export interface CreateJudgeRunnerOptions {
  /** 构造 model（= runtime.modelFactory）。 */
  createModel: (selection: ModelSelection) => Model;
  /** 取当前生效的模型选择。judge 每次调用时读一次（会话可能换模型）。 */
  getSelection: () => ModelSelection | undefined;
}

/** judge 的 maxTokens（对齐 ARTEX streamCollectText 的 1024）。 */
const JUDGE_MAX_TOKENS = 1024;

/**
 * 构造 JudgeRunner。selection 不可用（未选模型）时抛错——上层按 failAction 处理。
 */
export function createJudgeRunner(options: CreateJudgeRunnerOptions): JudgeRunner {
  return async (systemPrompt, input: JudgeReviewInput, signal) => {
    const selection = options.getSelection();
    if (selection === undefined) {
      throw new Error("judge 无可用模型选择（会话未绑定模型）");
    }
    const model = options.createModel(selection);
    const messages: ModelInputMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(input) },
    ];
    const result = await model.generateText({
      messages,
      options: {
        // 低温度 + 小上限：判定要稳定、短促（对齐 ARTEX 的 temperature=0 / MaxTokens=1024）。
        maxOutputTokens: JUDGE_MAX_TOKENS,
      },
      ...(signal === undefined ? {} : { abortSignal: signal }),
    });
    return result.text;
  };
}
