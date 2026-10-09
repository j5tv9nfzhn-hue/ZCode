// 行 actions 物化的两个纯函数：可否跳过物化的判据 + actions 浅相等。
//
// 两者都是 2026-10-09 性能修复引入的，风险不对称：
// **gate 判错的代价是客户端长期显示过期入口，比慢更糟**，所以判据一律偏保守。
import type {
  ConversationDelta,
  RowActions,
} from "@zcode/shared/zcode-protocol-v4";

/**
 * 这串 delta 是否可能改变任何一行的 `actions`。
 *
 * `materializeCommandRowActions` 的输出只依赖这些东西（读它的计算逐项枚举）：
 * `control.activeWorks`（compact 是否在跑）、`pendingInteractions`、各行的 `state`、
 * `row.fileChanges?.state`、userInput / assistantText 的「最新一条」身份
 * （`origin === "realUser"`、`latestAssistantRowIdByTurn`）、
 * `turnHeaderRowIdByTurnId` 的 state，以及两个投影侧外部表
 * （`messageIdByRowId`、`turnHeaderRowIdByTurnId`）。
 *
 * 按 op 逐个判定能否触及它们：
 * - `row.delta`：只经 `appendToRow` 追加 `inputText` / `output.text` / `summaryText`
 *   三个文本字段。它不改 `state`、不改 `fileChanges`、不改 control/pendingInteractions，
 *   也不新增或删除任何行——「最新一条」的身份由 rowId 顺序决定，与文本内容无关。
 *   **这就是每个流式 token 走的那条路径**，也是本次优化要跳过的主力。
 * - `workflowRun.updated` / `workflowRun.removed`：只动 `snapshot.workflowRuns`，
 *   与 rows 的 actions 无关。
 * - `state.updated`：只有 patch 里**不含** `control` 与 `pendingInteractions` 两个键
 *   时才安全（键级整体替换；其余键如 `revision` / `usage` / `contextWindow` 都碰不到
 *   上面任何一项）。
 * - 其余（`row.appended` / `row.upserted` / `row.removed`）一律判定为「可能改变」。
 */
export function deltasCanChangeRowActions(deltas: readonly ConversationDelta[]): boolean {
  return deltas.some((delta) => {
    switch (delta.op) {
      case "row.delta":
      case "workflowRun.updated":
      case "workflowRun.removed":
        return false;
      case "state.updated":
        return "control" in delta.patch || "pendingInteractions" in delta.patch;
      default:
        return true;
    }
  });
}

/**
 * `actions` 的浅相等比较，替代原先每行两次 `JSON.stringify`。
 *
 * `RowActions` 是扁平原始值集合（`canFork` / `canEdit` / `canRetry` /
 * `canRewindFiles` 四个 `true` 字面量 + `editDisposition` 枚举），且构造方式是
 * `{ ...row.actions }` 之后 `delete`——**不会出现值为 undefined 的键**。因此浅比较
 * 与 JSON 序列化比较在这里等价。
 *
 * 这不是巧合而是前提：JSON.stringify 会把 `{a: undefined}` 序列化成 `{}`，即它把
 * 「键存在但值为 undefined」与「键不存在」视为相同；本函数按键数比较会判为不同。
 * 上面的构造方式保证了这种输入不会出现。若将来 actions 改成允许显式 undefined 的
 * 形状，这里必须同步改——`rowActionsEqualMatchesJsonStringify` 那个测试就是这条
 * 前提的哨兵。
 */
export function rowActionsEqual(a: RowActions | undefined, b: RowActions | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  return aKeys.every((key) => left[key] === right[key]);
}