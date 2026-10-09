#!/usr/bin/env node

// 默认打包链的桌面 agent V8 字节码步骤。
//
// 为什么需要这一步：
// - 随包的 agent 是 `resources/glm/zcode.cjs`（约 29.5MB 未压缩 bundle）。
//   没有字节码时，每次冷启动都要让 V8 从头解析整份源码，这是 agent 就绪延迟的主要来源。
// - `scripts/build-desktop-agent-bytecode.mjs` 早已具备完整产出能力，但一直只有
//   `dev:desktop:bytecode` / `build:desktop-agent:bytecode` 两个手工入口，默认链从不调用，
//   于是安装包里从来没有字节码。本脚本把它接进 `@zcode/desktop` 的默认 build。
//
// 落点为什么是 bundled-agents/<platformKey>/glm：
// electron-builder.config.js 的 extraResources 直接把 `bundled-agents/<platformKey>/glm`
// 整目录拷成 `resources/glm`（filter `**/*`），所以暂存目录就是打包产物目录，
// 运行时加载器（scripts/desktop-agent-bytecode-runtime.cjs:33-45）按
// `dirname(targetModule.filename)` 找同目录的 `zcode.bytecode-*.jsc`，天然命中。
//
// 执行位置（顺序契约）：
//   prepare:runtime-assets → prepare:agent-bundle（构建 cli/dist/zcode.cjs 并 stageAgentBundle）
//   → prepare:agent-bytecode（本脚本）→ build:no-runtime-assets → electron-builder
// 必须排在 prepare:agent-bundle 之后：字节码要从最终 zcode.cjs 编译，且要和已 stage 的
// bundle 放进同一个目录；早一步会编译上一轮残留的 bundle。

import process from "node:process";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildDesktopAgentBytecode } from "./build-desktop-agent-bytecode.mjs";
import { getTargetPlatform } from "../packages/desktop/scripts/target-platform.mjs";
import { resolveAgentBundlePaths } from "../packages/desktop/scripts/stage-agent-bundle.mjs";

// 本文件位于仓库根的 scripts/，故只回退一级。
// 曾经误写成 "..", ".."（那是从 packages/desktop/scripts/ 复制过来的形状），
// 于是 repoRoot 落到仓库的父目录，require 解析不到 electron，本步骤静默 skip，
// 默认打包链白挂了字节码而无人察觉。这里保留显式断言让同类错误立刻暴露。
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopRoot = join(repoRoot, "packages", "desktop");
if (!existsSync(join(desktopRoot, "package.json"))) {
  throw new Error(
    `[prepare:agent-bytecode] 仓库根解析错误：repoRoot=${repoRoot}` +
      `（期望其下存在 packages/desktop/package.json）。本文件在 scripts/ 内，应只回退一级。`,
  );
}
// 与 packages/desktop/package.json 里 electron 的解析起点保持一致，
// 保证编译器就是 electron-builder 打进安装包的那份 Electron runtime。
const requireFromDesktop = createRequire(join(desktopRoot, "package.json"));

const SKIP_ENV_VAR = "ZCODE_SKIP_DESKTOP_AGENT_BYTECODE";
const BYTECODE_ENTRY_FILE = "zcode.bytecode.cjs";
const BYTECODE_CACHE_PREFIX = "zcode.bytecode-";
const BYTECODE_RUNTIME_PREFIX = "zcode.bytecode-runtime-";

/**
 * 显式跳过（开关/coverage 构建）：这是使用者的主动选择，记 info 即可。
 *
 * 与 `skipBlocked` 区分的原因：曾经所有跳过路径都走 console.log 且不报错，
 * 于是「因为路径写错而没能编译」和「使用者主动关闭」在构建输出里长得一模一样，
 * 字节码因此长期没有进过安装包而无人发现。
 */
function skip(reason) {
  console.log(`[prepare:agent-bytecode] skip: ${reason}`);
}

/**
 * 前置条件不满足导致的跳过：产物将**缺少**字节码。
 * 必须走 stderr 且措辞表明这是降级，否则默认打包链会在无声中丢掉这项优化。
 */
function skipBlocked(reason) {
  console.warn(
    `[prepare:agent-bytecode] 降级：跳过字节码编译（产物不含 zcode.bytecode.cjs）。${reason}`,
  );
}

/**
 * 字节码的可执行性取决于 Electron/Node/V8 版本与 platform/arch
 * （scripts/desktop-agent-bytecode-runtime.cjs:28 会逐项比对，platform/arch 不一致直接抛错）。
 * 交叉打包产出的字节码在本机 runtime 上必定被拒，所以这里在生成前就拦掉。
 */
function resolveTargetPlatformOrSkip() {
  const target = getTargetPlatform();
  if (target.os !== process.platform || target.arch !== process.arch) {
    skipBlocked(
      `宿主 ${process.platform}-${process.arch} 与目标 ${target.key} 不一致，` +
        "跨平台编译出的字节码运行时会因 platform/arch 不匹配被拒绝；请在目标平台上打包。",
    );
    return null;
  }
  return target;
}

/**
 * electron-builder.config.js 把 electronVersion 写死，@zcode/desktop 的 electron 依赖是
 * 另一个来源。两者漂移时编译出的字节码在安装包里必定加载失败（而且要等到用户点开 agent
 * 才暴露），所以在打包阶段就机械比对一次。
 */
function assertElectronRuntimeIdentityMatches() {
  const configSource = readFileSync(join(desktopRoot, "electron-builder.config.js"), "utf8");
  const configured = configSource.match(/electronVersion:\s*["']([^"']+)["']/)?.[1];
  if (!configured) {
    console.warn(
      "[prepare:agent-bytecode] 无法从 electron-builder.config.js 解析 electronVersion，跳过一致性校验",
    );
    return;
  }
  const installed = requireFromDesktop("electron/package.json").version;
  if (installed !== configured) {
    throw new Error(
      `Electron 版本漂移：本地 electron=${installed}，electron-builder electronVersion=${configured}。` +
        "字节码会在安装包运行时被拒绝，请先对齐这两个版本。",
    );
  }
}

function resolveElectronBinaryOrSkip() {
  let electronPath;
  try {
    electronPath = requireFromDesktop("electron");
  } catch (error) {
    skipBlocked(
      `本地 electron 未安装，无法编译字节码：${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
  if (!existsSync(electronPath)) {
    skipBlocked(`electron 二进制缺失（未下载 dist），无法编译字节码：${electronPath}`);
    return null;
  }
  return electronPath;
}

/**
 * cli/dist 会残留上一轮的 `zcode.bytecode-*.jsc`（内容寻址，改一次 bundle 就多一份十几 MB）。
 * 这里只保留本次产出的文件，避免开发机反复重建把磁盘堆满。
 */
function removeSupersededCacheArtifacts(sourceDirectory, keepFileNames) {
  for (const entry of readdirSync(sourceDirectory, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const { name } = entry;
    const isCache = name.startsWith(BYTECODE_CACHE_PREFIX) && name.endsWith(".jsc");
    const isRuntime = name.startsWith(BYTECODE_RUNTIME_PREFIX) && name.endsWith(".cjs");
    if ((!isCache && !isRuntime) || keepFileNames.has(name)) continue;
    rmSync(join(sourceDirectory, name), { force: true });
  }
}

/** 把 loader / .jsc / runtime 三个文件复制到已 stage 的 bundle 旁边，并更新 meta。 */
function stageBytecodeIntoBundleDir({ targetPlatformKey, artifact }) {
  const { stagedBundlePath, stagedMetaPath } = resolveAgentBundlePaths({
    repoRoot,
    platformKey: targetPlatformKey,
  });
  if (!existsSync(stagedBundlePath)) {
    throw new Error(
      `[prepare:agent-bytecode] 缺少已 stage 的 agent bundle：${stagedBundlePath}。` +
        "字节码必须排在 prepare:agent-bundle 之后生成。",
    );
  }

  const stagedDir = dirname(stagedBundlePath);
  const staged = [
    [artifact.loaderPath, BYTECODE_ENTRY_FILE],
    [artifact.bytecodePath, basename(artifact.bytecodePath)],
    [artifact.runtimePath, basename(artifact.runtimePath)],
  ];
  for (const [source, targetName] of staged) {
    copyFileSync(source, join(stagedDir, targetName));
  }

  removeSupersededCacheArtifacts(
    dirname(artifact.loaderPath),
    new Set(staged.map(([, targetName]) => targetName)),
  );

  if (existsSync(stagedMetaPath)) {
    const meta = JSON.parse(readFileSync(stagedMetaPath, "utf8"));
    writeFileSync(
      stagedMetaPath,
      `${JSON.stringify(
        {
          ...meta,
          bytecodeEntry: BYTECODE_ENTRY_FILE,
          bytecodeBytes: artifact.metadata.bytecodeBytes,
          bytecodeRuntime: artifact.metadata.runtime,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  for (const [source, targetName] of staged) {
    const megabytes = (statSync(source).size / 1024 / 1024).toFixed(2);
    console.log(`[prepare:agent-bytecode] staged ${targetName} (${megabytes} MB) -> ${stagedDir}`);
  }
}

if (process.env[SKIP_ENV_VAR] === "1") {
  skip(`${SKIP_ENV_VAR}=1`);
} else if (process.env.ZCODE_E2E_COVERAGE === "1") {
  // 与 buildDesktopAgentBytecode 的判定一致：coverage 构建明确不启用字节码。
  // 默认链在这里降级为跳过，而不是把整个构建打挂。
  skip("ZCODE_E2E_COVERAGE=1");
} else {
  const targetPlatform = resolveTargetPlatformOrSkip();
  const electronPath = targetPlatform ? resolveElectronBinaryOrSkip() : null;
  if (targetPlatform && electronPath) {
    assertElectronRuntimeIdentityMatches();
    const artifact = await buildDesktopAgentBytecode({ electronPath });
    stageBytecodeIntoBundleDir({ targetPlatformKey: targetPlatform.key, artifact });
    console.log(`[prepare:agent-bytecode] ready for ${targetPlatform.key}`);
  }
}
