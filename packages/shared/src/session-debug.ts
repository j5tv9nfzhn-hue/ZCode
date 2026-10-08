import { z } from "zod";

export const SESSION_DEBUG_LIMITS = {
  rounds: 200,
  network: 100,
  dedupe: 2000,
  /** 投影 diff 条数；与 core 侧环形缓冲容量一致，避免两边淘汰策略分叉。 */
  projectionDiffs: 200,
} as const;
export const sessionDebugParamsSchema = z.object({ sessionId: z.string().min(1) }).strict();
const count = z.number().finite().nonnegative();
const debugUsageSchema = z
  .object({
    inputTokens: count.optional(),
    outputTokens: count.optional(),
    totalTokens: count.optional(),
    reasoningTokens: count.optional(),
    cachedInputTokens: count.optional(),
    cachedWriteInputTokens: count.optional(),
  })
  .strict();
export const sessionDebugRoundSchema = z
  .object({
    eventKey: z.string(),
    requestId: z.string(),
    requestIndex: count,
    recordedAt: count,
    usage: debugUsageSchema,
    hitRate: count.nullable(),
    generationDurationMs: count.nullable(),
    tokensPerSecond: count.nullable(),
  })
  .strict();
export const sessionDebugNetworkEntrySchema = z
  .object({
    eventKey: z.string(),
    traceId: z.string(),
    recordedAt: count,
    statusType: z.enum([
      "model_request_started",
      "model_request_completed",
      "model_request_failed",
      "model_retry_scheduled",
      "model_stream_stalled",
    ]),
    requestId: z.string().optional(),
    providerId: z.string().optional(),
    modelId: z.string().optional(),
    providerKind: z.string().optional(),
    transport: z.string().optional(),
    baseURL: z.string().optional(),
    querySource: z.string().optional(),
    queryId: z.string().optional(),
    timestamp: z.string().optional(),
    attempt: count.optional(),
    maxAttempts: count.optional(),
    nextAttempt: count.optional(),
    retryable: z.boolean().optional(),
    statusCode: count.optional(),
    durationMs: count.optional(),
    delayMs: count.optional(),
    idleMs: count.optional(),
    timeoutMs: count.optional(),
    reason: z.string().optional(),
    message: z.string().optional(),
    requestHeaders: z.record(z.string(), z.string()),
    responseHeaders: z.record(z.string(), z.string()),
    requestHeaderCount: count,
    responseHeaderCount: count,
  })
  .strict();
/**
 * 投影 diff 单条（debug-only）。
 *
 * 警示：`before` 是**用户原始输入**。捕获开关默认关闭；开启后这些文本只存在
 * 于内存环形缓冲（不落盘、不进 transcript），但展示与外传仍需谨慎。
 */
export const sessionDebugProjectionDiffSchema = z
  .object({
    seq: count,
    recordedAt: count,
    role: z.enum(["user", "assistant"]),
    /** user 走句式重构，assistant 只过词表层。 */
    phase: z.enum(["restructure", "lexicon"]),
    /** 截断前的原文长度；与 before 长度不同说明 UI 看到的是片段。 */
    beforeLength: count,
    before: z.string(),
    after: z.string(),
    truncated: z.boolean(),
  })
  .strict();

/**
 * 计数概览。用于区分「投影没跑」与「跑了但没有改动」——只列变更条目时，
 * 观察者无法分辨这两种情况，容易误判成功能失效。
 */
export const sessionDebugProjectionDiffSummarySchema = z
  .object({
    enabled: z.boolean(),
    captureAssistant: z.boolean(),
    inspected: count,
    changed: count,
    evicted: count,
  })
  .strict();

export const sessionDebugSnapshotSchema = z
  .object({
    sessionId: z.string(),
    rounds: z.array(sessionDebugRoundSchema).max(SESSION_DEBUG_LIMITS.rounds),
    networkEntries: z.array(sessionDebugNetworkEntrySchema).max(SESSION_DEBUG_LIMITS.network),
    /** debug-only 投影 diff；捕获关闭时为空数组。 */
    projectionDiffs: z
      .array(sessionDebugProjectionDiffSchema)
      .max(SESSION_DEBUG_LIMITS.projectionDiffs)
      .default([]),
    projectionDiffSummary: sessionDebugProjectionDiffSummarySchema.default({
      enabled: false,
      captureAssistant: false,
      inspected: 0,
      changed: 0,
      evicted: 0,
    }),
    cache: z
      .object({
        hitRateRequestCount: count,
        totalInputTokens: count,
        totalCacheReadTokens: count,
        hitRate: count.nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type SessionDebugSnapshot = z.infer<typeof sessionDebugSnapshotSchema>;
export type SessionDebugNetworkEntry = z.infer<typeof sessionDebugNetworkEntrySchema>;
export type SessionDebugProjectionDiff = z.infer<typeof sessionDebugProjectionDiffSchema>;
export type SessionDebugProjectionDiffSummary = z.infer<
  typeof sessionDebugProjectionDiffSummarySchema
>;

/** 输出 token 与首输出到请求结束的同源时间；未知值不能用请求总耗时替代。 */
export function calculateOutputTps(
  outputTokens: number | undefined,
  generationDurationMs: number | null,
): number | null {
  if (
    outputTokens === undefined ||
    !Number.isFinite(outputTokens) ||
    outputTokens < 0 ||
    generationDurationMs === null ||
    !Number.isFinite(generationDurationMs) ||
    generationDurationMs <= 0
  )
    return null;
  const tps = (outputTokens * 1000) / generationDurationMs;
  return Number.isFinite(tps) ? tps : null;
}
