import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");
const defaultEntryPath = join(repoRoot, "apps/zcode-cli/packages/cli/dist/zcode.cjs");
const runtimeSourcePath = join(import.meta.dirname, "desktop-agent-bytecode-runtime.cjs");
const compilerPath = join(import.meta.dirname, "compile-desktop-agent-bytecode.cjs");

// 产物文件名按内容摘要命名，所以同名不同内容只可能来自被截断/损坏的历史残留。
// 默认构建链会反复跑这一步，若这种情况直接抛错，一次坏文件就会让后续每次重建都失败
// （必须人工删文件才能恢复）。这里自愈：删掉损坏文件后按本次产物原样重写，
// 仍然保持"先写不可变依赖、最后原子替换入口"的顺序语义。
async function publishImmutable(path, contents) {
  try {
    await writeFile(path, contents, { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if ((await readFile(path)).equals(contents)) return;
    console.warn(`[bytecode] 清理损坏的旧产物后重写: ${path}`);
    await rm(path, { force: true });
    await writeFile(path, contents, { flag: "wx" });
  }
}

export async function buildDesktopAgentBytecode({
  entryPath = defaultEntryPath,
  electronPath = createRequire(import.meta.url)("electron"),
  env = process.env,
} = {}) {
  if (env.ZCODE_E2E_COVERAGE === "1") throw new Error("coverage 构建不能启用字节码试验");
  const directory = dirname(entryPath);
  const temporary = join(directory, `.bytecode-${randomUUID()}`);
  const loaderPath = join(directory, "zcode.bytecode.cjs");
  try {
    const { stdout } = await execFileAsync(electronPath, [compilerPath, entryPath, temporary], {
      env: { ...env, ELECTRON_RUN_AS_NODE: "1", NODE_OPTIONS: "" },
      maxBuffer: 1024 * 1024,
    });
    const metadata = JSON.parse(stdout);
    const bytecodeFile = `zcode.bytecode-${metadata.bytecodeSha256}.jsc`;
    const bytecodePath = join(directory, bytecodeFile);
    const runtimeSource = await readFile(runtimeSourcePath);
    const runtimeHash = createHash("sha256").update(runtimeSource).digest("hex");
    const runtimeFile = `zcode.bytecode-runtime-${runtimeHash}.cjs`;
    metadata.bytecodeFile = bytecodeFile;
    metadata.sourceFile = basename(entryPath);
    // 先写不可变依赖，最后原子替换入口；失败时上次可用的加载器仍能找到自己的字节码。
    const runtimePath = join(directory, runtimeFile);
    await publishImmutable(bytecodePath, await readFile(temporary));
    await publishImmutable(runtimePath, runtimeSource);
    const loader = `#!/usr/bin/env node\n"use strict";\nconst metadata = ${JSON.stringify(metadata)};\nrequire(${JSON.stringify(`./${runtimeFile}`)}).loadBytecode(metadata, module, require).catch(error => {\n  process.stderr.write(String(error.stack ?? error) + "\\n");\n  process.exitCode = 1;\n});\n`;
    await writeFile(`${temporary}.cjs`, loader, { mode: 0o755 });
    await rename(`${temporary}.cjs`, loaderPath);
    // runtimePath 一并返回：默认打包链要把它和 loader/.jsc 一起复制到
    // bundled-agents/<platformKey>/glm，文件名只能从这里的哈希推导，不该在调用方重算。
    return { loaderPath, bytecodePath, runtimePath, metadata };
  } finally {
    await Promise.all([temporary, `${temporary}.cjs`].map((file) => rm(file, { force: true })));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const artifact = await buildDesktopAgentBytecode();
  console.log(JSON.stringify(artifact, null, 2));
}
