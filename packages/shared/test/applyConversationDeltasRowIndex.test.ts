// applyConversationDeltas 的可选行索引（2026-10-09 性能修复）。
//
// 投影的实时路径每个事件都调它，而流式 `row.delta` 是**每 token 一次**的事件。
// 原实现对每条 delta 都 `window.findIndex(...)`（O(rows)），rows.window 持有整段会话，
// 于是长会话下这里是 O(n²)。投影侧本来就维护着 `rowIndexById`，只是没传进来。
//
// 本测试的核心断言是**等价性**：传索引与不传索引必须产生完全相同的结果，
// 尤其是在含 `row.removed`（唯一会平移下标的 op）时必须自动退回 findIndex。
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConversationDelta, ConversationSnapshot } from "../src/zcode-protocol-v4/index.js";
import { applyConversationDeltas } from "../src/zcode-protocol-v4/apply.js";

function snapshotOf(rows: ConversationSnapshot["rows"]["window"]): ConversationSnapshot {
  return {
    seq: 0,
    rows: { window: rows, totalCount: rows.length, firstRowId: rows[0]?.rowId ?? null },
  } as unknown as ConversationSnapshot;
}

function userRow(rowId: number, turnId: string): ConversationSnapshot["rows"]["window"][number] {
  return { rowId, turnId, kind: "userInput", origin: "realUser", state: "complete" };
}

function assistantRow(
  rowId: number,
  turnId: string,
): ConversationSnapshot["rows"]["window"][number] {
  return { rowId, turnId, kind: "assistantText", state: "streaming", text: "" };
}

function indexOf(snapshot: ConversationSnapshot): Map<number, number> {
  return new Map(snapshot.rows.window.map((row, index) => [row.rowId, index]));
}

function rowDelta(rowId: number, path: string, append: string): ConversationDelta {
  return { op: "row.delta", rowId, path, append } as ConversationDelta;
}

test("传索引与不传索引产生完全相同的结果（等价性是这次改动的前提）", () => {
  const snapshot = snapshotOf([
    userRow(1, "t1"),
    assistantRow(2, "t1"),
    userRow(3, "t2"),
    assistantRow(4, "t2"),
  ]);
  const deltas = [
    rowDelta(2, "text", "hello"),
    rowDelta(4, "text", "world"),
    rowDelta(2, "text", "!"),
  ];

  const withoutIndex = applyConversationDeltas(snapshot, deltas);
  const withIndex = applyConversationDeltas(snapshot, deltas, indexOf(snapshot));

  assert.deepEqual(withIndex, withoutIndex);
  assert.notEqual(withIndex, snapshot, "必须是新对象（不可变语义不能被优化掉）");
});

test("索引定位到错误下标时安全回退 findIndex（索引可能来自更早的快照）", () => {
  const snapshot = snapshotOf([userRow(1, "t1"), assistantRow(2, "t1")]);
  // 故意给一个错位的索引：rowId 2 指向下标 0（那里是 rowId 1）。
  const staleIndex = new Map([
    [2, 0],
    [99, 7],
  ]);

  const withStaleIndex = applyConversationDeltas(snapshot, [rowDelta(2, "text", "x")], staleIndex);
  const withoutIndex = applyConversationDeltas(snapshot, [rowDelta(2, "text", "x")]);

  assert.deepEqual(withStaleIndex, withoutIndex, "错位索引必须被校验后回退，而不是写错行");
  assert.equal(withStaleIndex.rows.window[1]?.rowId, 2, "内容应落在 rowId 2 那一行");
});

test("索引里没有的 rowId 仍是 no-op（被逐出的行只能经 rows/range 取回）", () => {
  const snapshot = snapshotOf([userRow(1, "t1")]);
  const result = applyConversationDeltas(snapshot, [rowDelta(999, "text", "x")], indexOf(snapshot));
  assert.deepEqual(result.rows.window, snapshot.rows.window);
});

test("含 row.removed 的批次整批弃用索引（唯一会平移下标的 op）", () => {
  const snapshot = snapshotOf([
    userRow(1, "t1"),
    assistantRow(2, "t1"),
    userRow(3, "t2"),
    assistantRow(4, "t2"),
  ]);
  const deltas = [
    rowDelta(2, "text", "before-remove"),
    { op: "row.removed", fromRowId: 3 } as ConversationDelta,
    // 这条 delta 的目标 rowId 4 在 row.removed 之后已经不在窗口里了。
    rowDelta(4, "text", "after-remove"),
  ];

  const withoutIndex = applyConversationDeltas(snapshot, deltas);
  const withIndex = applyConversationDeltas(snapshot, deltas, indexOf(snapshot));

  assert.deepEqual(withIndex, withoutIndex, "row.removed 之后必须回退，不能用错位索引");
  assert.deepEqual(
    withIndex.rows.window.map((row) => row.rowId),
    [1, 2],
  );
});

test("row.upserted 也走索引快路径且结果一致", () => {
  const snapshot = snapshotOf([userRow(1, "t1"), assistantRow(2, "t1")]);
  const deltas = [
    { op: "row.upserted", row: { ...userRow(1, "t1"), title: "edited" } } as ConversationDelta,
  ];

  assert.deepEqual(
    applyConversationDeltas(snapshot, deltas, indexOf(snapshot)),
    applyConversationDeltas(snapshot, deltas),
  );
});

test("row.appended 不受索引影响（永远追加到窗口末尾）", () => {
  const snapshot = snapshotOf([userRow(1, "t1")]);
  const deltas = [{ op: "row.appended", row: assistantRow(2, "t1") } as ConversationDelta];

  const result = applyConversationDeltas(snapshot, deltas, indexOf(snapshot));
  assert.deepEqual(
    result.rows.window.map((row) => row.rowId),
    [1, 2],
  );
  assert.equal(result.rows.totalCount, 2);
  assert.equal(result.rows.firstRowId, 1);
});

test("入参不被修改（不可变语义）", () => {
  const snapshot = snapshotOf([userRow(1, "t1"), assistantRow(2, "t1")]);
  const before = JSON.stringify(snapshot);
  applyConversationDeltas(snapshot, [rowDelta(2, "text", "x")], indexOf(snapshot));
  assert.equal(JSON.stringify(snapshot), before);
});
