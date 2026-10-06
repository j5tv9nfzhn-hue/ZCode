import type { ZCodeRuntimeEnv } from "./runtimeEnv.js";

export type ZCodeEnv = "test" | "production";
/** 安装包身份：决定应用名、app id、Electron 数据目录与更新策略；与后端环境 `ZCodeEnv` 是两个轴。 */
export type ZCodeProductFlavor = "production" | "preview";
export type ArmsRumEnv = "local" | "prod";

// 非构建环境（如 e2e 测试的 mocha）下 define 不存在，用 typeof 检查 + fallback 避免 ReferenceError
declare const __ZCODE_ENV__: string;
declare const __ZCODE_PRODUCT_FLAVOR__: string;

export function normalizeZCodeEnv(value: string | undefined): ZCodeEnv {
  return value?.trim().toLowerCase() === "production" ? "production" : "test";
}

export const ZCODE_ENV = normalizeZCodeEnv(
  typeof __ZCODE_ENV__ !== "undefined" ? __ZCODE_ENV__ : undefined,
);

/**
 * 身份缺省跟随后端环境（test → preview，production → production）。
 * 桌面构建通过 `ZCODE_PREVIEW_IDENTITY=1` 显式注入 preview，得到连接生产后端的 Preview 包；
 * 未注入 define 的 bundle（web、CLI、测试）沿用旧的单轴语义。
 */
export function normalizeZCodeProductFlavor(
  value: string | undefined,
  zcodeEnv: ZCodeEnv,
): ZCodeProductFlavor {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "production" || normalized === "preview") {
    return normalized;
  }
  return zcodeEnv === "production" ? "production" : "preview";
}

export const ZCODE_PRODUCT_FLAVOR = normalizeZCodeProductFlavor(
  typeof __ZCODE_PRODUCT_FLAVOR__ !== "undefined" ? __ZCODE_PRODUCT_FLAVOR__ : undefined,
  ZCODE_ENV,
);
export const ZCODE_APP_VERSION_ENV = "ZCODE_APP_VERSION" as const;
export const ZCODE_BUILD_COMMIT_ID_ENV = "ZCODE_BUILD_COMMIT_ID" as const;

// ── 运行时环境变量（不经过编译打包，启动时从 process.env 读取） ──
// 启用调试模式，值为 inspect-brk 的端口号，如 ZCODE_DEBUG=9230
export const RUNTIME_ZCODE_DEBUG =
  typeof process !== "undefined" ? process.env.ZCODE_DEBUG : undefined;

// ── 遥测总开关：本地构建已强制关闭 ──
//
// 本仓库基于 ZCode 上游 3.14.3 派生（自用分支版本号见根 package.json，当前 3.14.4），
// **刻意关闭全部出网遥测**。
//
// 背景（2026-09 公开事件，非推测）：官方版本曾被发现在用户登录状态下，把整个工作区
// （完整源码 + .git 历史 + LFS 缓存 + reflog + 全局配置）打包加密上传至阿里云 OSS，
// 加密私钥仅存云端、用户无法解密，且默认开启、客户端无关闭入口。官方于 3.14.0 移除
// 该链路并开源，但本文件历史上出现过「把开关改成 false 后又恢复成 true」的痕迹
// （见下方 git 历史），说明该开关并非稳定承诺。
//
// 因此这里不做「未配置端点即停用」这种隐式依赖，而是**直接关闭总开关**：
// 4 个出网点全部是 `ZCODE_TELEMETRY_ENABLED && <端点非空>` 的短路形式
// （telemetryCore / appARMSBootstrap / main index 两处），置 false 即全链路断开。
//
// 被关闭的具体上报：数仓事件上报（含 device_mid、mac_id、marketing_params、
// clientTimezone 时区定位、clientLanguage、screenResolution 设备指纹、
// talk_id/message_id）、ARMS RUM（崩溃、长任务、网络、资源、MCP 遥测）。
//
// 要恢复请先评估隐私影响，不要只把这一行改回 true。
export const ZCODE_TELEMETRY_ENABLED: boolean = false;

/** 数仓事件上报端点：由运行时环境变量提供，未配置即停用，构建产物不内嵌。 */
export const ZCODE_TELEMETRY_REPORT_ENDPOINT =
  typeof process !== "undefined" ? (process.env.ZCODE_TELEMETRY_REPORT_ENDPOINT ?? "") : "";

/** ARMS RUM 接入端点：由运行时环境变量提供，未配置即停用，构建产物不内嵌。 */
export const ZCODE_ARMS_RUM_ENDPOINT =
  typeof process !== "undefined" ? (process.env.ZCODE_ARMS_RUM_ENDPOINT ?? "") : "";

/** 将本地运行态与编译期 ZCODE_ENV 映射为 ARMS 控制台识别的上报环境标签 */
export function mapZCodeEnvToArmsRumEnv(runtimeEnv: ZCodeRuntimeEnv): ArmsRumEnv {
  return runtimeEnv !== "development" && ZCODE_ENV === "production" ? "prod" : "local";
}
