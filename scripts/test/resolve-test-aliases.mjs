/**
 * 单测的 ESM 解析钩子（配合 `node --test` 使用）。
 *
 * 解决两件事：
 *
 * 1. `.js` 后缀的 import 指回磁盘上的 `.ts` / `.tsx`。
 *    仓库遵循 NodeNext 的 ESM 约定——源码里互相 import 时写 `"./foo.js"`
 *    （`packages/shared/src/index.ts` 就是 `from "./resource-budget.js"`），
 *    但磁盘上只有 `foo.ts`。Node 原生类型剥离（Node 24 默认开启）只擦除类型语法，
 *    **不改写 import 说明符**，因此直接跑会 ERR_MODULE_NOT_FOUND。
 *
 * 2. `@/` 路径别名。
 *    仅 `packages/ui/tsconfig.json` 声明了 `@/* → ./src/*`，是全仓唯一别名。
 *    Node 不读 tsconfig 的 paths（那需要打包器或 loader 插件），所以测试环境要手工映射。
 *
 * 为什么用 `module.registerHooks` 而不是 monkey-patch `Module.defaultResolveFilename`：
 * 仓库所有包都是 `"type": "module"`，走的是 **ESM loader**；`defaultResolveFilename`
 * 是 CommonJS 的解析入口，ESM 根本不经过它，hook 上去不会生效。
 * `registerHooks`（Node 22.15+/24）提供的 `resolve` 才是 ESM 同步解析链上的钩子。
 *
 * 用法：node --import ./scripts/test/resolve-test-aliases.mjs --test-isolation=none --test <files>
 *
 * `--test-isolation=none` 是必需的：node --test 默认以 `process` 隔离运行每个测试文件，
 * 即为每个文件派生独立子进程，而 `--import` 注册的钩子**不会**被这些子进程继承，
 * 于是钩子完全不生效（表现为 `.js` / `@/` 仍是 ERR_MODULE_NOT_FOUND）。
 * 改成 none 后所有测试文件与钩子在同一进程内，钩子才真正被加载。
 */
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const UI_SRC = join(repoRoot, "packages", "ui", "src");

/** import 说明符写 `.js`，磁盘是 `.ts`/`.tsx`；同时支持目录的 index 形式。 */
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
    // 1) `@/` 别名
    if (specifier.startsWith("@/")) {
      const resolved = resolveSourceFile(join(UI_SRC, specifier.slice(2)));
      if (resolved) {
        return { url: pathToFileURL(resolved).href, shortCircuit: true };
      }
    }

    // 2) `.js` → `.ts`/`.tsx`。仅在默认解析失败后才回退，避免改变本来就能解析的路径
    //    （例如指向真实构建产物的 .js）。
    if (specifier.endsWith(".js")) {
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        const resolved = resolveSourceFile(specifier.slice(0, -".js".length));
        if (resolved) {
          return { url: pathToFileURL(resolved).href, shortCircuit: true };
        }
        throw error;
      }
    }

    return nextResolve(specifier, context);
  },
});
