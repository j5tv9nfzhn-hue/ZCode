/**
 * 中性任务投影的 diff 记录器（debug-only）。
 *
 * 目的：让「投影到底把哪句话改成了什么」可被直接观察，而不是只能靠工具调用数
 * 与拒绝话术计数间接推断。缺这条可观测性时，词表漏词、重构模板不对、投影未触发
 * 三种故障无法区分。
 *
 * 硬约束（与 spec §2 不变量一致）：
 *  - **默认关闭**：`enabled` 为 false 时不产生任何 entry，连原文都不留存。
 *  - **不进 transcript**：本记录器只被 `session/debug` 这条调试通道读取，
 *    永远不构造 SessionEvent，因此不可能进入落盘历史或 UI 聊天记录。
 *  - **单条封顶**：正文按 `textLength` 截断，避免一句长输入撑爆缓冲。
 *  - **环形上限**：超过 `entries` 丢弃最旧的。
 *  - **只记 user 侧为默认**：assistant 侧只是词表层替换，diff 量极大且价值低，
 *    需 `captureAssistant` 二次开关显式开启。
 *
 * 生命周期：随 session runtime 实例存在；runtime 被回收时缓冲随之回收
 * （与 bootstrap 侧 `session/debug` 的 WeakMap 同一策略）。
 */

/** 环形容量与单条正文上限。entries 偏小是刻意的：调试面要能一眼看完。 */
export const PROJECTION_DIFF_LIMITS = { entries: 200, textLength: 2000 } as const;

/** 投影的两个阶段：user 真实输入走句式重构，其余只过词表层。 */
export type ProjectionDiffPhase = "restructure" | "lexicon";
export type ProjectionDiffRole = "user" | "assistant";

export interface ProjectionDiffEntry {
  /** 单调递增序号；环形淘汰后序号不回绕，UI 可据此判断是否丢过条目。 */
  readonly seq: number;
  readonly recordedAt: number;
  readonly role: ProjectionDiffRole;
  readonly phase: ProjectionDiffPhase;
  /** 截断前的原文长度；与 before.length 不同即说明 UI 看到的是片段。 */
  readonly beforeLength: number;
  readonly before: string;
  readonly after: string;
  readonly truncated: boolean;
}

/**
 * 计数概览。区分「投影没跑」与「跑了但没改动」——只记变更条目时这两者在
 * 观察者眼里完全一样，会导致误判。
 */
export interface ProjectionDiffSummary {
  readonly enabled: boolean;
  readonly captureAssistant: boolean;
  /** 本次会话内投影检查过的叙事块总数（含未变更）。 */
  readonly inspected: number;
  /** 实际发生改写并入库的条目数。 */
  readonly changed: number;
  /** 因超出环形容量被丢弃的条目数。 */
  readonly evicted: number;
}

export interface ProjectionDiffRecorder {
  readonly summary: ProjectionDiffSummary;
  /**
   * 记录一次改写。`before === after` 时只累加 inspected，不入环形缓冲。
   * 开关关闭或角色未开启时**直接返回**，不读取也不复制正文。
   */
  record(input: {
    readonly role: ProjectionDiffRole;
    readonly phase: ProjectionDiffPhase;
    readonly before: string;
    readonly after: string;
  }): void;
  /** 返回当前缓冲副本（按 seq 升序）。UI 按需拉取，不做增量订阅。 */
  list(): readonly ProjectionDiffEntry[];
  /** 清理缓冲，计数归零。session 结束或用户手动清空时使用。 */
  clear(): void;
}

export interface CreateProjectionDiffRecorderOptions {
  readonly enabled: boolean;
  readonly captureAssistant: boolean;
  readonly now?: () => number;
  readonly limits?: { readonly entries: number; readonly textLength: number };
}

export function createProjectionDiffRecorder(
  options: CreateProjectionDiffRecorderOptions,
): ProjectionDiffRecorder {
  const limits = options.limits ?? PROJECTION_DIFF_LIMITS;
  const now = options.now ?? (() => Date.now());
  let buffer: ProjectionDiffEntry[] = [];
  let seq = 0;
  let inspected = 0;
  let changed = 0;
  let evicted = 0;

  return {
    record(input) {
      // 先判开关再看正文：关闭时不得因为统计而把原文留在内存里。
      if (!options.enabled) return;
      if (input.role === "assistant" && !options.captureAssistant) return;
      inspected += 1;
      if (input.before === input.after) return;
      changed += 1;
      const before = input.before.slice(0, limits.textLength);
      const after = input.after.slice(0, limits.textLength);
      const entry: ProjectionDiffEntry = {
        seq: ++seq,
        recordedAt: now(),
        role: input.role,
        phase: input.phase,
        beforeLength: input.before.length,
        before,
        after,
        truncated: input.before.length > limits.textLength || input.after.length > limits.textLength,
      };
      buffer = [...buffer, entry];
      if (buffer.length > limits.entries) {
        const overflow = buffer.length - limits.entries;
        buffer = buffer.slice(overflow);
        evicted += overflow;
      }
    },

    list: () => [...buffer],

    clear() {
      buffer = [];
      seq = 0;
      inspected = 0;
      changed = 0;
      evicted = 0;
    },

    get summary(): ProjectionDiffSummary {
      return {
        enabled: options.enabled,
        captureAssistant: options.captureAssistant,
        inspected,
        changed,
        evicted,
      };
    },
  };
}

/** 未开启时的空记录器：调用方无需分支即可安全调用。 */
export function createDisabledProjectionDiffRecorder(): ProjectionDiffRecorder {
  return createProjectionDiffRecorder({ enabled: false, captureAssistant: false });
}

/**
 * 按 session 运行时配置构造记录器。
 *
 * 记录器**无条件创建**：开关关闭时它是空实现（record 直接 return，不读正文），
 * 这样 runModelTextRequest 不必每轮做分支判断，也避免「开关中途被改导致
 * 旧 runtime 行为不一致」这类隐式状态。
 */
export function createProjectionDiffRecorderFromConfig(config: {
  readonly neutralTaskProjection?: boolean;
  readonly neutralTaskProjectionDiffCapture?: boolean;
  readonly neutralTaskProjectionDiffCaptureAssistant?: boolean;
  readonly now?: () => number;
}): ProjectionDiffRecorder {
  return createProjectionDiffRecorder({
    // 双前置：diff 必须与投影同开。只开 diff 不开投影没有可观察对象，
    // 而只开投影是常态，因此这里 fail-closed 到「两个都开才记录」。
    enabled: config.neutralTaskProjection === true && config.neutralTaskProjectionDiffCapture === true,
    captureAssistant: config.neutralTaskProjectionDiffCaptureAssistant === true,
    ...(config.now ? { now: config.now } : {}),
  });
}