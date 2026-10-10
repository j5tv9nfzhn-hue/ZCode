import { lazy } from "react";

/**
 * SettingsPage 是 2000+ 行的设置区入口，只有用户在设置 tab 激活时才渲染。
 *
 * 静态 import 会把它连同它引用的全部设置分区拉进主 bundle，冷启动时为主程序
 * 多数会话都用不到的一块代码付解析/编译成本。改为 lazy：只有真正打开设置时
 * 才加载对应 chunk。
 *
 * 两个渲染点（无工作区时 Root 的分支、有工作区时 WorkspaceSettingsLayer）
 * 共用这一个模块，动态 import 的目标一致，打包器只会产出一个 chunk。
 */
export const LazySettingsPage = lazy(() =>
  import("@/SettingsPage.js").then((module) => ({ default: module.SettingsPage })),
);

// 注：SSHDialog / DirectoryBrowser 曾是 lazy 候选，但核对后放弃——
// SSHDialog 被 ChatEmptyState（WorkspaceShellLayout 静态引入的主路径）静态 import，
// DirectoryBrowser 被 RemoteConnectionDialogContent（经 SSHDialog 链）静态 import，
// 两者本来就在主 bundle 里，在 Root 单独 lazy 只会多一层 Suspense 而不减体积。
