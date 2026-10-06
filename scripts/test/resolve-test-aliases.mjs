/**
 * 单测的路径别名解析器（配合 `node --test` 使用）。
 *
 * 为什么需要：仓库根原先没有 tsconfig.json（只有 tsconfig.base.json），而各包的
 * tsconfig.json 的 `include` 只覆盖 `src/**`。Node 从被加载文件所在目录向上找最近的
 * tsconfig 来解析 paths，测试文件位于 `packages/<pkg>/test/`，于是上溯到仓库根却什么
 * 都没找到，`packages/ui` 源码里的 `@/lib/...` 直接 ERR_MODULE_NOT_FOUND。
 *
 * `@/` 是全仓唯一的路径别名（仅 packages/ui/tsconfig.json 声明），权威定义仍在那里，
 * 这里只是让 Node 在测试环境下也能看见同一份映射。
 *
 * 另一个职责：把 `.js` 后缀的 import 指回磁盘上的 `.ts` / `.tsx`。Node 原生类型剥离
 * （Node 24 默认开启）只擦除类型语法、不改写 import 说明符，所以测试里的
 * `"../src/foo.js"` 需要在这里映射到 `foo.ts`。带上 `.js` 候选是为了兼容构建产物形态。
 *
 * 用法：node --import ./scripts/test/resolve-test-aliases.mjs --test <files>
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Module from "node:module";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const UI_SRC = join(repoRoot, "packages", "ui", "src");

/** import 带 .js 后缀但磁盘是 .ts/.tsx —— 仓库遵循 NodeNext 的 ESM 约定。 */
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

const originalResolveFilename = Module.defaultResolveFilename;
Module.defaultResolveFilename = function patchedResolveFilename(specifier, ...rest) {
  if (specifier.startsWith("@/")) {
    const resolved = resolveSourceFile(join(UI_SRC, specifier.slice(2)));
    if (resolved) {
      return originalResolveFilename.call(this, resolved, ...rest);
    }
  }
  // `.js` → `.ts` 回退：仅在原始解析失败后启用，避免改变已能正确解析的路径。
  if (specifier.startsWith(".") && specifier.endsWith(".js")) {
    try {
      return originalResolveFilename.call(this, specifier, ...rest);
    } catch (error) {
      const resolved = resolveSourceFile(specifier.slice(0, -".js".length));
      if (resolved) {
        return originalResolveFilename.call(this, resolved, ...rest);
      }
      throw error;
    }
  }
  return originalResolveFilename.call(this, specifier, ...rest);
};
