import {
  SessionEventType,
  type ModelNetworkStatusPayload,
  type SessionEvent,
} from "@zcode/contracts";
import {
  SESSION_DEBUG_LIMITS,
  calculateOutputTps,
  sessionDebugParamsSchema,
  zcodeTaskNetworkDebugStatusFromPayload,
  type SessionDebugPentestOverview,
  type SessionDebugProjectionDiff,
  type SessionDebugProjectionDiffSummary,
  type SessionDebugSnapshot,
} from "@zcode/shared";
import { requireSession, type ZCodeProtocolAgentServerContext } from "./server-types.js";

type SessionRecord = DebugSessionRecord;
interface Observation {
  snapshot: SessionDebugSnapshot;
  seenEvents: Set<string>;
  completedRequests: Set<string>;
  hasUnknownCacheUsage: boolean;
}
// 旁路记录跟随 CLI record 回收，不挂到聊天投影、轮次事实或已提交输入队列上。
const observations = new WeakMap<SessionRecord, Observation>();
const MAX_HEADER_COUNT = 32;
const MAX_HEADER_VALUE_LENGTH = 512;
const MAX_MESSAGE_LENGTH = 2048;

function emptySnapshot(sessionId: string): SessionDebugSnapshot {
  return {
    sessionId,
    rounds: [],
    networkEntries: [],
    projectionDiffs: [],
    projectionDiffSummary: {
      enabled: false,
      captureAssistant: false,
      inspected: 0,
      changed: 0,
      evicted: 0,
    },
    cache: null,
    // 编排态势不是累积量：它每次都现读，缺席即「未开启」。
    pentestOverview: null,
  };
}

/**
 * debug-only 投影 diff 的数据源端口。
 *
 * 结构化窄类型而非直接依赖 ZCodeApp 或 @zcode/core：这条读取路径唯一的契约
 * 就是「能给出环形缓冲内容与计数」。刻意不复用 core 的类型——深导入
 * @zcode/core 会被 package exports 挡住，且会把调试面耦合到内部模块形状。
 * runtime 不满足时按未开启处理，不让调试面成为 session 创建的硬依赖。
 */
interface ProjectionDiffRuntimePort {
  getNeutralTaskProjectionDiffs?: () => {
    readonly entries: readonly SessionDebugProjectionDiff[];
    readonly summary: SessionDebugProjectionDiffSummary;
  };
}

/**
 * 渗透编排态势的读取端口。与上面同理走结构化窄类型，但**是异步的**：
 * 快照来自 SQLite（core 的 PentestOrchestrationPort.graphOverview），
 * 与 diff 的内存环形缓冲不同，不能同步取。
 */
interface PentestOverviewRuntimePort {
  getPentestOrchestrationOverview?: () => Promise<SessionDebugPentestOverview | undefined>;
}

interface DebugLogger {
  warn?(message: string, context?: Record<string, unknown>): void;
}

type DebugSessionRecord = {
  app: {
    sessionId: string;
    logger?: DebugLogger;
    runtime?: ProjectionDiffRuntimePort & PentestOverviewRuntimePort;
  };
};
function remember(keys: Set<string>, key: string): boolean {
  if (keys.has(key)) return false;
  keys.add(key);
  if (keys.size > SESSION_DEBUG_LIMITS.dedupe) keys.delete(keys.values().next().value!);
  return true;
}
function boundedHeaders(headers: Record<string, string>): Record<string, string> {
  // adapter 已脱敏；此处只限制调试响应体积，不保存正文，也不复制无限大小的 headers。
  return Object.fromEntries(
    Object.entries(headers)
      .slice(0, MAX_HEADER_COUNT)
      .map(([key, value]) => [
        key.slice(0, MAX_HEADER_VALUE_LENGTH),
        value.slice(0, MAX_HEADER_VALUE_LENGTH),
      ]),
  );
}
function token(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function observeSessionDebug(record: SessionRecord, event: SessionEvent): void {
  if (
    event.type !== SessionEventType.ModelNetworkStatus ||
    String(event.sessionId) !== record.app.sessionId
  )
    return;
  const payload = event.payload as ModelNetworkStatusPayload;
  const mapped = zcodeTaskNetworkDebugStatusFromPayload({
    taskId: record.app.sessionId,
    traceId: event.traceId,
    eventId: String(event.id),
    payload: { ...payload, model: { providerId: payload.providerId, modelId: payload.modelId } },
  });
  if (!mapped) return;
  let observation = observations.get(record);
  if (!observation) {
    observation = {
      snapshot: emptySnapshot(record.app.sessionId),
      seenEvents: new Set(),
      completedRequests: new Set(),
      hasUnknownCacheUsage: false,
    };
    observations.set(record, observation);
  }
  if (!remember(observation.seenEvents, String(event.id))) return;
  const { type: _type, taskId: _taskId, eventId: _eventId, inputId: _inputId, ...entry } = mapped;
  const parsedAt = Date.parse(payload.timestamp);
  const recordedAt = Number.isFinite(parsedAt) ? parsedAt : event.timestamp.getTime();
  const state = observation.snapshot;
  state.networkEntries = [
    ...state.networkEntries,
    {
      ...entry,
      recordedAt,
      // maxAttempts=0 表示无限重试，旧映射器会丢掉它，调试面必须保留。
      maxAttempts: payload.maxAttempts,
      requestHeaders: boundedHeaders(entry.requestHeaders),
      responseHeaders: boundedHeaders(entry.responseHeaders),
      ...(entry.message ? { message: entry.message.slice(0, MAX_MESSAGE_LENGTH) } : {}),
    },
  ].slice(-SESSION_DEBUG_LIMITS.network);
  if (
    payload.type !== "model_request_completed" ||
    payload.querySource !== "main_turn" ||
    !remember(observation.completedRequests, payload.requestId)
  )
    return;
  const usage = payload.usage;
  const inputTokens = token(usage?.inputTokens);
  const outputTokens = token(usage?.outputTokens);
  const cacheReadTokens = token(usage?.cacheReadTokens);
  const duration = token(payload.durationMs);
  const first = token(payload.timeToFirstContentMs);
  const generationDurationMs =
    duration !== undefined && first !== undefined && duration > first ? duration - first : null;
  observation.hasUnknownCacheUsage ||= inputTokens === undefined || cacheReadTokens === undefined;
  const previous = state.cache;
  const totalInputTokens = (previous?.totalInputTokens ?? 0) + (inputTokens ?? 0);
  const totalCacheReadTokens = (previous?.totalCacheReadTokens ?? 0) + (cacheReadTokens ?? 0);
  const requestIndex = (previous?.hitRateRequestCount ?? 0) + 1;
  state.cache = {
    hitRateRequestCount: requestIndex,
    totalInputTokens,
    totalCacheReadTokens,
    hitRate:
      !observation.hasUnknownCacheUsage && totalInputTokens > 0
        ? totalCacheReadTokens / totalInputTokens
        : null,
  };
  state.rounds = [
    ...state.rounds,
    {
      eventKey: String(event.id),
      requestId: payload.requestId,
      requestIndex,
      recordedAt,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens:
          token(usage?.totalTokens) ??
          (inputTokens !== undefined && outputTokens !== undefined
            ? inputTokens + outputTokens
            : undefined),
        reasoningTokens: token(usage?.reasoningTokens),
        cachedInputTokens: cacheReadTokens,
        cachedWriteInputTokens: token(usage?.cacheWriteTokens),
      },
      hitRate:
        inputTokens !== undefined && inputTokens > 0 && cacheReadTokens !== undefined
          ? cacheReadTokens / inputTokens
          : null,
      generationDurationMs,
      tokensPerSecond: calculateOutputTps(outputTokens, generationDurationMs),
    },
  ].slice(-SESSION_DEBUG_LIMITS.rounds);
}

const DISABLED_DIFF_SUMMARY: SessionDebugProjectionDiffSummary = {
  enabled: false,
  captureAssistant: false,
  inspected: 0,
  changed: 0,
  evicted: 0,
};

/**
 * 实时读取投影 diff。
 *
 * 不走 WeakMap 旁路：diff 由 core 的 runtime 环形缓冲持有（instance 级，
 * 随 session 回收），这里按 UI 的拉取节奏现读，因此能反映「当前会话流下来
 * 的最新 diff」而不是 snapshot 累积的旧值。
 */
function readProjectionDiffs(record: SessionRecord): {
  projectionDiffs: SessionDebugProjectionDiff[];
  projectionDiffSummary: SessionDebugProjectionDiffSummary;
} {
  const read = record.app.runtime?.getNeutralTaskProjectionDiffs;
  // 没有 runtime（纯 stdio 资产）或方法缺席都按「未开启」返回，不抛错——
  // 调试面不能反过来成为 session 创建的硬依赖。
  if (typeof read !== "function") {
    return { projectionDiffs: [], projectionDiffSummary: DISABLED_DIFF_SUMMARY };
  }
  const snapshot = read.call(record.app.runtime);
  return {
    // 两侧容量必须一致，否则 UI 会看到「上游已淘汰、上游仍有」的错位。
    projectionDiffs: snapshot.entries.slice(-SESSION_DEBUG_LIMITS.projectionDiffs),
    projectionDiffSummary: snapshot.summary,
  };
}

export function readSessionDebug(record: SessionRecord): SessionDebugSnapshot {
  const base = observations.get(record)?.snapshot ?? emptySnapshot(record.app.sessionId);
  return { ...base, ...readProjectionDiffs(record), pentestOverview: null };
}

/**
 * 实时读取编排态势。
 *
 * 与 diff 同样现读（按 UI 拉取节奏），但多一层：它可能 reject（SQLite 锁、
 * 迁移缺席等）。调试面**不能因为一个可选面板读不到就把整个 session/debug 拉黑**，
 * 所以失败一律降级成 null + 一条 warn 日志。
 */
async function readPentestOverview(record: SessionRecord): Promise<SessionDebugPentestOverview | null> {
  const runtime = record.app.runtime;
  const read = runtime?.getPentestOrchestrationOverview;
  if (!runtime || typeof read !== "function") return null;
  try {
    return (await read.call(runtime)) ?? null;
  } catch (error) {
    record.app.logger?.warn?.("Read pentest orchestration overview failed", {
      errorMessage: error instanceof Error ? error.message : String(error),
      event: "session.debug.pentest_overview_failed",
      module: "bootstrap.zcode-protocol.session-debug",
      sessionId: record.app.sessionId,
    });
    return null;
  }
}

export async function readSessionDebugWithPentest(
  record: SessionRecord,
): Promise<SessionDebugSnapshot> {
  return { ...readSessionDebug(record), pentestOverview: await readPentestOverview(record) };
}

export async function querySessionDebug(
  context: ZCodeProtocolAgentServerContext,
  rawParams: unknown,
): Promise<SessionDebugSnapshot> {
  const params = sessionDebugParamsSchema.parse(rawParams);
  return await readSessionDebugWithPentest(requireSession(context, params.sessionId));
}
