import {
  applyRendererPerformanceMode,
  deriveResourceBudget,
  type ResourceBudget,
  type ResourceBudgetProbe,
} from "@zcode/shared";

/**
 * 渲染侧预算的探测与合成。放在 lib 而不是 hook 里，是因为两处都要用：
 * - `store/index.ts` 在创建 store 与 `setPerformanceMode` 时把 reducedMotion 落到
 *   `<html>` 上（`<html>` 类名是全应用唯一的开关点，CSS 与 JS 动画读同一个）；
 * - `hooks/useResourceBudget.ts` 给组件读具体取值。
 * 若把探测放进 hook，store 就得反过来 import hook，形成环。
 *
 * 探测用 `navigator.*` 而不是 Host 的 `os.*`：预算的 renderer 段描述的是**屏幕这台
 * 机器**的渲染能力。远程工作区的 agent 跑在远端，但 UI 永远跑在本地，用本地事实才对
 * （详见 `@zcode/shared` 的 resource-budget 文件头注释）。
 *
 * 同步可得，不需要等任何 RPC：`navigator.hardwareConcurrency` 在首个 render 前就存在。
 */
export function readRendererResourceBudgetProbe(): ResourceBudgetProbe {
  if (typeof navigator === "undefined") {
    return {};
  }
  return {
    ...(typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency > 0
      ? { cpuCount: navigator.hardwareConcurrency }
      : {}),
    ...readDeviceMemoryBytes(),
  };
}

/**
 * `navigator.deviceMemory` 不在标准 lib.dom 里（Chromium 按 0.25/0.5/1/2/4/8 分桶、
 * 上限 8GB），只能鸭子类型读取；拿不到就当没有这一维，档位退回只看核数。
 */
function readDeviceMemoryBytes(): { totalMemBytes?: number } {
  const nav = globalThis.navigator as (Navigator & { deviceMemory?: number }) | undefined;
  const deviceMemoryGb = nav?.deviceMemory;
  if (
    typeof deviceMemoryGb !== "number" ||
    !Number.isFinite(deviceMemoryGb) ||
    deviceMemoryGb <= 0
  ) {
    return {};
  }
  return { totalMemBytes: deviceMemoryGb * 1024 ** 3 };
}

/** 按机器分档，不含用户「性能模式」。 */
export function deriveRendererResourceBudget(): ResourceBudget {
  return deriveResourceBudget(readRendererResourceBudgetProbe());
}

/** 叠加用户「性能模式」；只影响 renderer 段（Host 进程看不到这个开关）。 */
export function withRendererPerformanceMode(enabled: boolean): ResourceBudget {
  return applyRendererPerformanceMode(deriveRendererResourceBudget(), enabled);
}
