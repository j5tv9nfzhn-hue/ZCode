// usage 保留期清理的摊销（2026-10-09 性能修复）回归测试。
//
// 背景：原先 recordModelUsage / upsertTurnUsage / upsertToolUsage 每次写完都跑一遍
// pruneUsage（begin immediate + 3 条 delete + commit 的**同步**写事务）。
// upsertToolUsage 由 ToolCallProgress 驱动（Bash 输出轮询约 1s 一次），于是每个
// 运行中的命令每秒开一次写事务，只为删几行早于 30 天的数据。
//
// 修复：自动清理摊销到最多每 1 小时一次（保留期仍是 30 天，保证不被削弱）；
// 显式调用 pruneUsage 仍然强制执行。
//
// 本测试的可观测点：摊销生效时，**第一次清理之后新插入的超期行会存活**，
// 直到间隔过去或有人显式调用 pruneUsage。这正是「摊销」的定义。
import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { ToolUsageRecord } from "@zcode/contracts";
import { SQLITE_MIGRATIONS } from "../src/storage/session-store/migrations.js";
import { pruneUsage, upsertToolUsage } from "../src/storage/session-store/repositories/usage.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** 保留期 30 天；造 40 天前的行 = 已超期。 */
const EXPIRED_AT = Date.now() - 40 * DAY_MS;

function toolUsage(id: string, startedAt: number): ToolUsageRecord {
  // 只填 toolUsageValues() 里没有 `?? null` / `integer()` / `boolean()` 兜底的字段——
  // 其余必须保持 undefined，否则 SQLite 会拒绝绑定（ERR_INVALID_ARG_TYPE）。
  return {
    id,
    sessionID: "sess_usage",
    toolCallID: `call_${id}`,
    toolName: "Bash",
    status: "running",
    startedAt,
  } as unknown as ToolUsageRecord;
}

/**
 * 用真实迁移建表。
 *
 * tool_usage 有 27 列、且 `session_id` 带 `references session(id)` 外键——手搓 schema
 * 必然漏列；它也不在第一条迁移里（在迁移族后续条目），所以按序应用**全部**迁移，
 * 与 migration-runner 走同一份 SQL。
 *
 * 另注：migration-runner.ts:161 在跑迁移前自己建 `schema_migration`，后续迁移会引用它，
 * 这里不建就会报「no such table: schema_migration」。它同样开 `pragma foreign_keys = on`。
 */
function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`create table if not exists schema_migration (
    id text primary key, checksum text not null, app_version text, time_applied integer not null
  )`);
  for (const migration of SQLITE_MIGRATIONS) db.exec(migration.sql);
  db.exec("pragma foreign_keys = on");
  const now = Date.now();
  db.prepare(
    `insert into session (id, project_id, slug, directory, title, version, time_created, time_updated)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("sess_usage", "proj_1", "sess-usage", "/tmp", "usage test", "1", now, now);
  return db;
}

/** 插入一行「已超期」的工具用量；session_id / tool_call_id / tool_name / status 均非空。 */
function insertExpiredToolUsage(db: DatabaseSync, id: string): void {
  db.prepare(
    `insert into tool_usage (id, session_id, tool_call_id, tool_name, status, started_at)
     values (?, ?, ?, ?, ?, ?)`,
  ).run(id, "sess_usage", `call_${id}`, "Bash", "completed", EXPIRED_AT);
}

function countExpiredToolUsage(db: DatabaseSync): number {
  const row = db
    .prepare("select count(*) as n from tool_usage where started_at < ?")
    .get(Date.now() - 30 * DAY_MS) as unknown as { n: number };
  return row.n;
}

test("首次写入会触发一次保留期清理（摊销不牺牲保留期保证）", async () => {
  const db = freshDb();
  insertExpiredToolUsage(db, "stale");

  await upsertToolUsage(db, toolUsage("fresh", Date.now()));

  assert.equal(countExpiredToolUsage(db), 0, "首次写入必须执行清理，超期行应被删掉");
  db.close();
});

test("摊销生效：间隔内的后续写入不再重复清理写事务", async () => {
  const db = freshDb();
  // 第一次写入 → 触发清理并记时间戳。
  await upsertToolUsage(db, toolUsage("first", Date.now()));
  insertExpiredToolUsage(db, "stale2");

  await upsertToolUsage(db, toolUsage("second", Date.now()));

  assert.equal(
    countExpiredToolUsage(db),
    1,
    "摊销窗口内的后续写入不应再跑清理（这正是被消除的「每写一次一个同步写事务」）",
  );
  db.close();
});

test("显式 pruneUsage 仍然强制执行，不受摊销影响", async () => {
  const db = freshDb();
  await upsertToolUsage(db, toolUsage("first", Date.now()));
  insertExpiredToolUsage(db, "stale3");

  // 显式调用（store port 上暴露的那条路径）必须立刻清理。
  await pruneUsage(db);

  assert.equal(countExpiredToolUsage(db), 0, "显式 pruneUsage 必须无视摊销窗口立即清理");
  db.close();
});

test("不同 DatabaseSync 实例各自独立节流（多 workspace 场景）", async () => {
  const dbA = freshDb();
  const dbB = freshDb();
  await upsertToolUsage(dbA, toolUsage("a1", Date.now()));
  await upsertToolUsage(dbB, toolUsage("b1", Date.now()));

  // 两个实例都完成了各自的首轮清理 → 各自记了自己的时间戳，不共享。
  insertExpiredToolUsage(dbA, "staleA");
  insertExpiredToolUsage(dbB, "staleB");
  await upsertToolUsage(dbA, toolUsage("a2", Date.now()));
  await upsertToolUsage(dbB, toolUsage("b2", Date.now()));

  assert.equal(countExpiredToolUsage(dbA), 1, "dbA 的摊销窗口内不应再清理");
  assert.equal(countExpiredToolUsage(dbB), 1, "dbB 的摊销窗口内不应再清理");
  dbA.close();
  dbB.close();
});