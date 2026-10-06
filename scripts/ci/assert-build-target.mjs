/**
 * CI 强制约束：本仓库的流水线**只允许产出 Windows x64 产物**。
 *
 * 需求是「只产出 win 平台、amd64、产物仅本人使用」，所以这不是「默认配置成 Windows」，
 * 而是「任何偏离都在产物层面被机械拒绝」。理由有三：
 *
 * 1. `packages/desktop/scripts/bundle.mjs` 的默认值是 **mac / arm64**（见其 printHelp），
 *    不是 Windows。谁忘了传参就会静默打出一个 mac 包 —— 这正是需要被拦住的场景。
 * 2. 把约束写在 YAML 里是拦不住的：以后有人给 job 加一个 matrix、或改一行 runs-on，
 *    就多出一个平台。把约束写成产物校验，改 workflow 也绕不过去。
 * 3. 这个仓库已经在 afterPack 里做同类机械校验（assertPackagedNativeResourcePolicy /
 *    assertPackagedNodePtyPrebuild / requiredRuntimeModules 闭包），本脚本沿用同一取向。
 *
 * 用法：
 *   node scripts/ci/assert-build-target.mjs --preflight
 *   node scripts/ci/assert-build-target.mjs --artifacts <distDir>
 */

import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";

/** 目标平台。取自 mise.toml / 打包脚本的归一化结果（win + amd64 → win32-x64）。 */
const REQUIRED_PLATFORM = "win32";
const REQUIRED_ARCH = "x64";

/**
 * 接受的别名集合，与 `packages/desktop/scripts/target-platform.mjs` 的 normalizeTargetOs /
 * normalizeTargetArch 保持一致。少了这份等价，本脚本会把 `ZCODE_TARGET_OS=windows` 这类
 * 合法写法误判为越界，而打包脚本本身是接受的。
 */
const ACCEPTED_PLATFORM_ALIASES = new Set(["win32", "win", "windows"]);
const ACCEPTED_ARCH_ALIASES = new Set(["x64", "amd64", "x86_64"]);

/**
 * 允许的顶层产物扩展名。
 *
 * 与 `bundle.mjs` 的 artifactExtensionsByOs.win 保持一致（只允许 .exe）。
 * 刻意不列 .zip / .blockmap：win.nsis 只出 nsis 安装器，不出 zip。
 */
const ALLOWED_ARTIFACT_EXTENSIONS = [".exe"];

/**
 * 产物文件名里禁止出现的标记。
 *
 * `_TEST` 后缀来自 `resolveDesktopArtifactSuffix`（后端环境非 production 时追加），
 * `Preview` 来自 `resolveDesktopProductIdentity` 的 flavor。两者都意味着「这不是你要
 * 装的那个包」：身份变成 ZCode Preview / appId dev.zcode.app.preview，且连的是测试
 * 后端。它们的来源是 fail-safe 默认值——`ZCODE_ENV` 未设置或拼错就落到 test，
 * 而这种错误在日志里完全看不出来（打包会成功、产物名只是多个后缀）。
 * 所以在这里机械拒绝，而不是靠注释提醒。
 */
const FORBIDDEN_IDENTITY_TOKENS = ["_test", "preview"];

/**
 * 一旦出现就说明产物越界。electron-builder 的 mac/linux target 实测扩展名都在这里，
 * 另外显式拦 dmg 与 zip，避免有人给 win 段加 zip target 时悄悄带出第二个平台的格式。
 */
const FORBIDDEN_ARTIFACT_EXTENSIONS = [
  ".dmg",
  ".zip",
  ".appimage",
  ".deb",
  ".rpm",
  ".pkg.tar.zst",
  ".snap",
  ".flatpak",
];

/** 非 x64 架构标记。文件名里出现即视为越界（bundle.mjs 的产物名带 arch）。 */
const FORBIDDEN_ARCH_TOKENS = ["arm64", "aarch64"];

/** 产物文件名里出现即视为混入其他平台标签。 */
const FORBIDDEN_PLATFORM_TOKENS = ["mac", "darwin", "osx", "linux", "ubuntu", "debian", "fedora"];

/**
 * 故意**不**判为越界的顶层文件：这些是 electron-builder 对 nsis 产出的正常伴随文件，
 * 不带平台/架构语义，也不是安装包。
 */
const IGNORED_ARTIFACT_NAMES = new Set([
  "builder-debug.yml",
  "builder-effective-config.yaml",
  "latest.yml",
]);

/**
 * 按后缀忽略的伴随文件。
 *
 * nsis target 会为安装器产出 `.blockmap`（差分更新用的分块校验）。它既不是可交付文件，
 * 也不是「其他平台的产物」，所以按后缀忽略而不是判违规 —— 否则每次打包都会在这里红。
 */
const IGNORED_ARTIFACT_EXTENSIONS = new Set([".blockmap"]);

/**
 * 判定失败。
 *
 * 同时写 stdout 与 stderr：`process.exit` 紧随其后，pwsh 下 stderr 的内容有时来不及
 * 被 Actions 收集器取到，日志里只剩一句 "Process completed with exit code 1"，
 * 完全看不出是哪条约束被违反。写 stdout 保证原因一定进日志。
 */
function fail(lines) {
  const report = [
    "[assert-build-target] 违反 Windows x64 强制约束：",
    ...lines.map((line) => `  - ${line}`),
  ].join("\n");
  console.log(report);
  console.error(report);
  process.exit(1);
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function assertHostIsTarget() {
  const lines = [];
  if (process.platform !== REQUIRED_PLATFORM) {
    lines.push(
      `宿主平台是 ${process.platform}，要求 ${REQUIRED_PLATFORM}。` +
        "打包 job 的 runs-on 必须硬编码 Windows runner，不能是 matrix 或其他平台。",
    );
  }
  if (process.arch !== REQUIRED_ARCH) {
    lines.push(`宿主架构是 ${process.arch}，要求 ${REQUIRED_ARCH}（amd64）。`);
  }

  // 声明的打包目标同样要校验（若已设置）。打包脚本默认目标是 mac/arm64，
  // 漏设时靠宿主兜底尚可，但显式设错值必须当场拒绝——那会让原生资产与产物名同时跑偏。
  const declaredOs = process.env.ZCODE_TARGET_OS?.trim().toLowerCase();
  const declaredArch = process.env.ZCODE_TARGET_ARCH?.trim().toLowerCase();
  if (declaredOs && !ACCEPTED_PLATFORM_ALIASES.has(declaredOs)) {
    lines.push(`ZCODE_TARGET_OS=${declaredOs}，要求 ${REQUIRED_PLATFORM}。`);
  }
  if (declaredArch && !ACCEPTED_ARCH_ALIASES.has(declaredArch)) {
    lines.push(`ZCODE_TARGET_ARCH=${declaredArch}，要求 ${REQUIRED_ARCH}（amd64）。`);
  }

  if (lines.length > 0) {
    fail(lines);
  }
  console.log(
    `[assert-build-target] preflight ok: host=${process.platform}-${process.arch}` +
      ` target=${declaredOs ?? "<未设置，取宿主>"}-${declaredArch ?? "<未设置，取宿主>"}`,
  );
}

function extensionOf(fileName) {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot).toLowerCase();
}

async function assertArtifactsAreWindowsOnly(distDir) {
  const absoluteDist = resolve(distDir);
  let entries;
  try {
    entries = await readdir(absoluteDist, { withFileTypes: true });
  } catch (error) {
    fail([
      `读取产物目录失败：${absoluteDist}（${error instanceof Error ? error.message : error}）`,
    ]);
    return;
  }

  const violations = [];
  const accepted = [];

  for (const entry of entries) {
    // 只看顶层文件：win-unpacked/ 这类目录是 nsis 产物的解包中间态，不是交付物。
    if (!entry.isFile()) continue;
    const fileName = entry.name;
    if (IGNORED_ARTIFACT_NAMES.has(fileName.toLowerCase())) continue;

    const lower = fileName.toLowerCase();
    const extension = extensionOf(lower);

    if (IGNORED_ARTIFACT_EXTENSIONS.has(extension)) {
      continue;
    }

    if (FORBIDDEN_ARTIFACT_EXTENSIONS.includes(extension)) {
      violations.push(`${fileName}：扩展名 ${extension} 属于其他平台的 target`);
    }
    if (!ALLOWED_ARTIFACT_EXTENSIONS.includes(extension)) {
      violations.push(`${fileName}：扩展名 ${extension || "<无>"} 不在 Windows 允许清单内`);
    }
    for (const token of FORBIDDEN_ARCH_TOKENS) {
      if (lower.includes(token)) {
        violations.push(`${fileName}：文件名含非 x64 架构标记 "${token}"`);
      }
    }
    for (const token of FORBIDDEN_IDENTITY_TOKENS) {
      if (lower.includes(token)) {
        violations.push(
          `${fileName}：文件名含 "${token}"，说明产物是 Preview / 测试后端包而非正式版。` +
            "检查 job env 是否设置了 ZCODE_ENV=production（它对未知值 fail-safe 到 test）。",
        );
      }
    }
    for (const token of FORBIDDEN_PLATFORM_TOKENS) {
      if (lower.includes(token)) {
        violations.push(`${fileName}：文件名含其他平台标记 "${token}"`);
      }
    }
    if (violations.length === 0) {
      accepted.push(fileName);
    }
  }

  if (violations.length > 0) {
    fail(violations);
  }
  if (accepted.length === 0) {
    fail([
      `${absoluteDist} 下没有任何 .exe 产物。` +
        "若 electron-builder 改了产物名或写到子目录，需要同步更新本脚本的白名单。",
    ]);
  }

  console.log(
    `[assert-build-target] 产物校验通过（${accepted.length} 个，全部为 Windows x64 安装包）：`,
  );
  for (const fileName of accepted) {
    console.log(`  - ${join("dist", fileName)}`);
  }
}

async function main() {
  const mode = process.argv[2];
  if (mode === "--preflight") {
    assertHostIsTarget();
    return;
  }
  if (mode === "--artifacts") {
    const distDir = readOption("--artifacts");
    if (!distDir) {
      fail(["--artifacts 需要一个产物目录参数"]);
      return;
    }
    await assertArtifactsAreWindowsOnly(distDir);
    return;
  }
  fail(["用法：node scripts/ci/assert-build-target.mjs --preflight | --artifacts <distDir>"]);
}

await main();
