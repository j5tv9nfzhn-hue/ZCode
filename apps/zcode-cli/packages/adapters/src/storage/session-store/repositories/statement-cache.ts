import type { DatabaseSync, StatementSync } from "node:sqlite";

// node:sqlite 的 db.prepare 每次调用都要重新解析 SQL。一次 tool call 会写 3 次 part
// （pending/running/completed）外加 message 与 step-start part，而 part upsert 里嵌了
// json_set/json_extract 的 preserveLegacyMembers 表达式，重复解析的代价明显。
// 这里按 (连接, SQL 文本) 记忆化 statement：SQL 全部来自模块级常量，文本稳定，
// 每条语句每个连接只解析一次。
//
// 连接关闭的安全性（node 24.20 实测）：
// - db.close() 会 finalize 该连接上全部 statement，之后 StatementSync.run()/get() 立刻抛
//   "statement has been finalized"，不会静默写错数据。
// - 这里再显式挡一层：db.isOpen 为假时丢掉该连接的缓存并回落到 db.prepare()，调用方拿到的
//   仍是无缓存路径原本的 "database is not open"，错误语义不变。
// - db.open() 复活连接不会复活 statement。本仓库的 close 是终态（SqliteSessionStore 不重开），
//   万一发生也只是显式报错，不会写坏数据。
//
// WeakMap 按连接身份分桶：进程内出现第二个 DatabaseSync（多 store、测试用 :memory: 实例）时
// 各自持有独立缓存，连接被 GC 后缓存随之回收，不会按 DatabaseSync 泄漏。
const statementsByDatabase = new WeakMap<DatabaseSync, Map<string, StatementSync>>();

export function prepareStatement(db: DatabaseSync, sql: string): StatementSync {
  if (!db.isOpen) {
    statementsByDatabase.delete(db);
    // 保留原始报错（"database is not open"），不要用缓存句柄掩盖连接已关闭的事实。
    return db.prepare(sql);
  }
  let statements = statementsByDatabase.get(db);
  if (!statements) {
    statements = new Map();
    statementsByDatabase.set(db, statements);
  }
  const cached = statements.get(sql);
  if (cached) return cached;
  const prepared = db.prepare(sql);
  statements.set(sql, prepared);
  return prepared;
}
