// 回归测试：拉取模型列表后面板空白（2026-10-09 修复）。
//
// 症状：点「从端点获取模型」→ 对话框弹出、行数与计数显示正常，但列表整片空白；
//       手动点一下「全选 / 全不选 / 取消」又立刻恢复正常。
//
// 根因是三层时序叠加，本测试逐段钉住它（用真实的 @tanstack/virtual-core 类，
// 不 mock 虚拟化器本身，这样修错实现方式时会真实失败）：
//   1. Radix Portal 延迟一帧挂载 DialogContent，打开那次渲染里滚动容器还不在 DOM；
//   2. Virtualizer 只在宿主组件渲染时才读 getScrollElement()；
//   3. 于是 scrollElement 永远为 null、getVirtualItems() 恒为空 → 列表空白。
// 全选/取消之所以「能恢复」，只是它们 setState 顺带补出了那次缺失的宿主渲染。
//
// 修法（ProviderCardSections.tsx 的 attachDiscoveredListRef）是在容器真正挂载时
// 调 virtualizer.measure()。它触发的 onChange 正是 react-virtual 用来重渲染宿主的
// 信号，因此补上了第 3 步缺失的那次渲染。
//
// 为什么不写组件渲染测试：本仓库无 jsdom / @testing-library / React 渲染测试基建，
// packages/ui 也 historically 没有 test script（测试入口是根 package.json 的通配
// glob）。修在时序机制上而不是行为表现上，是当前基建下唯一可测的层面。
import assert from "node:assert/strict";
import { test } from "node:test";
import type { VirtualizerOptions } from "@tanstack/virtual-core";
import { Virtualizer, elementScroll } from "@tanstack/virtual-core";
import { createVirtualizerElementRef } from "../src/lib/virtualizerElementRef.js";

/** 与 ProviderCardSections.tsx 的 DISCOVERED_MODEL_ROW_HEIGHT_PX / overscan 对齐。 */
const ROW_HEIGHT_PX = 36;
const OVERSCAN = 8;
/** 对话框滚动容器 max-h-72 的可用高度。 */
const VIEWPORT_HEIGHT_PX = 288;
const MODEL_COUNT = 200;

/**
 * 造一个虚拟化器够用的假滚动容器。
 *
 * 不给 targetWindow（ownerDocument.defaultView=undefined）：真实浏览器里它用来建
 * ResizeObserver，Node 下没有，而 Virtualizer 的 observer 是**惰性**构造（拿不到
 * targetWindow 就直接跳过），所以构造过程是安全的。观察动作由测试自带的
 * observeElementRect / observeElementOffset 代替——它们模拟的正是「观察器回调一次」
 * 这个效果，与真实浏览器一致。
 */
function createFakeScrollElement() {
  return {
    scrollTop: 0,
    scrollLeft: 0,
    scrollHeight: ROW_HEIGHT_PX * MODEL_COUNT,
    clientHeight: VIEWPORT_HEIGHT_PX,
    scrollWidth: 420,
    clientWidth: 420,
    scrollTo: () => {},
    ownerDocument: { defaultView: undefined },
  };
}

function rectOf(element: ReturnType<typeof createFakeScrollElement>) {
  return { width: element.clientWidth, height: element.clientHeight };
}

function createComponentLikeVirtualizer(state: { onChangeCount: number }) {
  let notifyRect: ((rect: { width: number; height: number }) => void) | undefined;
  let notifyOffset: ((offset: number, isScrolling: boolean) => void) | undefined;

  // 宿主持有的元素引用：ref 往 .current 写、getScrollElement 从 .current 读——
  // 与 ProviderCardSections.tsx 里 discoveredListRef 的用法完全一致。
  const elementRef = { current: null as HTMLDivElement | null };

  const options: VirtualizerOptions<HTMLDivElement, HTMLDivElement> = {
    count: MODEL_COUNT,
    getScrollElement: () => elementRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: OVERSCAN,
    // 与 useVirtualizer 的默认选项保持一致（react-virtual dist/esm/index.js:37-41）：
    // 少了 scrollToFn，_willUpdate 末尾的 _scrollToOffset 会直接抛 TypeError。
    scrollToFn: elementScroll,
    // 用直接回调替代浏览器观察器，测试里同步驱动「观察器触发」。
    observeElementRect: (_instance, cb) => {
      notifyRect = cb;
      return () => {};
    },
    observeElementOffset: (_instance, cb) => {
      notifyOffset = cb;
      return () => {};
    },
    onChange: () => {
      // react-virtual 的 onChange 就是宿主的重渲染触发器（dist/esm/index.js:12-22）。
      // 这里只记次数，用来断言 measure() 真的发出了唤醒信号。
      state.onChangeCount += 1;
    },
  };

  const virtualizer = new Virtualizer(options);

  // 用组件真正使用的那段代码（@/lib/virtualizerElementRef）当 ref，而不是在本测试里
  // 手写等价物——否则有人把组件接线回退成普通 useRef，这个测试仍然会绿，
  // 就没有回归价值了。
  const attachRef = createVirtualizerElementRef(elementRef, virtualizer);

  return {
    virtualizer,
    /** 模拟「观察器回调」：把已挂载容器的尺寸喂进去。 */
    flushObservers(element: ReturnType<typeof createFakeScrollElement>) {
      notifyRect?.(rectOf(element));
      notifyOffset?.(0, false);
    },
    /** 宿主重渲染时 react-virtual 布局效应做的事。 */
    hostRerendered() {
      virtualizer._willUpdate();
    },
    /** React 把 ref 交给组件时调用它（挂载 / 卸载）。 */
    commitRef(node: ReturnType<typeof createFakeScrollElement> | null) {
      attachRef(node as unknown as HTMLDivElement | null);
    },
  };
}

test("Portal 未挂载时：滚动容器不在 DOM，列表渲染为空", () => {
  const state = { onChangeCount: 0 };
  const harness = createComponentLikeVirtualizer(state);

  // 打开对话框那次渲染里的布局效应——此时容器还没挂上。
  harness.hostRerendered();

  assert.equal(
    harness.virtualizer.getVirtualItems().length,
    0,
    "容器未挂载时不该有可见行（这正是用户看到的空白面板）",
  );
  assert.equal(state.onChangeCount, 0, "拿不到容器时不应发出重渲染信号");
});

test("修复路径：ref 在容器挂载时唤醒 virtualizer，宿主重渲染后出条目", () => {
  const state = { onChangeCount: 0 };
  const harness = createComponentLikeVirtualizer(state);
  const element = createFakeScrollElement();

  // Portal 挂载 → React 把节点交给 ref → createVirtualizerElementRef 调 measure()，
  // measure() → onChange → react-virtual 的宿主重渲染。这是修复的全部机制。
  harness.commitRef(element);

  assert.equal(
    state.onChangeCount,
    1,
    "容器挂载时必须发出一次 onChange——它被 react-virtual 转成宿主重渲染",
  );

  // 宿主被唤醒后重渲染，布局效应再次执行，这回 getScrollElement() 拿得到容器了。
  harness.hostRerendered();
  harness.flushObservers(element);

  const items = harness.virtualizer.getVirtualItems();
  assert.ok(items.length > 0, "唤醒后必须渲染出可见行");
  // 只渲染可见窗口附近的若干行，而不是 200 行全量挂载（虚拟化仍是必要的）。
  assert.ok(items.length < MODEL_COUNT, "虚拟化仍然生效，不应全量挂载");
  assert.equal(harness.virtualizer.getTotalSize(), ROW_HEIGHT_PX * MODEL_COUNT);
});

test("没有回调 ref 的唤醒就一直是空白（回退修复会让这条重新失败）", () => {
  const state = { onChangeCount: 0 };
  const harness = createComponentLikeVirtualizer(state);
  const element = createFakeScrollElement();

  // 模拟「修复被回退」：容器照常挂载进 DOM，但没有任何东西唤醒 virtualizer，
  // 宿主也没有重渲染。这正是线上报告的症状。
  harness.virtualizer.scrollElement = element as unknown as HTMLDivElement;
  harness.flushObservers(element);

  assert.equal(
    harness.virtualizer.getVirtualItems().length,
    0,
    "容器已在 DOM 但宿主未重渲染时仍应为空（bug 的直接原因）",
  );
});

test("卸载时不发唤醒：关掉对话框不会变成无限重渲染", () => {
  const state = { onChangeCount: 0 };
  const harness = createComponentLikeVirtualizer(state);
  const element = createFakeScrollElement();

  harness.commitRef(element);
  assert.equal(state.onChangeCount, 1);

  // React 卸载 DialogContent 时把 null 交给 ref；此时容器已离 DOM，
  // 再 measure() 没有对象，只会多一次无意义重渲染。
  harness.commitRef(null);

  assert.equal(state.onChangeCount, 1, "卸载不应再发出唤醒信号（否则就是无限重渲染）");
});
