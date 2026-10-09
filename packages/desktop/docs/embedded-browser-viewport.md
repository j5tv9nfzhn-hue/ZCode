# 嵌入式浏览器 viewport 默认值（normal vs responsive）

## 1. 现象

内置浏览器自动化技能激活后，side browser panel 只在窗口中间显示一块，缩放窗口不填满。

## 2. 根因（两条对称的强制默认）

普通浏览本应是 `mode: "normal"`（自然尺寸、满幅）。但有两处把 agent 打开的 tab
无条件推进了 responsive 设备模拟画布：

| #   | 位置                                                                | 行为                                                                               |
| --- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1   | `packages/desktop/src/main/browserView/browserGuestManager.ts:2560` | tab 创建即写 `viewportOverride: { ...DEFAULT_AGENT_BROWSER_VIEWPORT }`（1280×720） |
| 2   | `packages/ui/src/browser-use/HumanBrowserView.tsx:41-45`            | `agentOpened` 时硬编码 `mode: "responsive"` + 同一默认 viewport                    |

传播链（主进程侧）：

```
:2560 种默认 → :748  guest attach 时重放 → onViewportChanged
→ index.ts:378-390 IPC → preload:411-417 → desktopBrowserPlatformBridge.ts:37-38
→ useResponsiveBrowserViewportControl.ts:125-132  applyResponsiveMode(true)
→ ResponsiveBrowserViewport.tsx:310-315  居中 flex + p-4
→ :317-331  外层 frame 写死 px
→ browserViewportZoom.ts:46  Math.min(1, available/wanted)  ← 缩放上限锁死 1，永不填满
```

`Math.min(1, ...)` 是「永远留白」的直接原因：窗口再大也只能把 1280×720 等比放到 100%。

**佐证**：`browser-use-plugin/docs/viewport.md:3` 明确写「只在 responsive / 设备尺寸测试时
用显式 viewport，否则保持 normal IAB viewport」，而代码对**所有** agent tab 无条件套默认值。
即普通浏览实际上拿不到 normal viewport。

## 3. 方案

删掉这两处**创建期**默认，不改任何运行时显式请求：

- agent 通过 `browserViewUpdateViewport` 主动请求尺寸时，链路不变
  （`useResponsiveBrowserViewportControl.ts:85` → setResponsiveViewportSize + applyResponsiveMode）。
- 人工浏览继续走 `settings.embeddedBrowserViewportPreference ?? { mode: "normal" }`。
- `agentOpened` 与人工路径收敛到同一条默认。

**刻意不动**的地方：

- `browserGuestManager.ts:2039`（`runRecording`）的默认 viewport **保留**。录制需要确定性表面
  尺寸，且 `:2048` 保存录制前值、`restoreRecordingViewport:2157` 在无前置 override 时正确调
  `resetTabViewport` 并下发 `null`，不残留幽灵 override。
- `HumanBrowserView.tsx` 的偏好持久化（`commitPreference`）不动。

## 4. 不变量

1. **agent 显式请求 viewport 仍然生效**：请求会同时设置尺寸与 responsive 模式。
2. **录制表面尺寸不受影响**：`runRecording` 仍以默认 1280×720 取景，结束后恢复原状。
3. **截图不退化**：`browserGuestManager.ts:3464` 只在存在 override 时重放 device metrics；
   无 override 时 guest 用自然尺寸，不会退化成手机尺寸（`:2085` 的 DEFAULT_RESPONSIVE 是
   renderer 侧 responsive 画布的默认，不是截图取景源）。
4. **持久化兼容**：恢复路径 `:942` 已处理 `record.viewport` 为 null 的情形。
5. **既有用户必须拿到修复**：老 profile 里持久化的正是被误种的 1280×720。若照原值恢复，
   修复对老用户不生效（表现为「改了却没变化」）。恢复时要把「等于默认值」的持久化 viewport
   视为「从未设置」丢弃。

## 5. 验收

| #   | 场景                                | 期望                                                              |
| --- | ----------------------------------- | ----------------------------------------------------------------- |
| V1  | agent 打开 tab，未请求 viewport     | 主进程 `viewportOverride` 为 undefined；renderer 落在 normal 模式 |
| V2  | agent 打开 tab 后请求 800×600       | 进入 responsive，frame 800×600                                    |
| V3  | 无 override 时截图                  | 走自然尺寸，不套 device metrics                                   |
| V4  | 录制（未指定 viewport）             | 仍以 1280×720 取景；结束后 reset 为自然尺寸                       |
| V5  | 老 profile 持久化 1280×720          | 恢复时丢弃，表现为 normal                                         |
| V6  | 老 profile 持久化 900×700（非默认） | 照原值恢复为 responsive（那是真实选择）                           |

## 6. 未验证

- 未在实机跑过：改的是 Electron main + renderer 启动行为，本机无桌面产物。
  验收 V1–V6 需在有产物的机器上执行。
- `useDefaultLayout`（react-resizable-panels）在不同窗口尺寸下是否把持久化布局解析成 px 并
  与 `defaultSize` 叠加，未能闭合（`node_modules` 未安装，读不到实现）。这是唯一可能残留
  「panel 本身横向偏移」的路径，与本 spec 解决的「panel 内居中卡片」是两个问题。
