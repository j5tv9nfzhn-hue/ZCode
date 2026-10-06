import { useEffect, useMemo, useRef } from "react";
import type { ConversationRow, SessionPhase, SessionUsageState } from "@zcode/shared/zcode-protocol-v4";
import { useNowTicker } from "@/components/workflow-graph/use-now-ticker.js";

/**
 * 生成速度的滑动窗口。
 *
 * 取值口径参考 DeepSeek Harness 生态的 live-stats 类插件（TPS 按「最近一段时间的输出增量」
 * 估算，而不是「本次请求总输出 ÷ 全程耗时」）：后者在长回答里会被开头的首 token 延迟
 * 稀释，用户看到的数字远低于体感速度。
 */
const TOKENS_PER_SECOND_WINDOW_MS = 5_000;

export interface ConversationLiveMetrics {
  /** 最近窗口内的输出速率；不足两个采样点（刚起跑/刚恢复）时为 null。 */
  tokensPerSecond: number | null;
  /** 会话累计轮数；旧 CLI 不下发 counters 时回落到窗口内计数。 */
  turns: number | null;
  /** 会话累计工具调用步数；同上。 */
  steps: number | null;
  /** 是否正在生成——决定指标条是否展示速率。 */
  running: boolean;
}

interface UseConversationLiveMetricsParams {
  usage: SessionUsageState | null | undefined;
  phase: SessionPhase | null | undefined;
  rows: readonly ConversationRow[] | undefined;
}

/**
 * composer 下方实时指标的数据源。
 *
 * 速率完全在 renderer 侧由 `cumulative.outputTokens` 的增量推算——这是唯一既能实时刷新、
 * 又不需要新增协议字段的路径。轮/步则优先取 CLI 投影下发的全量计数（`usage.counters`），
 * 因为 `rows.window` 只是尾部窗口，直接派生会在长会话里系统性少算。
 */
export function useConversationLiveMetrics({
  usage,
  phase,
  rows,
}: UseConversationLiveMetricsParams): ConversationLiveMetrics {
  const running = phase === "running" || phase === "prewarming";
  const outputTokens = usage?.cumulative.outputTokens ?? 0;
  // 只在生成期走秒表：停止后速率不再有意义，也让空闲会话不再每秒重渲染。
  const nowMs = useNowTicker(running);
  const samplesRef = useRef<Array<{ at: number; tokens: number }>>([]);

  useEffect(() => {
    if (!running) {
      samplesRef.current = [];
      return;
    }
    const samples = samplesRef.current;
    const last = samples[samples.length - 1];
    // 值没变就不落新点：否则 tick 会把窗口填满重复采样，把真实增量摊薄。
    if (last && last.tokens === outputTokens) return;
    const at = Date.now();
    samples.push({ at, tokens: outputTokens });
    const cutoff = at - TOKENS_PER_SECOND_WINDOW_MS;
    while (samples.length > 2 && samples[0]!.at < cutoff) samples.shift();
  }, [outputTokens, running]);

  const tokensPerSecond = useMemo(() => {
    if (!running) return null;
    const samples = samplesRef.current;
    if (samples.length < 2) return null;
    const first = samples[0]!;
    const last = samples[samples.length - 1]!;
    const elapsedMs = last.at - first.at;
    if (elapsedMs <= 0) return null;
    const delta = last.tokens - first.tokens;
    // 负增量只可能来自会话切换/回退，视为无有效速率。
    if (delta <= 0) return null;
    return (delta * 1000) / elapsedMs;
    // nowMs 是每秒推进的"现在"，作为依赖让读数随窗口滚动刷新。
  }, [nowMs, outputTokens, running]);

  const windowCounts = useMemo(() => {
    if (usage?.counters) return null;
    let turns = 0;
    let steps = 0;
    for (const row of rows ?? []) {
      if (row.kind === "turnHeader") turns += 1;
      else if (row.kind === "toolCall") steps += 1;
    }
    return { turns, steps };
  }, [rows, usage?.counters]);

  const turns = usage?.counters?.turns ?? windowCounts?.turns ?? null;
  const steps = usage?.counters?.steps ?? windowCounts?.steps ?? null;

  return { tokensPerSecond, turns, steps, running };
}