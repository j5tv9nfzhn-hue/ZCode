// ============================================================
// Vercel AI SDK tool transforms
// ============================================================

import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { jsonSchema, tool, type ToolSet } from "ai";
import { ModelErrorCode, type JsonSchema, type ModelToolContract } from "@zcode/contracts";
import { AiSdkModelAdapterError } from "./errors.js";
import { isAnthropicFirstPartyModelId, toStrictToolSchema } from "./strict-tool-schema.js";

export interface AiSdkToolTransformOptions {
  requiresMfjsToolSchema?: boolean;
  supportsNativeWebSearch?: boolean;
  providerKind?: "openai" | "anthropic" | "openai-compatible" | "gateway" | "custom";

  /** 本次请求的模型 id，仅用于首方 strict 资格判定；缺席即不启用 strict。 */
  modelId?: string;
}

/**
 * provider 原生 web_search 的默认单次请求搜索次数上限。
 * 与 core 侧 WebSearch 契约的 DEFAULT_MAX_USES 是同一条产品规则的两处默认值：
 * core 负责把它写进契约 args，这里只在 core 没写时兜底。
 */
const DEFAULT_WEB_SEARCH_MAX_USES = 8;

export function toAiSdkTools(
  tools?: ModelToolContract[],
  options: AiSdkToolTransformOptions = {},
): ToolSet | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  const entries = tools.flatMap((contract): [string, ToolSet[string]][] => {
    if (contract.providerNative) {
      const providerTool = toAiSdkProviderNativeTool(contract, options);
      return providerTool ? [[contract.name, providerTool]] : [];
    }

    const strictSchema = resolveStrictToolSchema(contract, options);
    const baseTool = {
      description: contract.description,
      inputSchema: jsonSchema<unknown>(
        normalizeToolInputSchema(
          contract.name,
          strictSchema ?? (contract.inputSchema as JsonSchema),
          options,
        ),
      ),
      ...(strictSchema === undefined ? {} : { strict: true }),
      needsApproval: contract.needsApproval,
      ...providerOptionsForClientTool(options),
    };

    if (!contract.execute) {
      return [[contract.name, tool<unknown, never>(baseTool)]];
    }

    return [
      [
        contract.name,
        tool<unknown, unknown>({
          ...baseTool,
          execute: async (input, options) =>
            contract.execute?.(input, {
              toolCallId: options.toolCallId,
              abortSignal: options.abortSignal,
              metadata: {
                readOnly: contract.readOnly,
                destructive: contract.destructive,
                concurrentSafe: contract.concurrentSafe,
                requiresUserInteraction: contract.requiresUserInteraction,
                sideEffectScope: contract.sideEffectScope,
                maxOutputBytes: contract.maxOutputBytes,
                timeoutMs: contract.timeoutMs,
                experimentalContext: options.experimental_context,
              },
            }),
        }),
      ],
    ];
  });

  return entries.length > 0 ? (Object.fromEntries(entries) as ToolSet) : undefined;
}

/**
 * contract 声明 strict、provider 能力匹配、模型具备首方资格且 schema 可表达时，返回严格 schema；
 * 任一条件不满足都返回 undefined，调用方继续发送原 schema，避免兼容端收到陌生字段或非法形状。
 */
function resolveStrictToolSchema(
  contract: ModelToolContract,
  options: AiSdkToolTransformOptions,
): JsonSchema | undefined {
  if (contract.strict !== true) return undefined;
  if (options.providerKind !== "anthropic") return undefined;
  if (!isAnthropicFirstPartyModelId(options.modelId)) return undefined;
  return toStrictToolSchema(contract.inputSchema as JsonSchema);
}

function normalizeToolInputSchema(
  toolName: string,
  schema: JsonSchema,
  options: AiSdkToolTransformOptions,
): JsonSchema {
  if (!options.requiresMfjsToolSchema) {
    return schema;
  }
  return hoistLocalJsonSchemaRefsToDefs(toolName, schema);
}

function hoistLocalJsonSchemaRefsToDefs(toolName: string, schema: JsonSchema): JsonSchema {
  const refs = new Set<string>();
  collectNonDefsLocalRefs(schema, refs);
  const unresolvedRef = [...refs].find((ref) => resolveLocalJsonPointer(schema, ref) === undefined);
  if (unresolvedRef) {
    throw new AiSdkModelAdapterError(
      ModelErrorCode.InvalidModelRequest,
      `Tool ${toolName} contains an unresolvable local schema reference ${unresolvedRef}`,
      { context: { toolName, ref: unresolvedRef } },
    );
  }
  if (refs.size === 0) {
    return schema;
  }

  const existingDefs = asPlainRecord(schema.$defs) ?? {};
  const usedDefKeys = new Set(Object.keys(existingDefs));
  const defKeyByRef = new Map<string, string>();
  let nextDefIndex = 0;
  for (const ref of refs) {
    let defKey = `zcode_ref_${nextDefIndex}`;
    while (usedDefKeys.has(defKey)) {
      nextDefIndex += 1;
      defKey = `zcode_ref_${nextDefIndex}`;
    }
    nextDefIndex += 1;
    usedDefKeys.add(defKey);
    defKeyByRef.set(ref, defKey);
  }

  const rewrittenRoot = rewriteJsonSchemaRefs(schema, defKeyByRef) as JsonSchema;
  const rewrittenDefs = asPlainRecord(rewrittenRoot.$defs) ?? {};
  const hoistedDefs: Record<string, unknown> = {};
  for (const [ref, defKey] of defKeyByRef) {
    hoistedDefs[defKey] = rewriteJsonSchemaRefs(resolveLocalJsonPointer(schema, ref), defKeyByRef);
  }

  // MCP schema 会复用 #/properties/...，但 K3 只接受 #/$defs/...。
  // 在模型适配边界复制引用目标并改写引用，既不修改原 tool contract，也不影响其他模型。
  return {
    ...rewrittenRoot,
    $defs: {
      ...rewrittenDefs,
      ...hoistedDefs,
    },
  };
}

function collectNonDefsLocalRefs(value: unknown, refs: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectNonDefsLocalRefs(item, refs);
    }
    return;
  }
  const record = asPlainRecord(value);
  if (!record) return;
  if (
    typeof record.$ref === "string" &&
    record.$ref.startsWith("#/") &&
    !record.$ref.startsWith("#/$defs/")
  ) {
    refs.add(record.$ref);
  }
  for (const child of Object.values(record)) {
    collectNonDefsLocalRefs(child, refs);
  }
}

function resolveLocalJsonPointer(root: unknown, ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;
  let current = root;
  try {
    for (const encodedSegment of ref.slice(2).split("/")) {
      const segment = decodeURIComponent(encodedSegment)
        .replaceAll("~1", "/")
        .replaceAll("~0", "~");
      if (Array.isArray(current)) {
        if (!/^\d+$/u.test(segment)) return undefined;
        current = current[Number(segment)];
        continue;
      }
      const record = asPlainRecord(current);
      if (!record || !Object.prototype.hasOwnProperty.call(record, segment)) {
        return undefined;
      }
      current = record[segment];
    }
  } catch {
    return undefined;
  }
  return current;
}

function rewriteJsonSchemaRefs(value: unknown, defKeyByRef: ReadonlyMap<string, string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => rewriteJsonSchemaRefs(item, defKeyByRef));
  }
  const record = asPlainRecord(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.entries(record).map(([key, child]) => {
      if (key === "$ref" && typeof child === "string") {
        const defKey = defKeyByRef.get(child);
        if (defKey) {
          return [key, `#/$defs/${defKey}`];
        }
      }
      return [key, rewriteJsonSchemaRefs(child, defKeyByRef)];
    }),
  );
}

function asPlainRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function providerOptionsForClientTool(options: AiSdkToolTransformOptions): {
  providerOptions?: Record<string, Record<string, boolean>>;
} {
  if (options.providerKind !== "anthropic") {
    return {};
  }

  // AI SDK enables Anthropic fine-grained tool input streaming by default
  // and serializes eager_input_streaming on every function tool. Several
  // Anthropic-compatible gateways reject that extra tool field, so ZCode opts out
  // at the provider-option boundary unless a future capability contract enables it.
  return {
    providerOptions: {
      anthropic: {
        eagerInputStreaming: false,
      },
    },
  };
}

function toAiSdkProviderNativeTool(
  contract: ModelToolContract,
  options: AiSdkToolTransformOptions,
): ToolSet[string] | undefined {
  if (contract.providerNative?.logicalName !== "WebSearch") {
    return undefined;
  }

  // 注意：这里的 args 只有 anthropic 分支会消费。openai.tools.webSearch 的入参类型是
  // {}（见 @ai-sdk/openai/dist/index.mjs 的 `var webSearch = (args = {}) => ...`），
  // 不支持 maxUses / allowedDomains / blockedDomains。下面的 openai 分支必须显式忽略，
  // 不能让上层误以为域名过滤在该分支也生效——见 docs/native-web-search.md 不变量 3。
  const args = contract.providerNative.args ?? {};
  const allowedDomains = stringArrayArg(args.allowedDomains);
  const blockedDomains = stringArrayArg(args.blockedDomains);

  switch (options.providerKind) {
    case "anthropic":
      if (!options.supportsNativeWebSearch) {
        throw new AiSdkModelAdapterError(
          ModelErrorCode.InvalidModelRequest,
          "Effective Model Config does not support provider-native WebSearch",
        );
      }
      return anthropic.tools.webSearch_20260209({
        maxUses: numberArg(args.maxUses) ?? DEFAULT_WEB_SEARCH_MAX_USES,
        allowedDomains,
        blockedDomains,
      }) as ToolSet[string];

    case "openai":
      if (!options.supportsNativeWebSearch) {
        throw new AiSdkModelAdapterError(
          ModelErrorCode.InvalidModelRequest,
          "Effective Model Config does not support provider-native WebSearch",
        );
      }
      // OpenAI 的原生 web search 不接收域名过滤与次数上限；args 在此被有意丢弃。
      return openai.tools.webSearch() as ToolSet[string];

    case "openai-compatible":
      // 刻意不伪造工具：@ai-sdk/openai-compatible 只导出 createOpenAICompatible 与 model
      // 类，没有 tools 命名空间；且多数 OpenAI 兼容端点不接受服务端 web_search 工具，
      // 塞一个假工具只会把本来能跑的对话也打成 400。宁可给一句能指导行动的错误。
      throw new AiSdkModelAdapterError(
        ModelErrorCode.InvalidModelRequest,
        "providerKind \"openai-compatible\" 没有原生联网搜索实现：" +
          "@ai-sdk/openai-compatible 不提供 provider tools，且多数兼容端点不接受服务端 web_search。" +
          "请改用 WebFetch 抓取已知 URL，或切换到 anthropic / openai 端点。",
      );

    default:
      throw new AiSdkModelAdapterError(
        ModelErrorCode.InvalidModelRequest,
        `Provider API kind ${options.providerKind ?? "unknown"} does not encode provider-native WebSearch`,
      );
  }
}

function numberArg(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArrayArg(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.filter((item): item is string => typeof item === "string");
  return values.length > 0 ? values : undefined;
}
