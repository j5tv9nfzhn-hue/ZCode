import { useEffect, useMemo, useRef } from "react";
import type {
  ConversationRow,
  SessionPhase,
  SessionUsageState,
} from "@zcode/shared/zcode-protocol-v4";
import { useNowTicker } from "@/components/workflow-graph/use-now-ticker.js";
import {
  applyRowsToOutputTokenLedger,
  computeRateFromSamples,
  createOutputTokenLedger,
  TOKENS_PER_SECOND_WINDOW_MS,
  type OutputTokenLedger,
} from "@/v4/composer/liveMetricsEstimate.js";

export interface ConversationLiveMetrics {
  /**
   * 窗口内的输出速率。生成中为实时值；点不够或刚起跑时为 null。
   * 注意与 lastRate 区分：这个读数在 running=false 时为 null。
   */
  tokensPerSecond: number | null;
  /**
   * 上一次生成的收尾速率。回复完成后冻结保持，下次起跑时清空——
   * 指标条完成态用它继续显示速度，而不是退回「—」（用户反馈：完成后不该消失）。
   */
  lastRate: number | null;
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
 * composer 下方实时指标的数据源。估算核心在 liveMetricsEstimate.ts（可脱离 React 测试）。
 *
 * 速率数据源的根因修复（本地自用分支 bugfix）：原实现取 `usage.cumulative.outputTokens`
 * 的增量，但该字段在 CLI 投影里的**唯一**累加点是 onModelComplete（模型请求完成的
 * reducer），流式期间恒定不变——而流式期间恰恰是用户盯着速率的窗口。逐步长回答里
 * 每步完成只产生一个采样点，窗口内凑不齐两个点，TPS 恒为 null（UI 恒显「—」）；
 * 即便凑齐，elapsed 还混入工具执行间隔，读数被严重稀释。这就是「速度/吞吐无效」的根因。
 *
 * 现改用**流式行文本增长**做采样信号：row.delta 每帧都在追加 assistantText/reasoning
 * 正文与 toolCall 入参，这是 renderer 侧唯一实时、不间断、且无需新增协议字段的输出信号。
 * 字符数按 CJK 权重估算成 token，追求量级正确。
 *
 * 轮/步仍优先取 CLI 投影下发的全量计数（`usage.counters`），因为 `rows.window` 只是
 * 尾部窗口，直接派生会在长会话里系统性少算。
 */
export function useConversationLiveMetrics({
  usage,
  phase,
  rows,
}: UseConversationLiveMetricsParams): ConversationLiveMetrics {
  const running = phase === "running" || phase === "prewarming";
  // 只在生成期走秒表：停止后速率不再有意义，也让空闲会话不再每秒重渲染。
  const nowMs = useNowTicker(running);
  const ledgerRef = useRef<OutputTokenLedger | null>(null);
  const samplesRef = useRef<Array<{ at: number; tokens: number }>>([]);
  // 上一次生成的收尾速率：running 落定时冻结最后一个有效读数，供完成态指标条继续显示；
  // 新一轮起跑时清空（避免显示上一轮的速度冒充本轮）。
  const lastRateRef = useRef<number | null>(null);
  const prevRunningRef = useRef(running);

  // 刻意在 render 阶段做状态迁移，而不是放进 effect：running 落定的那一次渲染必须**立刻**
  // 拿到冻结值，effect 在绘制之后才跑，用户会先看到一帧「—」再跳回速度值。
  // 迁移只在布尔翻转的那一次发生，后续渲染命中 else 分支保持原值；StrictMode 双调用
  // 第二次看不到翻转，但值已由第一次写好，结果一致。
  if (running !== prevRunningRef.current) {
    if (running) {
      lastRateRef.current = null;
    } else {
      // 刚收尾：冻结采样窗里最后一个有效速率。退化样本返回 null 时保留旧值语义，
      // 由消费端决定显示占位符（首答没攒够样本的情况本就不该编一个速度）。
      const finalRate = computeRateFromSamples(samplesRef.current);
      if (finalRate !== null) lastRateRef.current = finalRate;
    }
    prevRunningRef.current = running;
  }

  useEffect(() => {
    const ledger = (ledgerRef.current ??= createOutputTokenLedger());
    const total = applyRowsToOutputTokenLedger(ledger, rows);
    if (!running) {
      samplesRef.current = [];
      return;
    }
    const samples = samplesRef.current;
    const last = samples[samples.length - 1];
    // 值没变就不落新点：否则 tick 会把窗口填满重复采样，把真实增量摊薄。
    if (last && last.tokens === total) return;
    const at = Date.now();
    samples.push({ at, tokens: total });
    const cutoff = at - TOKENS_PER_SECOND_WINDOW_MS;
    while (samples.length > 2 && samples[0]!.at < cutoff) samples.shift();
  }, [rows, running]);

  // 速率随渲染即时计算：流式期 rows 每帧变化都会触发重渲染，空闲时 ticker 已停。
  // 刻意不套 useMemo——读数依赖 ref 里的采样表，依赖数组无法正确表达它；
  // nowMs 每秒推进兜底刷新（窗口滚动后即便无新点也要重新出数）。
  void nowMs;
  const tokensPerSecond = running ? computeRateFromSamples(samplesRef.current) : null;

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

  return { tokensPerSecond, lastRate: lastRateRef.current, turns, steps, running };
}
