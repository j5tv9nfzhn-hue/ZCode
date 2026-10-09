// 虚拟化列表的滚动容器「回调 ref」工厂。
//
// 解决的问题：Radix 的 DialogContent 经 Portal **延迟一帧**挂载
// （@radix-ui/react-portal 的 `useLayoutEffect(() => setMounted(true))`），
// 因此打开对话框那次渲染里滚动容器还不在 DOM 上。而 useVirtualizer 只在
// **宿主组件渲染**时才读 `getScrollElement()`（@tanstack/react-virtual 的
// `_willUpdate`），Portal 挂载不会让宿主重渲染，于是 virtualizer 永远拿不到
// 容器：`scrollElement` 为 null、没建立订阅、`getVirtualItems()` 恒返回空
// → 列表整片空白，直到某次无关的 setState 碰巧补出那次渲染。
//
// 修法：把 ref 改成回调 ref，在节点**真正挂到 DOM** 时调 `virtualizer.measure()`。
// measure() → notify(false) → options.onChange，而 react-virtual 的 onChange 就是
// 一次 rerender()——它补上了缺失的那次宿主重渲染，随后 `_willUpdate` 正常订阅测量。
//
// 为什么单独成文件：这段「挂载时唤醒、卸载时不唤醒」的不变量是整个修复的全部，
// 抽出来才能被单测直接钉住（仓库无 React 渲染测试基建，见
// packages/ui/test/providerModelDiscoveryVirtualizer.test.ts）。
//
// 真实用例见 packages/ui/src/settings/model-provider-section/ProviderCardSections.tsx。

/** 虚拟化器需要暴露的最小面：只要一个 measure。 */
export interface MeasurableVirtualizer {
  measure(): void;
}

/** 既能当 React ref 回调用、又持有 current 供 getScrollElement 读取。 */
export interface VirtualizerElementRef<TElement extends Element> {
  (node: TElement | null): void;
  current: TElement | null;
}

/**
 * 造一个「挂载即唤醒」的回调 ref。
 *
 * @param elementRef 宿主持有的元素引用；`getScrollElement` 从它的 `.current` 读节点
 * @param virtualizer 需在节点挂载时被唤醒的虚拟化器
 *
 * 卸载时不调用 `measure()`：节点已离开 DOM，那次测量没有对象，
 * 多发一次唤醒只会变成无意义的重渲染。
 */
export function createVirtualizerElementRef<TElement extends Element>(
  elementRef: { current: TElement | null },
  virtualizer: MeasurableVirtualizer,
): VirtualizerElementRef<TElement> {
  const attach = ((node: TElement | null) => {
    elementRef.current = node;
    if (node) virtualizer.measure();
  }) as VirtualizerElementRef<TElement>;
  attach.current = elementRef.current;
  return attach;
}
