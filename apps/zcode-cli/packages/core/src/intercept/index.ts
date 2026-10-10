// 工具调用拦截层（对齐 ARTEX guard + intercept）。
//
// 导出面：
//   · Interceptor         —— 主判定器（白名单 + 规则 + LLM judge）
//   · DEFAULT_INTERCEPT_RULES / DEFAULT_ENABLED_TOOLS —— 内置规则与白名单
//   · DEFAULT_JUDGE_PROMPT / effectiveJudgePrompt      —— judge 提示词
//   · parseVerdict                                    —— 严格输出解析
//   · systemBlockMessage                              —— 拦截框定文案

export { Interceptor } from "./interceptor.js";
export { DEFAULT_ENABLED_TOOLS, DEFAULT_INTERCEPT_RULES, INTERCEPT_PATTERNS } from "./rules.js";
export {
  DEFAULT_JUDGE_PROMPT,
  JUDGE_CONTEXT_BOUNDARY,
  JUDGE_OUTPUT_CONTRACT,
  effectiveJudgePrompt,
} from "./judge-prompt.js";
export { parseVerdict, stripCodeFence } from "./judge-verdict.js";
export { systemBlockMessage } from "./block-message.js";
export type {
  InterceptDecision,
  InterceptLogger,
  InterceptRule,
  InterceptorOptions,
  JudgeConfig,
  JudgeReviewInput,
  JudgeRunner,
  JudgeVerdict,
} from "./types.js";
