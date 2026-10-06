/**
 * agent 进程上限的**纯**选择逻辑：从常驻进程里挑出「腾名额该回收谁」。
 *
 * 为什么要单独成文件：`ZCodeAgentProcessManager` 已经因为集中维护进程生命周期而
 * 挂了 max-lines 豁免，把配额策略塞进去只会让它更难读。策略本身不需要读时钟、
 * 不需要碰 Map，只需要一个候选列表和一个时间戳，因此可以完全单测。
 *
 * 口径（三条同时满足才可回收）：
 * 1. 不动正在启动的那个 workspace——它的进程还没进池，但马上要占一份；
 * 2. 只回收真正空闲的——无在飞 RPC 且未在等存储启动。有在飞请求的进程正在干活，
 *    回收它等于把用户正在跑的任务打断；
 * 3. 至少空闲 `minIdleMs`——刚用过的 workspace 冷恢复代价最高（要重放 durable
 *    session log），优先挑真正闲置久的。
 */

export interface AgentProcessReclaimCandidate {
  workspaceKey: string;
  /** 最近一次被使用的时间戳（毫秒）。 */
  lastActivityAt: number;
  /** 无在飞请求且未在等存储启动；false 表示正在干活，不可回收。 */
  idle: boolean;
}

export interface SelectLruReclaimInput {
  candidates: readonly AgentProcessReclaimCandidate[];
  /** 正在启动的 workspace：不得回收自己。 */
  excludeWorkspaceKey: string;
  /** 本次需要腾出的名额数；<=0 表示无需回收。 */
  reclaimCount: number;
  /** 当前时间（毫秒），由调用方传入以保持本函数无时钟依赖。 */
  now: number;
  /** 可被 LRU 回收前至少要空闲的时长。 */
  minIdleMs: number;
}

export function selectLruReclaimWorkspaceKeys(input: SelectLruReclaimInput): string[] {
  if (input.reclaimCount <= 0) {
    return [];
  }
  const minIdleMs = Math.max(0, input.minIdleMs);
  return (
    input.candidates
      .filter(
        (candidate) =>
          candidate.workspaceKey !== input.excludeWorkspaceKey &&
          candidate.idle &&
          input.now - candidate.lastActivityAt >= minIdleMs,
      )
      // lastActivityAt 相同时按 workspaceKey 排序：回收顺序必须与 Map 插入顺序无关，
      // 否则同一份输入在不同机器上可能选出不同的进程，日志无法复现。
      .sort((left, right) =>
        left.lastActivityAt === right.lastActivityAt
          ? left.workspaceKey.localeCompare(right.workspaceKey)
          : left.lastActivityAt - right.lastActivityAt,
      )
      .slice(0, input.reclaimCount)
      .map((candidate) => candidate.workspaceKey)
  );
}
