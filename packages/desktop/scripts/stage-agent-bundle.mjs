// Agent bundle 的暂存动作：把 apps/zcode-cli/packages/cli/dist/zcode.cjs 放进
// bundled-agents/<平台>/glm，并写 meta。
//
// dev 与打包**必须**用同一份暂存实现。
// 只有打包链（prepare-agent-node-bundle.mjs）会暂存是不够的，dev 链
// （scripts/build-desktop-agent-cli.mjs）不会；而 dev 未打包时的 agent 二进制由
// desktopRuntimeEnv.ts 的 resolveBundledZCodeAgentBinaryPath() 解析，候选**只有**
// bundled-agents/，没有 cli/dist/。于是 dev 一直跑着上一次打包时留下的那份 ——
// 实测陈旧 3 天，任何 agent CLI 侧改动在 dev 里静默不生效，排查时会把「改动没生效」
// 误判成「代码没起作用」。两边共用这一份，dev 与打包不可能再各自漂移。
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const AGENT_BUNDLE_SOURCE_RELATIVE = "apps/zcode-cli/packages/cli/dist/zcode.cjs";
// --prepare-storage 的独立入口。resolver 找不到它时会回退 zcode.cjs（见
// packages/services/src/zcode-agent/zcodeAgentProcessManager.ts），因此这里按可选处理，
// 缺失只告警不阻断构建。
export const AGENT_STORAGE_PREP_SOURCE_RELATIVE =
  "apps/zcode-cli/packages/cli/dist/zcode.storage-prep.cjs";

export function resolveAgentBundlePaths({ repoRoot, platformKey }) {
  const glmDir = resolve(repoRoot, "packages", "desktop", "bundled-agents", platformKey, "glm");
  return {
    cliBundlePath: resolve(repoRoot, AGENT_BUNDLE_SOURCE_RELATIVE),
    cliStoragePrepPath: resolve(repoRoot, AGENT_STORAGE_PREP_SOURCE_RELATIVE),
    glmDir,
    stagedBundlePath: resolve(glmDir, "zcode.cjs"),
    stagedStoragePrepPath: resolve(glmDir, "zcode.storage-prep.cjs"),
    stagedMetaPath: resolve(glmDir, ".node-bundle-meta.json"),
  };
}

/**
 * 干净重建 glm 目录再拷贝。清空是刻意的：electron-builder 整目录拷贝
 * bundled-agents/<平台>/glm → resources/glm，本地工作树里上一次构建残留的原生二进制
 * （zcode-agent / zcode-acp 等）和旧 meta 会被一并打进安装包（CI 干净检出不会有，本地会）。
 */
export function stageAgentBundle({ repoRoot, platformKey, log = console.log }) {
  const {
    cliBundlePath,
    cliStoragePrepPath,
    glmDir,
    stagedBundlePath,
    stagedStoragePrepPath,
    stagedMetaPath,
  } = resolveAgentBundlePaths({
    repoRoot,
    platformKey,
  });
  if (!existsSync(cliBundlePath)) {
    throw new Error(`[stage:agent-bundle] agent bundle 源产物不存在：${cliBundlePath}`);
  }
  rmSync(glmDir, { recursive: true, force: true });
  mkdirSync(glmDir, { recursive: true });
  copyFileSync(cliBundlePath, stagedBundlePath);
  // 缺失不阻断：resolver 会回退 zcode.cjs，只是拿不到那份体积收益。
  const storagePrepStaged = existsSync(cliStoragePrepPath);
  if (storagePrepStaged) copyFileSync(cliStoragePrepPath, stagedStoragePrepPath);
  const meta = {
    runtime: "electron-node",
    entry: "zcode.cjs",
    platform: platformKey,
    source: AGENT_BUNDLE_SOURCE_RELATIVE,
    storagePrepEntry: storagePrepStaged ? "zcode.storage-prep.cjs" : null,
  };
  writeFileSync(stagedMetaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  log(`[stage:agent-bundle] staged ${stagedBundlePath}`);
  if (storagePrepStaged) {
    log(`[stage:agent-bundle] staged ${stagedStoragePrepPath}`);
  } else {
    log(
      `[stage:agent-bundle] 未找到 ${AGENT_STORAGE_PREP_SOURCE_RELATIVE}，` +
        "存储准备将回退整包（体积收益缺失，功能不受影响）",
    );
  }
  return { stagedBundlePath, stagedMetaPath, stagedStoragePrepPath };
}
