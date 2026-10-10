/**
 * 模型输出预算：决定本次请求下发给 provider 的 `maxOutputTokens`。
 *
 * 背景（真实缺陷）：
 * `unfilteredFullOutputEnabled`（CTF Console「完整输出」开关）最初实现为
 * **完全不下发** `maxOutputTokens`。adapter 的 `validateOptions` 是必填路径，
 * `maxOutputTokens === undefined` 会被判为 `invalid_model_request`
 * （"maxOutputTokens is outside the model option range"），turn 直接失败。
 *
 * 正确语义：开关只解除**本地上下文预算**造成的截断，不绕过 provider 侧校验——
 * 按模型自己声明的上限（`optionSpecs.maxOutputTokens.max`）下发。
 */

/** provider 侧把该值当作缺省上限；与本地上下文预算是两件事，不能互相冒充。 */
export const PROVIDER_DEFAULT_MAX_OUTPUT_TOKENS = 32_000;

export interface ModelOutputBudgetInput {
  /** CTF Console「完整输出」开关（AgentRuntimeConfig.unfilteredFullOutputEnabled）。 */
  readonly unfilteredFullOutputEnabled: boolean;
  /** 本地上下文预算算出的上限；可能为 undefined（尚未解析出预算）。 */
  readonly budgetedMaxOutputTokens: number | undefined;
  /** 模型自己声明的上限（ModelConfig.optionSpecs.maxOutputTokens.max）。 */
  readonly declaredMaxOutputTokens: number;
}

/**
 * 返回本次请求要下发的 `maxOutputTokens`。
 *
 * 不变量：
 *  1. 永远返回正整数——`undefined` 会被 adapter 的必填校验判为非法请求。
 *  2. 完整输出开启时取 max(本地上限, 模型声明上限)，即不被本地上下文预算截断。
 *  3. 完整输出关闭时保留原预算值（本地上下文预算是默认行为，不改变既有语义）。
 *  4. 模型声明上限非正整数时回落到 `PROVIDER_DEFAULT_MAX_OUTPUT_TOKENS`，
 *     避免配置异常把请求打成不可发送。
 */
export function resolveModelMaxOutputTokens(input: ModelOutputBudgetInput): number {
  const declared = normalizePositiveInteger(input.declaredMaxOutputTokens);
  const budgeted = normalizePositiveInteger(input.budgetedMaxOutputTokens);
  if (!input.unfilteredFullOutputEnabled) {
    return budgeted ?? declared ?? PROVIDER_DEFAULT_MAX_OUTPUT_TOKENS;
  }
  const candidates = [declared, budgeted].filter((value): value is number => value !== undefined);
  return candidates.length > 0 ? Math.max(...candidates) : PROVIDER_DEFAULT_MAX_OUTPUT_TOKENS;
}

function normalizePositiveInteger(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}