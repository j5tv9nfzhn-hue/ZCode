// provider 原生联网搜索的 provider 覆盖面。
// 覆盖 docs/native-web-search.md 的验收场景 A1–A6。
// 这里的重点是「不回退成假工具」：不支持的 providerKind 必须抛可诊断错误，
// 而不是塞一个会被服务端 400 掉的工具。
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelToolContract } from "@zcode/contracts";
import { toAiSdkTools } from "../src/model/tool-transform.js";

function webSearchContract(
  args: Record<string, unknown> = { maxUses: 3 },
): ModelToolContract {
  return {
    name: "web_search",
    capability: "web_search",
    description: "Provider-native web search used internally by the WebSearch tool",
    executionMode: "providerNative",
    providerNative: {
      kind: "provider_native",
      logicalName: "WebSearch",
      providerToolName: "web_search",
      fallback: "disabled",
      args,
    },
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    outputSchema: { type: "object" },
  } as unknown as ModelToolContract;
}

const PROVIDER_KINDS = ["anthropic", "openai", "openai-compatible"] as const;

test("A1/A2：开关开启时 anthropic 与 openai 都产出原生工具", () => {
  for (const providerKind of ["anthropic", "openai"] as const) {
    const tools = toAiSdkTools([webSearchContract()], {
      providerKind,
      supportsNativeWebSearch: true,
    });
    assert.ok(tools, `${providerKind}: 期望产出工具集`);
    const tool = tools.web_search;
    assert.ok(tool, `${providerKind}: 期望 web_search 存在`);
    // provider tool 带 type: "provider"；客户端 tool 不会。
    assert.equal((tool as { type?: string }).type, "provider", `${providerKind}: 应为 provider 原生工具`);
  }
});

test("A3：开关关闭时 openai 分支显式报错，不静默降级", () => {
  assert.throws(
    () =>
      toAiSdkTools([webSearchContract()], {
        providerKind: "openai",
        supportsNativeWebSearch: false,
      }),
    /does not support provider-native WebSearch/,
  );
});

test("A4：openai-compatible 不伪造工具，错误可指导行动", () => {
  assert.throws(
    () =>
      toAiSdkTools([webSearchContract()], {
        providerKind: "openai-compatible",
        supportsNativeWebSearch: true,
      }),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      return (
        message.includes("openai-compatible") &&
        message.includes("WebFetch") &&
        // 不允许出现「换个 provider 就能修」之外的可行动作消失。
        /anthropic|openai/.test(message)
      );
    },
  );
});

test("A5：providerKind 缺席时保持默认分支的可诊断报错", () => {
  assert.throws(
    () =>
      toAiSdkTools([webSearchContract()], {
        supportsNativeWebSearch: true,
      }),
    /Provider API kind unknown does not encode provider-native WebSearch/,
  );
});

test("A6：openai 分支忽略 args，且不因域名过滤参数报错", () => {
  // openai.tools.webSearch 的入参类型是 {}，不支持 allowedDomains / blockedDomains /
  // maxUses。上游 core 仍会写这些 args，openai 分支必须照常产出工具而不是抛错。
  const tools = toAiSdkTools([webSearchContract({ maxUses: 5, allowedDomains: ["example.com"] })], {
    providerKind: "openai",
    supportsNativeWebSearch: true,
  });
  assert.ok(tools?.web_search, "openai: 带域名过滤 args 时仍应产出工具");
});

test("巡卫：三种 providerKind 都必须有明确分支，不允许落到 default 之外又被静默跳过", () => {
  for (const providerKind of PROVIDER_KINDS) {
    // 开关开启时，只有 openai-compatible 允许抛错，且必须抛。
    let produced = false;
    let threw: unknown;
    try {
      produced = Boolean(
        toAiSdkTools([webSearchContract()], { providerKind, supportsNativeWebSearch: true })?.web_search,
      );
    } catch (error) {
      threw = error;
    }
    if (providerKind === "openai-compatible") {
      assert.ok(threw, "openai-compatible: 必须显式报错");
    } else {
      assert.ok(produced, `${providerKind}: 期望产出工具`);
    }
  }
});
