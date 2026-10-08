import type { AgentRuntimeInternal } from "../internal.js";
import type {
  ProjectionDiffEntry,
  ProjectionDiffSummary,
} from "../helpers/neutral-task-projection-diff.js";

export interface NeutralTaskProjectionDiffSnapshot {
  readonly entries: readonly ProjectionDiffEntry[];
  readonly summary: ProjectionDiffSummary;
}

/**
 * debug-only 读取投影 diff 快照（`session/debug` 的数据源）。
 *
 * 为什么走方法而不是 SessionEvent：diff 含用户原始输入，一旦成为事件就会被
 * 落盘进 transcript 并可能出现在 UI 聊天记录里，与「debug-only、不进
 * transcript」的要求直接冲突。方法调用没有这条副作用路径。
 *
 * 捕获开关关闭时 recorder 是空实现，这里返回空列表 + enabled=false，
 * 调用方无需分支。
 */
export function getNeutralTaskProjectionDiffs(
  this: AgentRuntimeInternal,
): NeutralTaskProjectionDiffSnapshot {
  const recorder = this.projectionDiffRecorder;
  return { entries: recorder.list(), summary: recorder.summary };
}

/** 清空缓冲与计数。session 结束或用户手动清空时调用。 */
export function clearNeutralTaskProjectionDiffs(this: AgentRuntimeInternal): void {
  this.projectionDiffRecorder.clear();
}