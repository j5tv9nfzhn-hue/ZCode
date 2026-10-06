import type { BundledLanguage, BundledTheme, HighlighterGeneric, ThemedToken } from "shiki";
import { bundledLanguages, bundledLanguagesInfo, createHighlighter } from "shiki";
import { logger } from "@/logger.js";
import { uiMemoryDiagnosticsRegistry } from "@/lib/memoryDiagnostics.js";
import { createBoundedStateMap } from "@/lib/boundedStateMap.js";

export interface TokenizedCode {
  tokens: ThemedToken[][];
  fg: string;
  bg: string;
}

const bundledLanguageIds = new Set(Object.keys(bundledLanguages));
const bundledLanguageAliases = new Map(
  bundledLanguagesInfo.flatMap((info) =>
    (info.aliases ?? []).map((alias) => [alias, info.id] as const),
  ),
);
const FALLBACK_CODE_LANGUAGE: BundledLanguage = "log";
const PLAIN_TEXT_CODE_LANGUAGES = new Set([
  "",
  "text",
  "txt",
  "plain",
  "plaintext",
  "log",
  "output",
]);

/**
 * 真正启用语法高亮的语言白名单（Shiki 的 canonical id）。
 *
 * 为什么不直接放开 `bundledLanguageIds`（约 200 个语言）：`createHighlighter` 是
 * **每个语言一个实例**，首次使用还要把 TextMate 语法编译成正则。这两件事都发生
 * 在 **renderer 主线程**上（见 highlightCode——本模块没有 Worker）。
 * 在 2 物理核、无睿频的老机器上，一段会话里出现十来个冷门语言（nim / elixir /
 * jinja / crystal …）就意味着十几次主线程 WASM 编译，加上十来个各自持有语法与
 * 引擎的 Highlighter 实例常驻——这是「打开一个长会话后机器变慢」的典型来源。
 *
 * 白名单覆盖 Agent 实际会吐代码块的语言；名单外一律按纯文本渲染（与未知语言、
 * log 输出的既有降级路径完全一致，不新增失败模式）。要加语言只改这一个数组。
 */
const HIGHLIGHTED_LANGUAGE_IDS = new Set<string>([
  // Web
  "javascript",
  "jsx",
  "typescript",
  "tsx",
  "html",
  "css",
  "scss",
  "less",
  "json",
  "jsonc",
  "yaml",
  "xml",
  "svg",
  "vue",
  "svelte",
  // 脚本
  "python",
  "ruby",
  "php",
  "perl",
  "lua",
  "r",
  "julia",
  "bash",
  "sh",
  "zsh",
  "fish",
  "powershell",
  "batch",
  "vb",
  // 编译型
  "c",
  "cpp",
  "csharp",
  "java",
  "kotlin",
  "scala",
  "go",
  "rust",
  "zig",
  "swift",
  "objective-c",
  "dart",
  "groovy",
  "haskell",
  "elixir",
  "erlang",
  "clojure",
  "ocaml",
  "fsharp",
  // 标记与数据
  "markdown",
  "mdx",
  "latex",
  "tex",
  "rst",
  "sql",
  "graphql",
  "protobuf",
  "toml",
  "ini",
  "diff",
  // 构建与配置
  "dockerfile",
  "makefile",
  "cmake",
  "nginx",
  "terraform",
  "hcl",
]);

/**
 * 开发期自检：白名单是手写的 canonical id，而 Shiki 升级可能改名或删除某个语言。
 * 一个拼错或已下线的 id 会让该语言**静默降级成纯文本**——没有报错、只有「怎么不高亮了」。
 * 这里在开发构建下把对不上的 id 报出来，让问题在开发期就暴露。
 * 未知语言本来就走纯文本降级，所以这段检查只影响可观测性，不影响运行时正确性。
 */
if (import.meta.env.DEV) {
  const unknownIds = [...HIGHLIGHTED_LANGUAGE_IDS].filter((id) => !bundledLanguageIds.has(id));
  if (unknownIds.length > 0) {
    logger.warn(
      "[ShikiHighlighter] 高亮白名单里有 Shiki 不认识的语言 id（高亮会静默降级为纯文本）：",
      unknownIds,
    );
  }
}

export function shouldUseSyntaxHighlighting(language: string): boolean {
  const candidate = language.trim().toLowerCase();
  if (PLAIN_TEXT_CODE_LANGUAGES.has(candidate)) {
    return false;
  }

  // 别名先归一到 canonical id 再查白名单：模型常写 ```bash / ```sh / ```zsh。
  const canonical = bundledLanguageAliases.get(candidate) ?? candidate;
  if (!bundledLanguageIds.has(canonical)) {
    return false;
  }
  return HIGHLIGHTED_LANGUAGE_IDS.has(canonical);
}

function normalizeCodeLanguage(language: string): BundledLanguage {
  const candidate = language.trim().toLowerCase();
  if (!candidate) {
    return FALLBACK_CODE_LANGUAGE;
  }

  const alias = bundledLanguageAliases.get(candidate);
  if (alias && bundledLanguageIds.has(alias)) {
    return alias as BundledLanguage;
  }

  if (bundledLanguageIds.has(candidate)) {
    return candidate as BundledLanguage;
  }

  return FALLBACK_CODE_LANGUAGE;
}

/**
 * 常驻 Highlighter 实例数上限。
 *
 * 一个实例 = 一个语言 + 一个主题，各自持有语法与编译后的正则，且本模块跑在
 * renderer 主线程（没有 Worker）。键空间是 `theme:language`，本身有限（白名单约 60
 * 个语言 × 2 主题），但每条都很重，200 个语言全用一遍就是 200 个实例。
 * 这里用近似 LRU 限制规模：淘汰后重新高亮只是多一次主线程编译，不影响正确性；
 * 已在飞的 `createHighlighter` promise 由调用方的闭包持有，不受淘汰影响。
 */
const MAX_HIGHLIGHTER_CACHE_ENTRIES = 16;
const highlighterCache = createBoundedStateMap<
  Promise<HighlighterGeneric<BundledLanguage, BundledTheme>>
>(MAX_HIGHLIGHTER_CACHE_ENTRIES);
/**
 * 已分词结果的缓存条数上限。
 *
 * cacheKey 已经是 `theme:language:length:首100字符:尾100字符` 的定长摘要（见
 * getCodeTokensCacheKey），键本身不会膨胀；真正会随长会话单调增长的是条数，
 * 而每条都持有整段代码的分词结果。这里用近似 LRU 限制规模：淘汰后重新高亮
 * 只是多一次 CPU，不影响正确性。等待中的订阅者走独立的 subscribers 表，不受影响。
 */
const MAX_TOKENS_CACHE_ENTRIES = 512;
const tokensCache = createBoundedStateMap<TokenizedCode>(MAX_TOKENS_CACHE_ENTRIES);
const subscribers = new Map<string, Set<(result: TokenizedCode) => void>>();
// 内存诊断计数器：tokensCache 已加容量上限，条数可用于确认是否长期贴顶。
uiMemoryDiagnosticsRegistry.register("shiki", () => ({
  tokensCache: tokensCache.size,
  highlighters: highlighterCache.size,
  highlighterCap: MAX_HIGHLIGHTER_CACHE_ENTRIES,
}));

const getResolvedCodeTheme = (theme?: BundledTheme): BundledTheme => {
  if (theme) {
    return theme;
  }

  if (typeof document !== "undefined" && document.documentElement.classList.contains("dark")) {
    return "github-dark";
  }

  return "github-light";
};

const getCodeTokensCacheKey = (code: string, language: BundledLanguage, theme: BundledTheme) => {
  const start = code.slice(0, 100);
  const end = code.length > 100 ? code.slice(-100) : "";
  return `${theme}:${language}:${code.length}:${start}:${end}`;
};
const getHighlighter = (
  language: BundledLanguage,
  theme: BundledTheme,
): Promise<HighlighterGeneric<BundledLanguage, BundledTheme>> => {
  const cacheKey = `${theme}:${language}`;
  const cached = highlighterCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const highlighterPromise = createHighlighter({
    langs: [language],
    themes: [theme],
  });

  highlighterCache.set(cacheKey, highlighterPromise);
  return highlighterPromise;
};

const createRawCodeTokens = (code: string): TokenizedCode => ({
  bg: "transparent",
  fg: "inherit",
  tokens: code.split("\n").map((line) =>
    line === ""
      ? []
      : [
          {
            color: "inherit",
            content: line,
          } as ThemedToken,
        ],
  ),
});

// 带缓存的异步高亮入口；React 组件只应在 effect 中调用。
export const highlightCode = (
  code: string,
  language: string,
  theme?: BundledTheme,
  // oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-callbacks)
  callback?: (result: TokenizedCode) => void,
): TokenizedCode | null => {
  if (!shouldUseSyntaxHighlighting(language)) {
    // 文本/日志代码块没有语法高亮收益，却会在聊天流式渲染和历史恢复时进入
    // Shiki 的异步状态机。之前修掉了 render 阶段 setState，但这条纯文本路径仍可能把
    // CodeViewer 拖进 React #185；这里直接返回 raw tokens，避免启动高亮副作用。
    return createRawCodeTokens(code);
  }

  const resolvedTheme = getResolvedCodeTheme(theme);
  const resolvedLanguage = normalizeCodeLanguage(language);
  const tokensCacheKey = getCodeTokensCacheKey(code, resolvedLanguage, resolvedTheme);

  const cached = tokensCache.get(tokensCacheKey);
  if (cached) {
    // 缓存命中时也需要通知 effect，但不能同步触发 setState。
    // 历史消息恢复时大量代码块会在同一次提交后挂载；同步 callback 会把 cache-hit 变成嵌套更新，
    // 和 Streamdown 的重渲染叠在一起时容易触发 React #185。推迟到微任务后再交给幂等 setter。
    if (callback) {
      queueMicrotask(() => callback(cached));
    }
    return cached;
  }

  if (callback) {
    if (!subscribers.has(tokensCacheKey)) {
      subscribers.set(tokensCacheKey, new Set());
    }
    subscribers.get(tokensCacheKey)?.add(callback);
  }

  getHighlighter(resolvedLanguage, resolvedTheme)
    // oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-then)
    .then((highlighter) => {
      const availableLangs = highlighter.getLoadedLanguages();
      const langToUse = availableLangs.includes(resolvedLanguage)
        ? resolvedLanguage
        : FALLBACK_CODE_LANGUAGE;

      const result = highlighter.codeToTokens(code, {
        lang: langToUse,
        theme: resolvedTheme,
      });

      const tokenized: TokenizedCode = {
        bg: "transparent",
        fg: result.fg ?? "inherit",
        tokens: result.tokens,
      };

      tokensCache.set(tokensCacheKey, tokenized);

      const subs = subscribers.get(tokensCacheKey);
      if (subs) {
        for (const sub of subs) {
          sub(tokenized);
        }
      }
      subscribers.delete(tokensCacheKey);
    })
    // oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-then), eslint-plugin-promise(prefer-await-to-callbacks)
    .catch((error) => {
      // Shiki 加载或 tokenize 失败，组件会停留在无高亮的 rawTokens 状态。
      logger.error(
        `[ShikiHighlighter] 代码高亮失败: language=${resolvedLanguage}, theme=${resolvedTheme}`,
        error,
      );
      subscribers.delete(tokensCacheKey);
    });

  return null;
};
