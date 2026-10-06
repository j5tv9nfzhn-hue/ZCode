/**
 * 单测的 ESM 解析钩子（配合 `tsx --test` 使用）。
 *
 * 只解决一件事：`@/` 路径别名。
 *
 * 背景：仅 `packages/ui/tsconfig.json` 声明了 `@/* → ./src/*`，是全仓唯一别名。
 * tsx 从被加载文件所在目录向上找最近的 `tsconfig.json` 读 paths，而各包的
 * `include` 只覆盖 `src/**`、仓库根又只有 `tsconfig.base.json` 没有
 * `tsconfig.json`，于是 paths 完全没被加载，`packages/ui` 源码里的 `@/lib/...`
 * 在测试中报 ERR_MODULE_NOT_FOUND。
 *
 * 为什么不用 tsx 自己的 `--tsconfig`：一次只能给一个文件，而这个仓库每个包的
 * 别名都可能不同（当前只有 ui 有，但机制上不保证）。
 *
 * **不要**在这里做 `.js` → `.ts` 的映射：tsx 已经处理了这件事，且做得比手写更准
 * （它按包边界和 tsconfig 推断）。曾经试过用 Node 原生 `--test` 替代 tsx，结果撞上
 * strip-only 模式不支持 TypeScript 参数属性（`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`），
 * 而本仓库多处使用构造函数参数属性——所以测试运行器必须是 tsx。
 *
 * 用法：tsx --import ./scripts/test/resolve-test-aliases.mjs --test <files>
 */
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const UI_SRC = join(repoRoot, "packages", "ui", "src");

/** 别名目标可能带 `.js` 后缀（NodeNext 约定）或不带；两种都要能找到磁盘上的 `.ts`/`.tsx`。 */
function resolveSourceFile(basePath) {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    join(basePath, "index.ts"),
    join(basePath, "index.tsx"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const resolved = resolveSourceFile(join(UI_SRC, specifier.slice(2)));
      if (resolved) {
        return { url: pathToFileURL(resolved).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});
