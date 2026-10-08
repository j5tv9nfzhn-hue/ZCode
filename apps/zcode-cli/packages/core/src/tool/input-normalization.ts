import type { Logger } from "@zcode/contracts";
import type { ToolEntry } from "./types.js";
import { validateJsonSchemaValue } from "./json-schema.js";

interface NormalizeToolExecutionInputOptions {
  entry: ToolEntry;
  input: unknown;
  logger?: Logger;
  source: "initial" | "hook" | "permission";
}

export type RuntimeInputValidationIssue = Readonly<Record<string, unknown>>;

interface PreparedInitialToolExecutionResult {
  input: unknown;
  runtimeValidationIssues?: readonly RuntimeInputValidationIssue[];
}

type SafeParseResult<T = unknown> =
  | { success: true; data: T }
  | { success: false; error?: unknown };

interface SafeParseSchema<T = unknown> {
  safeParse(value: unknown): SafeParseResult<T>;
}

// Note: some model adapters and hook/broker paths can surface tool
// inputs as JSON strings instead of objects. We normalize safely here so bad
// input degrades into a recoverable validation error rather than crashing the
// executor before it can return a structured tool failure.
export function normalizeToolExecutionInput(options: NormalizeToolExecutionInputOptions): unknown {
  return prepareToolExecutionInput(options).input;
}

export function prepareInitialToolExecutionInput(
  options: Omit<NormalizeToolExecutionInputOptions, "source">,
): PreparedInitialToolExecutionResult {
  return prepareToolExecutionInput({ ...options, source: "initial" });
}

function prepareToolExecutionInput(
  options: NormalizeToolExecutionInputOptions,
): PreparedInitialToolExecutionResult {
  const jsonNormalized = normalizeTopLevelJsonString(options.input, options);
  const unwrapped = unwrapMalformedToolCallEnvelope(jsonNormalized, options);
  const runtimeSchema = asSafeParseSchema(options.entry.runtimeInputSchema);
  if (!runtimeSchema) {
    return { input: unwrapped };
  }

  const parsed = runtimeSchema.safeParse(unwrapped);
  if (!parsed.success) {
    // runtime schema 已经完成默认值、preprocess 和约束判断；失败时若只
    // 返回 raw input，后续 JSON Schema 会重新推导一份不完整且顺序不同的错误。
    const runtimeValidationIssues = readRuntimeValidationIssues(parsed.error);
    return {
      input: unwrapped,
      ...(runtimeValidationIssues.length === 0 ? {} : { runtimeValidationIssues }),
    };
  }

  return { input: parsed.data };
}

/**
 * 模型侧间歇性畸形：把参数再套一层信封发出来。
 *
 * 实测（同一模型、同一上下文，真缆线已确认为标准形状，排除「回放教坏」）：
 *   1. `{"arguments": {"command": "..."}}` —— OpenAI 习惯的 wrapper 泄漏到 tool-call 的入参对象里；
 *   2. `{"command": {"command": "..."}}` —— 把整个对象塞进唯一必填参数里（双层嵌套）。
 * 两种形态下模型都在下一轮看到校验错误后尝试自纠，形成「报错 → 自纠 → 再报错」的挣扎循环
 * （实测约 40% 调用落在畸形形态上，整个 turn 的执行预算被吃掉）。
 *
 * 归一化只在「解包后**严格**满足 inputSchema、而原值不满足」时生效：
 * - 用 `validateJsonSchemaValue` 双向判定，保证不会把合法输入改坏；
 * - 循环解包，覆盖实测到的双层嵌套（深度有上限，避免病态输入）。
 * 解包失败/歧义时原样返回，交给既有校验路径报错（不掩盖真实 schema 违规）。
 */
function unwrapMalformedToolCallEnvelope(
  input: unknown,
  options: NormalizeToolExecutionInputOptions,
): unknown {
  if (!isPlainObject(input)) return input;
  const schema = options.entry.inputSchema;
  if (validateJsonSchemaValue(input, schema).valid) return input;

  const MAX_UNWRAP_DEPTH = 4;
  let current: unknown = input;
  for (let depth = 0; depth < MAX_UNWRAP_DEPTH; depth += 1) {
    if (!isPlainObject(current)) return input;
    const candidate = unwrapSingleLevel(current);
    if (candidate === undefined) return input;
    if (validateJsonSchemaValue(candidate, schema).valid) {
      options.logger?.warn("Tool input envelope unwrapped", {
        event: "tool.input.envelope_unwrapped",
        depth: depth + 1,
        module: "core.tool.input-normalization",
        source: options.source,
        status: "completed",
        toolName: options.entry.metadata.name,
      });
      return candidate;
    }
    current = candidate;
  }
  return input;
}

/** 单层解包：`{arguments: {...}}` 或唯一必填键自身又被对象包了一层。 */
function unwrapSingleLevel(input: Record<string, unknown>): Record<string, unknown> | undefined {
  const keys = Object.keys(input);
  if (keys.length !== 1) return undefined;
  const only = keys[0];
  const value = input[only];
  if (!isPlainObject(value)) return undefined;
  // `arguments` wrapper：直接展开内层对象。
  if (only === "arguments") return value;
  // 双层嵌套：唯一键的值又是对象，且内层对象里存在同名键（`{command:{command:...}}`）。
  if (Object.prototype.hasOwnProperty.call(value, only)) return value;
  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeTopLevelJsonString(
  input: unknown,
  options: NormalizeToolExecutionInputOptions,
): unknown {
  if (typeof input !== "string") {
    return input;
  }

  try {
    return JSON.parse(input);
  } catch {
    options.logger?.warn("Tool execution input JSON normalization failed", {
      event: "tool.input.normalize_failed",
      inputLength: input.length,
      module: "core.tool.input-normalization",
      source: options.source,
      status: "failed",
      toolName: options.entry.metadata.name,
    });
    return input;
  }
}

function asSafeParseSchema(value: unknown): SafeParseSchema | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const safeParse = (value as { safeParse?: unknown }).safeParse;
  return typeof safeParse === "function" ? ({ safeParse } as SafeParseSchema) : undefined;
}

function readRuntimeValidationIssues(error: unknown): RuntimeInputValidationIssue[] {
  if (!error || typeof error !== "object") return [];
  const issues = (error as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return [];
  return issues.filter(
    (issue): issue is RuntimeInputValidationIssue =>
      typeof issue === "object" && issue !== null && !Array.isArray(issue),
  );
}
