import { logger } from "@/logger.js";

/**
 * 兜底时限：即使渲染帧一直不来（Electron 窗口隐藏/最小化时浏览器会节流或暂停 rAF），
 * 批处理也必须在该时限内执行。取值明显大于一帧（16.7ms），只在 rAF 停摆时才会用到。
 */
const FRAME_BATCHER_FALLBACK_MS = 100;

/**
 * 帧级批处理调度。
 *
 * 用途：把高频的同步触发点（流式 delta 帧、外部 store 通知、尺寸读取）合并到
 * 下一帧统一执行一次，避免同一 tick 内多次重复触发下游重渲染或强制布局。
 *
 * 语义边界：
 * - 只做「同一帧内多次 schedule 合并成一次执行」，不提供节流时长、不做节流窗口；
 *   需要按时间窗节流的调用方应自行配合 debounce/throttle。
 * - 排队的是最新一批任务，不是节流：所有 schedule 的任务都会在下一帧按入队顺序各执行一次。
 * - 不吞异常：单个任务抛错时记录日志并继续执行同批次后续任务，避免一个订阅者
 *   的异常导致同帧其他状态更新被静默跳过。
 *
 * rAF 与 setTimeout 竞速：桌面窗口不可见时 rAF 可能被节流到秒级甚至暂停，
 * 状态通知不能等它，因此两个句柄先到者触发、另一个被取消，两种环境都不丢更新。
 */
export function scheduleFrameCallback(callback: () => void): () => void {
  if (typeof requestAnimationFrame !== "function") {
    const handle = setTimeout(callback, 0);
    return () => clearTimeout(handle);
  }

  let frameHandle: number | undefined;
  let timerHandle: ReturnType<typeof setTimeout> | undefined;
  let done = false;
  const finish = () => {
    if (done) {
      return;
    }
    done = true;
    if (frameHandle !== undefined) cancelAnimationFrame(frameHandle);
    if (timerHandle !== undefined) clearTimeout(timerHandle);
    callback();
  };
  frameHandle = requestAnimationFrame(finish);
  timerHandle = setTimeout(finish, FRAME_BATCHER_FALLBACK_MS);
  return () => {
    if (done) {
      return;
    }
    done = true;
    if (frameHandle !== undefined) cancelAnimationFrame(frameHandle);
    if (timerHandle !== undefined) clearTimeout(timerHandle);
  };
}

export interface FrameBatcher {
  /** 把任务排到下一帧；同一帧内多次调用会合并为一次批量执行。 */
  schedule: (task: () => void) => void;
  /** 立即执行已排队任务并取消待执行的帧回调（拆卸、终态收口等需要同步可见的场景）。 */
  flush: () => void;
  /** 丢弃已排队任务且不再执行（彻底放弃该批更新时使用）。 */
  cancel: () => void;
}

/**
 * 创建一个帧级批处理器。
 *
 * 典型用法是「先更新内部状态（立即可见），再把对外通知合并到下一帧」：
 * 读取方随时能拿到最新状态，但订阅树不会按触发频率重渲染。
 */
export function createFrameBatcher(): FrameBatcher {
  let queue: Array<() => void> = [];
  let cancelScheduledFrame: (() => void) | null = null;

  const runQueue = (): void => {
    cancelScheduledFrame = null;
    if (queue.length === 0) return;
    const tasks = queue;
    queue = [];
    for (const task of tasks) {
      try {
        task();
      } catch (error) {
        logger.error("[frameBatcher] 批处理任务执行失败", error);
      }
    }
  };

  return {
    schedule(task) {
      queue.push(task);
      // 已有待执行的帧回调：任务已入队，由它统一带走，不再重复排帧。
      if (cancelScheduledFrame !== null) return;
      cancelScheduledFrame = scheduleFrameCallback(runQueue);
    },
    flush() {
      if (cancelScheduledFrame !== null) {
        cancelScheduledFrame();
        cancelScheduledFrame = null;
      }
      runQueue();
    },
    cancel() {
      if (cancelScheduledFrame !== null) {
        cancelScheduledFrame();
        cancelScheduledFrame = null;
      }
      queue = [];
    },
  };
}
