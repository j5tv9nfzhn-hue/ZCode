import { useMemo } from "react";
import type { ResourceBudget } from "@zcode/shared";
import { withRendererPerformanceMode } from "@/lib/rendererResourceBudget.js";
import { useZCodeStoreWithDefault } from "@/store/StoreProvider.js";

/**
 * 渲染侧资源预算：机器分档 + 用户「性能模式」。
 *
 * 这是「性能模式」不再是死开关的入口——原先该状态只写进 store 并配了文案，全仓零消费者。
 *
 * 用容错版 store 取值：本 hook 会被设置页这类「单测里无 Provider 直接渲染」的组件消费
 * （见 settingsPageHelpers 的 GeneralSectionContent），严格版会在那里抛错。
 * 真实应用 Root 必挂 StoreProvider，走的是真实值；`false` 是原始值，引用稳定。
 */
export function useResourceBudget(): ResourceBudget {
  const performanceMode = useZCodeStoreWithDefault((state) => state.performanceMode, false);
  return useMemo(() => withRendererPerformanceMode(performanceMode), [performanceMode]);
}
