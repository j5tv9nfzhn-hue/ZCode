# 原生联网搜索（WebSearch）的 provider 覆盖面

## 1. 现状与缺陷

WebSearch 走 **provider 原生搜索**：`core/src/tool/handlers/websearch.ts` 构造一个
`providerNative` 契约，由 `adapters/src/model/tool-transform.ts:245-278` 的
`toAiSdkProviderNativeTool` 翻译成对应 AI SDK 的 provider tool。
好处是不引入额外搜索服务、不需要额外 API key，搜索由模型服务端执行——这也是 OpenCode
`opencode-websearch` 插件采用的路线。

缺陷是**覆盖面只有 Anthropic 一家**：

```ts
switch (options.providerKind) {
  case "anthropic": return anthropic.tools.webSearch_20260209({ ... });
  default:
    throw new AiSdkModelAdapterError(..., "Provider API kind X does not encode provider-native WebSearch");
}
```

而 `AiSdkProviderKind` 只有三种取值（`adapters/src/model/model-execution.ts:31`）：
`"anthropic" | "openai" | "openai-compatible"`。

后果（观察到的问题现象）：

- `shouldExposeWebSearch`（`core/src/runtime/methods/config.ts:268-272`）按
  `model.properties.supportsNativeWebSearch` 过滤工具表。该属性为 `false` 时，
  **WebSearch 从模型可见的工具表里消失**。
- 该属性被误设为 `true` 但 provider 不是 anthropic 时，真正发请求才在
  `tool-transform.ts:275` 抛错。
- 两条路都不通时，模型只能靠 WebFetch 猜搜索页 URL 或 Bash + curl 自行 improvisation，
  表现为「引擎不稳定、命令不稳定、结果不准确」。

## 2. 本 spec 的范围

| providerKind | 方案 | 理由 |
| --- | --- | --- |
| `"anthropic"` | 已有，不动 | `webSearch_20260209` 支持 `maxUses`/`allowedDomains`/`blockedDomains` |
| `"openai"` | **本次新增** | `@ai-sdk/openai.tools.webSearch` 已在依赖树中，签名与 anthropic 分支同构 |
| `"openai-compatible"` | **本次不实现原生工具**，改为可诊断的显式降级 | `@ai-sdk/openai-compatible` 只导出 `createOpenAICompatible` 与 model 类，**没有 tools 命名空间**；且多数 OpenAI 兼容端点不接受服务端 web_search 工具，伪造一个只会把可用的对话也弄挂 |
| `"gateway"` / `"custom"` | 不在本范围 | ZCode 实际不产出这两个 kind |

## 3. 不变量

1. **不新增搜索服务、不新增 API key、不新增环境变量**：仍然只复用模型自带的联网能力。
2. **不伪造工具**：对明确不支持的 providerKind 抛可诊断错误，而不是塞一个会被服务端 400 掉的工具。
3. **args 不是通用的**：`maxUses`/`allowedDomains`/`blockedDomains` 只有 anthropic 分支消费
   （`openai.tools.webSearch` 的 args 类型为 `{}`，见 `@ai-sdk/openai/dist/index.mjs` 的
   `var webSearch = (args = {}) => webSearchToolFactory(args)`）。openai 分支必须显式忽略，
   不能让上层误以为域名过滤在该分支生效。
4. **开关仍是唯一前置**：`supportsNativeWebSearch === true` 才会走到 provider 分支；
   为 false 时工具不在工具表里，行为不变。
5. **失败必须可诊断**：错误信息要指出「哪个 providerKind、为什么、下一步做什么」。

## 4. 验收场景

| # | 场景 | 期望 |
| --- | --- | --- |
| A1 | providerKind="anthropic" + 开关 true | 产出 anthropic 原生 web_search 工具 |
| A2 | providerKind="openai" + 开关 true | 产出 openai 原生 webSearch 工具 |
| A3 | providerKind="openai" + 开关 false | 抛 `InvalidModelRequest`，信息说明开关未开 |
| A4 | providerKind="openai-compatible" + 开关 true | 抛可诊断错误，指明该 kind 无原生实现、应改用 WebFetch |
| A5 | providerKind 未提供（undefined） | 抛可诊断错误（保持既有默认分支行为） |
| A6 | 契约 args 带 allowedDomains | openai 分支不因 args 报错，也不声称已应用域名过滤 |

## 5. 未覆盖

- `openai-compatible` 的原生搜索：需要确认具体端点是否支持、工具 schema 是什么，
  必须逐个 provider 验证，不能在本 spec 中臆测。
- OpenAI 的 `searchContextSize` / `userLocation`（仅 `webSearchPreview` 暴露）：本次不接。
- xAI / Moonshot / GitHub Copilot：ZCode 的 provider 模型里没有对应 kind，
  要支持需先扩展 provider 层，属另一量级改动。
- 「回退模型」语义（OpenCode 插件的 `websearch: always/auto` 选择顺序）：本次不实现，
  但它比「工具消失」更优，列为后续项。
