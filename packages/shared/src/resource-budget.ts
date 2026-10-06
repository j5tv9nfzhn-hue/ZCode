/**
 * 资源预算：把「这台机器能扛多少并发」变成一个可推导、可回归的纯函数。
 *
 * 解决的是两个长期运行的真问题：
 * 1. agent 进程按 workspace 常驻、从不回收（`processesByWorkspaceKey` 只在窗口关闭时随
 *    Host 一起消失），开过多少 workspace 就常驻多少个完整 Node 运行时；
 * 2. 低配机器上仍按高档位起进程池与渲染 worker，把仅有的两个物理核抢满。
 *
 * ── 为什么拆成 processes / renderer 两段 ──
 * `processes` 由**跑 agent 的那个 Node 进程**消费（本地 Host 或远程 stdio 服务端），
 * 它读 `os.totalmem()` / `os.cpus()`，量的是「agent 实际跑在哪台机器上」——远程工作
 * 区的 agent 在远端，用远端的机器事实才是对的。
 * `renderer` 由 **Renderer** 消费，它读 `navigator.hardwareConcurrency` /
 * `navigator.deviceMemory`，量的是「屏幕这边」。
 * 两者在远程场景下**本来就是不同机器的事实**，不是同一事实的两次推导，因此不构成
 * 重复真相；同一台本地机器上两者的结论也必然一致（同一套阈值）。
 *
 * 用户设置（性能模式）只能覆盖 `renderer` 段：它在 Renderer 的 localStorage 里，
 * Host 进程看不见。若把它写进 `processes` 段就是一个永远读不到的死字段。
 *
 * 本文件不做任何 IO、不读环境、不读时钟：探测由调用方完成，这里只做纯函数。
 */

export type ResourceBudgetTier = "low" | "mid" | "high";

/** 机器探测结果。字段允许缺失：浏览器侧 `deviceMemory` 只有 GB 且按档位分桶。 */
export interface ResourceBudgetProbe {
  /** 物理内存字节数（`os.totalmem()`）。 */
  totalMemBytes?: number;
  /** 逻辑 CPU 数（`os.cpus().length` / `navigator.hardwareConcurrency`）。 */
  cpuCount?: number;
}

/** 进程侧预算：约束真实进程数量。由 Node 侧（Host / 远程服务端）消费。 */
export interface ProcessBudget {
  /**
   * 单个进程池内最多常驻的 agent 进程数。
   *
   * 这是**安全阀**不是配额目标：达到上限时回收最久未使用的空闲进程，而不是拒绝新
   * workspace 启动。拒绝启动会让「多开几个 workspace」变成不可用，因此宁可多一次冷恢复。
   */
  agentProcessMax: number;
  /** agent 空闲回收阈值（毫秒）。`undefined` 表示该档位不做空闲回收。 */
  agentIdleTimeoutMs?: number;
}

/** 渲染侧预算：约束 Renderer 内的并发与自动行为。 */
export interface RendererBudget {
  /** diffs 高亮 worker 池大小。 */
  diffsWorkerPool: number;
  /** 关闭非必要动画与过渡。 */
  reducedMotion: boolean;
  /** 允许生成产物（pptx 等）自动打开。 */
  autoOpenGeneratedDocs: boolean;
}

export interface ResourceBudget {
  tier: ResourceBudgetTier;
  processes: ProcessBudget;
  renderer: RendererBudget;
}

const MINUTE_MS = 60_000;
const BYTES_PER_GB = 1024 ** 3;

/**
 * 阈值取「<=」而不是「<」：`navigator.deviceMemory` 按档位分桶且上限为 8，
 * 8GB 机器上报的就是 8。用 `<` 会让 8GB 机器被判成 mid，正好漏掉最需要降级的一档。
 * `cpuCount <= 4` 同理覆盖本仓库常见的 4 逻辑核开发机与老笔记本。
 *
 * 注意 probe 传的是**字节**（os.totalmem / deviceMemory×1024³），必须先折成 GB
 * 再比阈值；直接拿字节和 8 比会把任何真实机器都判成 high。
 */
function resolveTier(probe: ResourceBudgetProbe): ResourceBudgetTier {
  const totalMemBytes = toFinitePositive(probe.totalMemBytes);
  const totalMemGb = totalMemBytes === undefined ? Number.NaN : totalMemBytes / BYTES_PER_GB;
  const cpuCount = toFinitePositive(probe.cpuCount) ?? Number.NaN;
  const lowMem = Number.isFinite(totalMemGb) && totalMemGb <= 8;
  const lowCpu = Number.isFinite(cpuCount) && cpuCount <= 4;

  if (lowMem || lowCpu) {
    return "low";
  }
  const midMem = Number.isFinite(totalMemGb) && totalMemGb <= 16;
  const midCpu = Number.isFinite(cpuCount) && cpuCount <= 8;
  if (midMem || midCpu) {
    return "mid";
  }
  // 探测不全时取 mid：既不按高档位放任，也不把一个只是探测失败的机器打成低配。
  if (Number.isFinite(totalMemGb) && Number.isFinite(cpuCount)) {
    return "high";
  }
  return "mid";
}

function toFinitePositive(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * 由机器探测结果推导预算。纯函数、同输入同输出，可直接单测。
 *
 * 各档取值：
 * - low（<=8GB 或 <=4 核）：agent 最多 2 个、10 分钟空闲回收、diffs 池 1、关自动开产物。
 *   这类机器的唯一合理并发预算是 1–2 个活跃 workspace，2 是「允许开第二个 tab 看一眼」
 *   的上限，再多就必须先冷恢复前一个。
 * - mid：agent 最多 4 个、20 分钟回收、diffs 池 2，其余保持产品默认。
 * - high：agent 上限 12（纯安全阀，正常用法触不到）、**不做空闲回收**、diffs 池按核数算。
 *   高配机器上主动回收只会换来用户没要求的冷恢复延迟，因此只在内存真的是瓶颈时才回收。
 */
export function deriveResourceBudget(probe: ResourceBudgetProbe): ResourceBudget {
  const tier = resolveTier(probe);
  const cpuCount = toFinitePositive(probe.cpuCount) ?? 4;

  if (tier === "low") {
    return {
      tier,
      processes: { agentProcessMax: 2, agentIdleTimeoutMs: 10 * MINUTE_MS },
      renderer: { diffsWorkerPool: 1, reducedMotion: true, autoOpenGeneratedDocs: false },
    };
  }
  if (tier === "mid") {
    return {
      tier,
      processes: { agentProcessMax: 4, agentIdleTimeoutMs: 20 * MINUTE_MS },
      renderer: { diffsWorkerPool: 2, reducedMotion: false, autoOpenGeneratedDocs: true },
    };
  }
  return {
    tier,
    processes: { agentProcessMax: 12, agentIdleTimeoutMs: undefined },
    renderer: {
      // 高档位沿用原来的经验公式：核数的一半、上限 4。
      diffsWorkerPool: Math.max(1, Math.min(4, Math.floor(cpuCount / 2))),
      reducedMotion: false,
      autoOpenGeneratedDocs: true,
    },
  };
}

/**
 * 把用户的「性能模式」开关叠加到预算上。只改 `renderer` 段（原因见文件头注释）。
 *
 * 关闭时不把档位往上调：一个在 8GB 机器上手动关掉性能模式的用户，应该继续拿到
 * low 档的进程侧保护，否则一个误触就会把机器重新推到分页。
 */
export function applyRendererPerformanceMode(
  budget: ResourceBudget,
  enabled: boolean,
): ResourceBudget {
  if (!enabled) {
    return budget;
  }
  return {
    ...budget,
    renderer: {
      // 显式开启时用 low 档的渲染取值，但不动 tier 与 processes 段：
      // tier 是机器事实的结论，进程侧预算由 Host 独立推导，这里改不到也不该改。
      diffsWorkerPool: 1,
      reducedMotion: true,
      autoOpenGeneratedDocs: false,
    },
  };
}
