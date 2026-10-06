import { createServiceLogger } from "../logger/serviceLogger.js";
import type { ProviderModelDiscoverer, ProviderModelDiscoveryResult } from "./providerFacadeServices.js";

const log = createServiceLogger("provider-model-discovery");

/**
 * 模型发现请求超时。
 *
 * 端点是用户自填的，可能指向内网或不可达地址；没有超时会让设置页的按钮永久 pending。
 */
const DISCOVERY_TIMEOUT_MS = 15_000;

/**
 * 从 provider 的模型端点拉取可用模型 id。
 *
 * 走 OpenAI 兼容惯例的 `GET {baseUrl}/models`，对两类响应做归一化：
 * - `{ data: [{ id }] }`：OpenAI / Anthropic / 多数兼容网关；
 * - `{ models: [{ name }] }`：Ollama 风格。
 *
 * 与 DeepSeek Harness / Hermes Desktop / Cherry Studio 的发现实现同一取向：只做「发现」，
 * 不猜模型的上下文窗口、推理能力等元数据——那些继续由用户或 provider 配置决定，
 * 猜错会让模型以错误的 limit 进入执行 Registry。
 */
export function createProviderModelDiscoverer(): ProviderModelDiscoverer {
  return async (input) => {
    const endpoint = resolveModelsEndpoint(input.baseUrl);
    const headers = buildDiscoveryHeaders(input.apiFormat, input.apiKey);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, { headers, signal: controller.signal });
      if (!response.ok) {
        return {
          status: "error",
          message: `模型端点返回 ${response.status} ${response.statusText}`.trim(),
        };
      }
      const payload: unknown = await response.json();
      const modelIds = extractModelIds(payload);
      if (modelIds.length === 0) {
        return {
          status: "error",
          message: "模型端点返回成功，但响应里没有可识别的模型 id",
        };
      }
      return { status: "ok", modelIds };
    } catch (error) {
      const message =
        error instanceof Error && error.name === "AbortError"
          ? `请求超时（${DISCOVERY_TIMEOUT_MS}ms）`
          : error instanceof Error
            ? error.message
            : String(error);
      log.warn(undefined, "provider model discovery failed", {
        endpoint,
        error: message,
      });
      return { status: "error", message };
    } finally {
      clearTimeout(timeout);
    }
  };
}

/**
 * 归一化端点：补 `/models`，并避免把已经带 `/v1` 的 baseUrl 拼成 `/v1/v1/models`。
 * 已显式给出 `/models` 的地址原样使用。
 */
export function resolveModelsEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (/\/models$/.test(trimmed)) return trimmed;
  return `${trimmed}/models`;
}

function buildDiscoveryHeaders(apiFormat: string, apiKey: string): Record<string, string> {
  if (apiFormat === "anthropic-messages") {
    return {
      "anthropic-version": "2023-06-01",
      "x-api-key": apiKey,
    };
  }
  return { authorization: `Bearer ${apiKey}` };
}

/**
 * 从响应体里抽取模型 id。
 *
 * 只接受字符串 id/name；去重后按字典序排序，让 UI 的展示顺序稳定（不随端点返回顺序抖动）。
 */
export function extractModelIds(payload: unknown): string[] {
  const candidates = collectModelEntries(payload);
  const ids = new Set<string>();
  for (const entry of candidates) {
    if (typeof entry === "string") {
      const trimmed = entry.trim();
      if (trimmed.length > 0) ids.add(trimmed);
      continue;
    }
    if (entry && typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      const raw = record.id ?? record.name ?? record.model;
      if (typeof raw === "string" && raw.trim().length > 0) ids.add(raw.trim());
    }
  }
  return [...ids].sort((left, right) => left.localeCompare(right));
}

function collectModelEntries(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  // 只认顶层 `data` / `models`：不递归扫描，避免把响应里其它数组（如错误详情）误当模型。
  for (const key of ["data", "models"]) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}
