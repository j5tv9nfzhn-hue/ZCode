# 左侧栏折叠：接通断链

> 状态：已实现（2026-10-09），S1–S9 待实机验证。本文只描述我方实现。
> 位置：`packages/ui/src/app-shell/WorkspaceShellLayout.tsx`（布局与折叠态 rail）、
> `WorkspaceSidebarCollapseToggle.tsx`（展开态控件）、`WorkspaceSidebarCollapsedRail.tsx`（折叠态 rail）。

## 1. 现象

左侧栏**事实上无法折叠**。不是没有折叠状态，而是没有任何可发现的入口。

## 2. 根因：三处断链

| #   | 位置                                 | 事实                                                                                                                                         |
| --- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `useAppPanels.ts:205` / `:1240`      | 折叠状态 `isSidebarVisible` 与 `handleToggleSidebar` **都存在且工作正常**                                                                    |
| 2   | `WorkspaceShellLayout.tsx:1536-1539` | 布局**能**响应折叠：宽度塌到 `--workspace-sidebar-panel-width`，桌面态即 `collapsedSidebarWidthPx = 4px`，配 `opacity-0 pointer-events-none` |
| 3   | `DesktopTopOverlay.tsx:134-150`      | 唯一可用入口。Windows/Linux 上它是**应用 Logo**，`SidebarToggleIcon` 靠 `opacity-0 group-hover:opacity-100` 交叉淡入                         |
| 4   | `WorkspaceSidebarCollapsedRail.tsx`  | **死代码**：全仓只有定义(7行)与 re-export(`WorkspaceSidebar.tsx:156`)，零渲染点。折叠后那 4px 空条里什么都不渲染                             |
| 5   | `WorkspaceSidebar.tsx:251-252`       | `onToggleSidebar: _onToggleSidebar` / `toggleSidebarShortcutLabel: _toggleSidebarShortcutLabel` —— 接收到手改名前缀，**组件内一次都没用**    |

第 5 条是关键：侧栏被显式告知折叠回调在哪，却主动丢弃。所以展开态没有常驻折叠控件，折叠态没有展开控件。

## 3. 方案

接通两处断链，不新增折叠状态、不新增状态所有者。

### 3.1 展开态：顶部右侧纯图标折叠按钮

放在 `WorkspaceSidebar.tsx:1257` 那条**已存在且当前为空**的 `<div className="h-12 [app-region:drag]">` 里。

- **必须带 `[app-region:no-drag]`**：`DesktopTopOverlay.tsx:128-131` 记录了这条教训——Electron 在覆盖层上优先按父级命中拖拽区域，点击会被窗口拖动吞掉。同理适用。
- 逻辑独立成 `WorkspaceSidebarCollapseToggle.tsx`，不往 `WorkspaceSidebar.tsx`（现 1618 行）里堆逻辑。
- `onToggleSidebar` / `toggleSidebarShortcutLabel` 两个 prop 恢复真名并真正使用。

### 3.2 折叠态：36px 单图标 rail

在 `WorkspaceShellLayout.tsx` 的侧栏容器内按可见性二选一渲染：

```
isSidebarPanelVisible ? <WorkspaceSidebar/> : <WorkspaceSidebarCollapsedRail/>
```

容器宽度折叠态由 `collapsedSidebarWidthPx`（4px）改为 `WORKSPACE_SIDEBAR_COLLAPSED_RAIL_WIDTH_PX = 36px`。

- **36px**：容纳 32px 图标按钮 + 两侧内边距，与 `DesktopTopOverlay` 的 `h-12 / px-1.5` 节奏一致。
- 复用已写好的 `WorkspaceSidebarCollapsedRail`（含 `PanelLeftOpen` 图标、tooltip、快捷键提示、`no-drag`），不改它。

## 4. 不变量

1. **不新增状态所有者**：折叠状态仍只有 `useAppPanels` 一处，本 spec 不引入第二份来源。
2. **双入口等价**：顶部 overlay 的 Logo 与侧栏内新按钮调用同一个 `handleToggleSidebar`，行为完全一致。
3. **折叠后必有展开入口**：任何路径导致折叠，36px rail 都在，`PanelLeftOpen` 可点。
4. **拖拽带可拖窗**：折叠按钮所在的那条 `h-12` 带仍需 `[app-region:drag]`，按钮自身 `no-drag`。
5. **宽度由 React state 驱动折叠态**：与既有 `--workspace-sidebar-panel-width` 变量分工不变——变量继续管展开态宽度与拖拽瞬时值，折叠态走常量。

## 5. 验收场景

| #   | 场景                               | 期望                                                                  |
| --- | ---------------------------------- | --------------------------------------------------------------------- |
| S1  | 展开态，侧栏顶部右侧               | 可见常驻折叠图标按钮（非 hover 才显形），带 tooltip 与快捷键提示      |
| S2  | 点该按钮                           | 侧栏折叠为 36px rail                                                  |
| S3  | 折叠态                             | 左侧 36px rail 可见，内含 `PanelLeftOpen` 展开按钮                    |
| S4  | 点 rail 按钮                       | 侧栏恢复展开，宽度回到原值（`workspaceSidebarPanelWidthPx` 不被改写） |
| S5  | 拖拽窗口标题区（侧栏顶部带空白处） | 窗口正常拖动——按钮的 `no-drag` 未污染整条带                           |
| S6  | 点 S1 按钮（而非标题带空白处）     | 点击生效，不触发窗口拖动                                              |
| S7  | 自动折叠（conversation < 360px）   | 同样折叠为 rail，而非 4px 空条                                        |
| S8  | 窗口最大化                         | 侧栏宽度不变（折叠态 36px / 展开态用户值），不被拉伸                  |
| S9  | 键盘 `toggleSidebar` 快捷键        | 与按钮行为一致                                                        |

## 6. 未覆盖 / 风险

- **无 UI 自动化测试**：仓库内不存在任何 `*.test.tsx`，也没有 Playwright 配置（与 `pentest-orchestration.md` P5 同一缺口）。S1–S9 只能人工验证，不能写成"通过"。
- **不处理另两条相邻问题**（本次范围外，需各自立项）：
  - 自动折叠只监听 `window.resize`，不监听 conversation 自身变窄（`WorkspaceShellLayout.tsx:524` 与 `:493-494` 注释）。拖宽侧栏或打开右侧面板不会触发自动折叠。
  - 已保存的 `embeddedBrowserViewportPreference.mode === "responsive"` 会让内嵌浏览器在每次加载重新进入设备模拟，叠加 `browserViewportZoom.ts:46` 的 `Math.min(1, …)` 上限，窗口最大化仍呈矩形。
