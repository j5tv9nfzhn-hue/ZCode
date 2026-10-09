// 行 actions 物化的两个纯函数：可否跳过物化的判据 + actions 浅相等。
//
// 两者都是 2026-10-09 性能修复引入的，风险不对称：
// **gate 判错的代价是客户端长期显示过期入口，比慢更糟**，所以判据一律偏保守。
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConversationDelta, RowActions } from "@zcode/shared/zcode-protocol-v4";
import {
  deltasCanChangeRowActions,
  rowActionsEqual,
} from "../src/zcode-protocol-v4/row-actions-materialization.js";

function rowDelta(rowId: number, path: string, append: string): ConversationDelta {
  return { op: "row.delta", rowId, path, append } as ConversationDelta;
}

// ---------------------------------------------------------------------------
// deltasCanChangeRowActions —— 风险最高的一环：判错会让客户端显示过期入口
// ---------------------------------------------------------------------------

test("流式 row.delta 不可能改变 actions（每个 token 走的就是这条路径）", () => {
  assert.equal(deltasCanChangeRowActions([rowDelta(1, "inputText", "abc")]), false);
  assert.equal(deltasCanChangeRowActions([rowDelta(1, "output.text", "abc")]), false);
  assert.equal(deltasCanChangeRowActions([rowDelta(1, "summaryText", "abc")]), false);
});

test("一串流式 delta 全部跳过物化", () => {
  const deltas = [
    rowDelta(1, "output.text", "a"),
    rowDelta(1, "output.text", "b"),
    rowDelta(2, "inputText", "c"),
  ];
  assert.equal(deltasCanChangeRowActions(deltas), false);
});

test("workflowRun 增量与行 actions 无关", () => {
  assert.equal(
    deltasCanChangeRowActions([
      { op: "workflowRun.updated", runId: "r1", run: {} } as unknown as ConversationDelta,
    ]),
    false,
  );
  assert.equal(
    deltasCanChangeRowActions([
      { op: "workflowRun.removed", runId: "r1" } as unknown as ConversationDelta,
    ]),
    false,
  );
});

test("state.updated 触及 control / pendingInteractions 时必须重物化", () => {
  assert.equal(
    deltasCanChangeRowActions([
      { op: "state.updated", patch: { control: { activeWorks: [] } } } as unknown as ConversationDelta,
    ]),
    true,
    "control.activeWorks 决定 compactActive / completionBlockingActive",
  );
  assert.equal(
    deltasCanChangeRowActions([
      { op: "state.updated", patch: { pendingInteractions: [] } } as unknown as ConversationDelta,
    ]),
    true,
    "pendingInteractions 决定 canRewindFiles",
  );
});

test("state.updated 只带无关键时跳过物化", () => {
  for (const patch of [{ revision: 3 }, { usage: {} }, { contextWindow: {} }]) {
    assert.equal(
      deltasCanChangeRowActions([{ op: "state.updated", patch } as unknown as ConversationDelta]),
      false,
      `patch ${JSON.stringify(patch)} 不该触发重物化`,
    );
  }
});

test("增删改行一律判定为可能改变 actions（保守方向）", () => {
  assert.equal(
    deltasCanChangeRowActions([{ op: "row.appended", row: { rowId: 3 } } as unknown as ConversationDelta]),
    true,
  );
  assert.equal(
    deltasCanChangeRowActions([{ op: "row.upserted", row: { rowId: 3 } } as unknown as ConversationDelta]),
    true,
  );
  assert.equal(
    deltasCanChangeRowActions([{ op: "row.removed", fromRowId: 3 } as unknown as ConversationDelta]),
    true,
  );
});

test("混合批次里只要有一个危险 op 就整批重物化", () => {
  assert.equal(
    deltasCanChangeRowActions([
      rowDelta(1, "output.text", "a"),
      { op: "row.appended", row: { rowId: 9 } } as unknown as ConversationDelta,
    ]),
    true,
    "some() 语义：不能因为前面几个 delta 无害就跳过整批",
  );
});

test("空批次不触发重物化", () => {
  assert.equal(deltasCanChangeRowActions([]), false);
});

// ---------------------------------------------------------------------------
// rowActionsEqual —— 替代每行两次 JSON.stringify
// ---------------------------------------------------------------------------

test("浅相等：undefined / 空 / 同值 / 不同值", () => {
  assert.equal(rowActionsEqual(undefined, undefined), true);
  assert.equal(rowActionsEqual({}, undefined), false);
  assert.equal(rowActionsEqual(undefined, {}), false);
  assert.equal(rowActionsEqual({}, {}), true);
  assert.equal(rowActionsEqual({ canEdit: true }, { canEdit: true } as RowActions), true);
  assert.equal(
    rowActionsEqual({ canEdit: true } as RowActions, { canRetry: true } as RowActions),
    false,
  );
});

test("浅相等：键数不同即不等（多键 vs 单键）", () => {
  assert.equal(
    rowActionsEqual({ canEdit: true } as RowActions, { canEdit: true, canRetry: true } as RowActions),
    false,
  );
});

test("浅相等：键集合相同但值不同", () => {
  assert.equal(
    rowActionsEqual(
      { editDisposition: "rewind" } as RowActions,
      { editDisposition: "fork" } as RowActions,
    ),
    false,
  );
});

test("与 JSON.stringify 比较在真实取值域上完全一致（哨兵）", () => {
  // 只要这个测试还绿，就说明「actions 不含值为 undefined 的键」这个前提成立，
  // 浅比较与序列化比较可以互换。若将来 actions 形状变了，它会先红。
  const samples: Array<RowActions | undefined> = [
    undefined,
    {},
    { canEdit: true },
    { canRetry: true },
    { canFork: true, canRetry: true },
    { canEdit: true, editDisposition: "rewind" },
    { canEdit: true, editDisposition: "fork" },
    { canRewindFiles: true, canEdit: true, canRetry: true, canFork: true },
  ];
  for (const a of samples) {
    for (const b of samples) {
      const viaJson = JSON.stringify(a) === JSON.stringify(b);
      assert.equal(
        rowActionsEqual(a, b),
        viaJson,
        `分歧：a=${JSON.stringify(a)} b=${JSON.stringify(b)}`,
      );
    }
  }
});