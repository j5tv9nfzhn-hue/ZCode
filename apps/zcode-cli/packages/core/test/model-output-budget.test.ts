// 回归用例来自真实缺陷：完整输出开关最初实现为「省略 maxOutputTokens」，
// 而 adapter 的 validateOptions 是必填路径，undefined 会被判为
// invalid_model_request，turn 在真实 E2E 中 100% 失败。
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PROVIDER_DEFAULT_MAX_OUTPUT_TOKENS,
  resolveModelMaxOutputTokens,
} from "../src/runtime/helpers/model-output-budget.js";

const DECLARED = 128_000;

test("完整输出开启：解除本地上下文预算截断，取模型声明上限", () => {
  const resolved = resolveModelMaxOutputTokens({
    unfilteredFullOutputEnabled: true,
    budgetedMaxOutputTokens: 8_000,
    declaredMaxOutputTokens: DECLARED,
  });
  assert.equal(resolved, DECLARED);
});

test("完整输出开启：本地上限已大于声明上限时不缩小", () => {
  const resolved = resolveModelMaxOutputTokens({
    unfilteredFullOutputEnabled: true,
    budgetedMaxOutputTokens: 200_000,
    declaredMaxOutputTokens: DECLARED,
  });
  assert.equal(resolved, 200_000);
});

test("完整输出开启且预算缺失：仍下发模型声明上限，绝不返回 undefined", () => {
  const resolved = resolveModelMaxOutputTokens({
    unfilteredFullOutputEnabled: true,
    budgetedMaxOutputTokens: undefined,
    declaredMaxOutputTokens: DECLARED,
  });
  assert.equal(resolved, DECLARED);
  // 不变量 1：adapter 必填校验不接受 undefined。
  assert.notEqual(resolved, undefined);
});

test("完整输出关闭：保留既有本地上下文预算语义", () => {
  const resolved = resolveModelMaxOutputTokens({
    unfilteredFullOutputEnabled: false,
    budgetedMaxOutputTokens: 8_000,
    declaredMaxOutputTokens: DECLARED,
  });
  assert.equal(resolved, 8_000);
});

test("完整输出关闭且预算缺失：回落到模型声明上限", () => {
  const resolved = resolveModelMaxOutputTokens({
    unfilteredFullOutputEnabled: false,
    budgetedMaxOutputTokens: undefined,
    declaredMaxOutputTokens: DECLARED,
  });
  assert.equal(resolved, DECLARED);
});

test("声明上限异常（非正整数）时回落到 provider 缺省上限，仍可发送", () => {
  for (const declared of [0, -1, 1.5, Number.NaN]) {
    const resolved = resolveModelMaxOutputTokens({
      unfilteredFullOutputEnabled: true,
      budgetedMaxOutputTokens: 4_000,
      declaredMaxOutputTokens: declared,
    });
    assert.equal(resolved, 4_000, `declared=${declared}`);
  }
  const bothBroken = resolveModelMaxOutputTokens({
    unfilteredFullOutputEnabled: true,
    budgetedMaxOutputTokens: 0,
    declaredMaxOutputTokens: 0,
  });
  assert.equal(bothBroken, PROVIDER_DEFAULT_MAX_OUTPUT_TOKENS);
});

test("任何组合都返回正整数", () => {
  for (const enabled of [true, false]) {
    for (const budgeted of [undefined, 0, -5, 1_024, 64_000]) {
      for (const declared of [undefined, 0, -5, 4_096, DECLARED]) {
        const resolved = resolveModelMaxOutputTokens({
          unfilteredFullOutputEnabled: enabled,
          budgetedMaxOutputTokens: budgeted,
          declaredMaxOutputTokens: declared as number,
        });
        assert.ok(
          Number.isInteger(resolved) && resolved > 0,
          `enabled=${enabled} budgeted=${budgeted} declared=${declared} -> ${resolved}`,
        );
      }
    }
  }
});