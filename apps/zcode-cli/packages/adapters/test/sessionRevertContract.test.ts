// session revert 的存取契约（2026-10-09）。
//
// 起因是一次**误报**：性能优化那轮的后台子代理报告
// 「`sqlite-session-store.ts:909` 调用 `setRevert(this.db, sessionID)` 而仓储签名是
// `setRevert(db, input: {...})`，所以每次调用都会抛
// `TypeError: Provided value cannot be bound to SQLite parameter 1`」。
//
// 逐条核实后确认**该 bug 不存在**：
//   · `git log -L` 显示相关代码只在上游 872ad96（open source）被写过，此后未变；
//   · store 的调用体一直是正确的 `sessionRepository.setRevert(this.db, input)`；
//   · 实跑一遍：setRevert 正确落库、clearRevert 正确清空。
//
// 「核实后判定为误报」本身不该只留在提交信息里——把它写成测试，下次再有人
// （包括我自己）怀疑这条路径时，跑一遍就知道，不需要重新翻 git 历史。
// 本测试因此有两个职责：钉住契约本身，以及钉住「它确实能跑通」而不是只过类型。
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSessionStore } from "../src/storage/session-store/sqlite-session-store.js";
import type { SessionRevert } from "@zcode/contracts";

const SESSION_ID = "sess_revert_contract";

function openStore(): { store: SqliteSessionStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "zcode-revert-"));
  const store = new SqliteSessionStore({ dbPath: join(dir, "sessions.db") });
  return { store, dir };
}

/** 建一个可直接改 revert 的会话（字段与 createSession 的绑定顺序一一对应）。 */
async function seedSession(store: SqliteSessionStore): Promise<void> {
  await store.createSession({
    id: SESSION_ID,
    projectID: "proj_revert",
    slug: "revert-contract",
    directory: process.cwd(),
    title: "revert contract",
    version: "1",
    permission: "default",
  } as never);
}

function revertFixture(): SessionRevert {
  return {
    messageID: "msg_probe",
    keptMessageIDs: ["msg_a", "msg_b"],
    branchCutAfterMessageID: "msg_b",
    branchGeneration: 1,
    kind: "conversation_rewind",
  } as unknown as SessionRevert;
}

test("setRevert 把 revert 完整落库（store → repository → SQLite 全链路）", async () => {
  const { store, dir } = openStore();
  try {
    await seedSession(store);
    const revert = revertFixture();

    await store.setRevert({ sessionID: SESSION_ID, revert });

    const read = await store.getSession(SESSION_ID);
    assert.ok(read, "会话应存在");
    assert.deepEqual(read.revert, revert, "revert 必须原样落库");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("setRevert 带 summary 时一并落库", async () => {
  const { store, dir } = openStore();
  try {
    await seedSession(store);

    await store.setRevert({
      sessionID: SESSION_ID,
      revert: revertFixture(),
      summary: { additions: 3, deletions: 1, files: 2 },
    });

    const read = await store.getSession(SESSION_ID);
    assert.equal(read?.summaryAdditions, 3);
    assert.equal(read?.summaryDeletions, 1);
    assert.equal(read?.summaryFiles, 2);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("clearRevert 清空 revert（位置参数签名，不是对象）", async () => {
  const { store, dir } = openStore();
  try {
    await seedSession(store);
    await store.setRevert({ sessionID: SESSION_ID, revert: revertFixture() });

    // 端口签名是 clearRevert(sessionID: SessionId) —— 传对象会在 updateSession
    // 的 .run() 里被当成 named parameters，报 "Unknown named parameter"。
    await store.clearRevert(SESSION_ID);

    const read = await store.getSession(SESSION_ID);
    // 断言语义而非形态：清除后解码出来是 undefined（而非 null）。
    assert.ok(!read?.revert, `期望已清除，实际 ${JSON.stringify(read?.revert)}`);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("setRevert 覆盖前一次的值（不是合并）", async () => {
  const { store, dir } = openStore();
  try {
    await seedSession(store);
    await store.setRevert({ sessionID: SESSION_ID, revert: revertFixture() });

    const second = { ...revertFixture(), messageID: "msg_second" } as SessionRevert;
    await store.setRevert({ sessionID: SESSION_ID, revert: second });

    const read = await store.getSession(SESSION_ID);
    assert.equal(read?.revert?.messageID, "msg_second", "应整体覆盖而不是保留旧字段");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("clearRevert 在从未设置过 revert 的会话上是 no-op 而不是抛错", async () => {
  const { store, dir } = openStore();
  try {
    await seedSession(store);
    await store.clearRevert(SESSION_ID);
    const read = await store.getSession(SESSION_ID);
    // 断言语义（「没有 revert」）而不是具体形态：从未设置过时解码出来是 undefined，
    // 设置过再清除是 null——两者对调用方都等价于「无 rewind 前缀」。
    assert.ok(!read?.revert, `期望无 revert，实际 ${JSON.stringify(read?.revert)}`);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("对不存在的会话 setRevert 会抛错（不静默吞掉）", async () => {
  const { store, dir } = openStore();
  try {
    await assert.rejects(
      () => store.setRevert({ sessionID: "sess_missing", revert: revertFixture() }),
      /Session not found/,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});