import { z } from "zod";

export const SESSION_DEBUG_LIMITS = {
  rounds: 200,
  network: 100,
  dedupe: 2000,
  /** 编排快照里每一类节点的条数上限；与 core 侧 buildGraphOverview 的 limit 对齐。 */
  pentestNodes: 50,
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
 * 渗透编排态势快照（CTF Console 的覆盖度面板 + 图/产物面板的唯一数据源）。
 *
 * **只含结论与 ID，不含漏洞证据原文**：findingList 只有 severity / vulnclass /
 * summary，证据（命令输出、HTTP 响应）留在会话侧不进这个通道。理由与
 * projectionDiff 相同——这个快照会被 UI 轮询并展示，不该成为敏感载荷的搬运工。
 *
 * 缺席即 null：编排未开启、或 Host 版本不含该字段时都是 null，
 * UI 据此显示「未开启」而不是伪造一个空编排。
 */
export const sessionDebugPentestOverviewSchema = z
  .object({
    goals: z
      .array(
        z
          .object({
            id: z.number().int(),
            state: z.string(),
            summary: z.string(),
          })
          .strict(),
      )
      .max(SESSION_DEBUG_LIMITS.pentestNodes),
    hints: z
      .array(z.object({ id: z.number().int(), summary: z.string() }).strict())
      .max(SESSION_DEBUG_LIMITS.pentestNodes),
    openIntents: z
      .array(
        z
          .object({
            id: z.number().int(),
            priority: z.number(),
            summary: z.string(),
            assetIds: z.array(z.number().int()),
          })
          .strict(),
      )
      .max(SESSION_DEBUG_LIMITS.pentestNodes),
    runningIntents: z
      .array(
        z
          .object({
            id: z.number().int(),
            summary: z.string(),
            owner: z.string().optional(),
          })
          .strict(),
      )
      .max(SESSION_DEBUG_LIMITS.pentestNodes),
    recentFacts: z
      .array(
        z
          .object({
            id: z.number().int(),
            summary: z.string(),
            confidence: z.string().optional(),
          })
          .strict(),
      )
      .max(SESSION_DEBUG_LIMITS.pentestNodes),
    findingList: z
      .array(
        z
          .object({
            id: z.number().int(),
            vulnclass: z.string(),
            severity: z.string(),
            summary: z.string(),
          })
          .strict(),
      )
      .max(SESSION_DEBUG_LIMITS.pentestNodes),
    doneIntentsTotal: count,
    frontierOpen: count,
    coverage: z
      .object({
        denominator: count,
        tested: count,
        pct: count,
      })
      .strict(),
  })
  .strict();

export const sessionDebugSnapshotSchema = z
  .object({
    sessionId: z.string(),
    rounds: z.array(sessionDebugRoundSchema).max(SESSION_DEBUG_LIMITS.rounds),
    networkEntries: z.array(sessionDebugNetworkEntrySchema).max(SESSION_DEBUG_LIMITS.network),
    /** 渗透编排态势；未开启编排时为 null。 */
    pentestOverview: sessionDebugPentestOverviewSchema.nullable().default(null),
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
export type SessionDebugPentestOverview = z.infer<typeof sessionDebugPentestOverviewSchema>;
export type SessionDebugNetworkEntry = z.infer<typeof sessionDebugNetworkEntrySchema>;

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
