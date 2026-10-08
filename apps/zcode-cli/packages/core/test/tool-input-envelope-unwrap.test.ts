// 回归用例来自真实 E2E 缺陷（2026-10-08，真实 provider + 真实目标）：
// 模型间歇性地把工具入参再套一层信封发出来，实测约 40% 的调用落在畸形形态上：
//   1. `{"arguments": {"command": "..."}}` —— OpenAI 习惯的 wrapper 泄漏进入参对象；
//   2. `{"command": {"command": "..."}}` —— 把整个对象塞进唯一必填参数里（双层嵌套）。
// 两种形态都会让 inputSchema 校验失败，模型在下一轮看到错误后尝试自纠，形成
// 「报错 → 自纠 → 再报错」的挣扎循环，整个 turn 的执行预算被格式自纠吃掉。
//
// 已用本地抓包代理确认：出站缆线的 assistant tool_calls 回放形状是标准
// `{id,type,function:{name,arguments:string}}`，工具定义里也没有名为 `arguments` 的参数——
// 即畸形由模型侧生成，不是我们回放教出来的。因此修复只能放在入参归一化边界。
import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareInitialToolExecutionInput } from "../src/tool/input-normalization.js";
import type { ToolEntry } from "../src/tool/types.js";

const BASH_INPUT_SCHEMA = {
  type: "object",
  properties: {
    command: { type: "string" },
    description: { type: "string" },
  },
  required: ["command"],
} as const;

function bashEntry(): ToolEntry {
  return { metadata: { name: "Bash" }, inputSchema: BASH_INPUT_SCHEMA } as unknown as ToolEntry;
}

function prepare(input: unknown): unknown {
  return prepareInitialToolExecutionInput({ entry: bashEntry(), input }).input;
}

test("合法输入原样通过（不因解包逻辑被改写）", () => {
  const input = { command: "ls -la", description: "list files" };
  assert.deepEqual(prepare(input), input);
});

test("arguments wrapper 被解包（模型把 OpenAI 习惯 wrapper 泄漏进入参）", () => {
  const prepared = prepare({ arguments: { command: "curl -I https://example.com/" } });
  assert.deepEqual(prepared, { command: "curl -I https://example.com/" });
});

test("双层嵌套被解包（唯一必填键的值又是对象）", () => {
  const prepared = prepare({ command: { command: "curl -sS https://example.com/" } });
  assert.deepEqual(prepared, { command: "curl -sS https://example.com/" });
});

test("多层嵌套被逐层解包", () => {
  const prepared = prepare({ arguments: { command: { command: "id" } } });
  assert.deepEqual(prepared, { command: "id" });
});

test("非法但非信封的输入不被改写（真实 schema 违规必须照旧报错）", () => {
  // 唯一键不是 arguments、内层也没有同名键 —— 不是可识别的信封形态，保持原样。
  const input = { foo: { bar: 1 } };
  assert.deepEqual(prepare(input), input);
});

test("缺失必填参数的输入不被改写（不能靠解包掩盖缺参）", () => {
  const input = { description: "no command here" };
  assert.deepEqual(prepare(input), input);
});

test("数组输入不被当作信封解包", () => {
  const input = [{ command: "ls" }];
  assert.deepEqual(prepare(input), input);
});
