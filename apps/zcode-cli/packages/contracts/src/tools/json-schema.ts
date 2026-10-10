// ============================================================
// Zod -> provider-neutral JSON Schema for tool contracts
// ============================================================

import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodTypeAny } from "zod";
import type { JsonSchema } from "../model/index.js";

const STRIPPED_SCHEMA_KEYS = new Set([
  "$schema",
  "$id",
  "$ref",
  "$defs",
  "definitions",
]);
export const TOOL_JSON_SCHEMA_VERSION = "https://json-schema.org/draft/2020-12/schema";

/**
 * Convert a Zod runtime schema into the JSON Schema subset exposed to model
 * providers. Keep all built-in tool schemas on this path so runtime validation
 * and provider-facing function parameters cannot drift.
 */
export interface ToToolJsonSchemaOptions {
  /**
   * 宽容模式：从生成的 JSON Schema 里去掉所有 `additionalProperties: false`，
   * 让模型多传的额外字段被**静默忽略**而不是让整个工具调用失败。
   *
   * 为什么需要（实测根因）：Zod `.object()` 经 zod-to-json-schema 默认生成
   * `additionalProperties: false`。而自主编排子代理（goals/planner/worker）在长程
   * 任务里经常传看似合理的额外字段——给 asset 传 `url`、给 goal 传 `reason`、
   * 给 intent 传 `note` / `target` / `confidence`、给 fact 传 `severity`……严格模式
   * 在 pre-validation 阶段（core/tool/json-schema.ts 的 `additionalProperties === false`
   * 分支）直接拒绝，模型未必能自纠（实测会卡在同一条工具调用里反复重试直到步数耗尽，
   * 表现为「工具调用几乎全军覆没」）。
   *
   * 收下额外字段只影响两处：
   *   1. 模型看到的 JSON Schema（不再有 unrecognized_keys 阻断）；
   *   2. pre-validation 的 additionalProperties 检查。
   * Zod runtime parse（handler 里的 `.parse()`）仍是 strip 语义，额外字段不会进入 handler。
   */
  lenient?: boolean;
}

export function toToolJsonSchema(
  schema: ZodTypeAny,
  options: ToToolJsonSchemaOptions = {},
): JsonSchema {
  const jsonSchema = zodToJsonSchema(schema, {
    $refStrategy: "none",
    effectStrategy: "input",
    target: "jsonSchema7",
  }) as JsonSchema;

  normalizeToolJsonSchema(jsonSchema);
  if (options.lenient) {
    stripAdditionalPropertiesFalse(jsonSchema);
  }
  jsonSchema.$schema = TOOL_JSON_SCHEMA_VERSION;
  return jsonSchema;
}

/** 递归删除 schema 树里所有 `additionalProperties: false`（见 ToToolJsonSchemaOptions.lenient）。 */
function stripAdditionalPropertiesFalse(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      stripAdditionalPropertiesFalse(item);
    }
    return;
  }
  if (!isRecord(value)) return;

  if (value.additionalProperties === false) {
    delete value.additionalProperties;
  }
  if (isRecord(value.properties)) {
    for (const child of Object.values(value.properties)) {
      stripAdditionalPropertiesFalse(child);
    }
  }
  stripAdditionalPropertiesFalse(value.items);
  stripAdditionalPropertiesFalse(value.oneOf);
  stripAdditionalPropertiesFalse(value.anyOf);
  stripAdditionalPropertiesFalse(value.allOf);
}

export function normalizeToolJsonSchema(schema: JsonSchema): JsonSchema {
  normalizeSchemaNode(schema);
  return schema;
}

function normalizeSchemaNode(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      normalizeSchemaNode(item);
    }
    return;
  }

  if (!isRecord(value)) return;

  for (const key of STRIPPED_SCHEMA_KEYS) {
    delete value[key];
  }

  if (isRecord(value.properties)) {
    for (const child of Object.values(value.properties)) {
      normalizeSchemaNode(child);
    }
  }

  normalizeSchemaNode(value.items);
  normalizeSchemaNode(value.additionalProperties);
  normalizeSchemaNode(value.oneOf);
  normalizeSchemaNode(value.anyOf);
  normalizeSchemaNode(value.allOf);

  if (Array.isArray(value.anyOf) && value.oneOf === undefined) {
    value.oneOf = value.anyOf;
    delete value.anyOf;
  }

  if (value.type === undefined) {
    const inferredType = inferSchemaType(value);
    if (inferredType) {
      value.type = inferredType;
    }
  }

  const typeValues = Array.isArray(value.type) ? value.type : [value.type];
  if (
    typeValues.includes("object") &&
    !isRecord(value.properties) &&
    isRecord(value.additionalProperties) &&
    value.propertyNames === undefined
  ) {
    value.propertyNames = { type: "string" };
  }
  if (
    typeValues.includes("object") &&
    !isRecord(value.properties) &&
    value.additionalProperties === undefined
  ) {
    value.properties = {};
  }
  if (typeValues.includes("array") && value.items === undefined) {
    value.items = {};
  }
}

function inferSchemaType(schema: Record<string, unknown>): string | undefined {
  if (isRecord(schema.properties) || Array.isArray(schema.required)) {
    return "object";
  }
  if (schema.items !== undefined || typeof schema.minItems === "number" || typeof schema.maxItems === "number") {
    return "array";
  }
  if (Array.isArray(schema.enum)) {
    return inferTypeFromValues(schema.enum);
  }
  if ("const" in schema) {
    return inferTypeFromValues([schema.const]);
  }
  if (typeof schema.minLength === "number" || typeof schema.maxLength === "number") {
    return "string";
  }
  if (typeof schema.minimum === "number" || typeof schema.maximum === "number") {
    return "number";
  }
  return undefined;
}

function inferTypeFromValues(values: unknown[]): string | undefined {
  if (values.length === 0) return undefined;
  if (values.every((value) => typeof value === "string")) return "string";
  if (values.every((value) => typeof value === "boolean")) return "boolean";
  if (values.every((value) => Number.isInteger(value))) return "integer";
  if (values.every((value) => typeof value === "number")) return "number";
  if (values.every((value) => value === null)) return "null";
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
