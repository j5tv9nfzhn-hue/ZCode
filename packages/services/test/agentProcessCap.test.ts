import assert from "node:assert/strict";
import test from "node:test";
import { selectLruReclaimWorkspaceKeys } from "../src/zcode-agent/zcodeAgentProcessCap.js";

const NOW = 1_000_000;

function candidate(
  workspaceKey: string,
  lastActivityAt: number,
  idle = true,
): { workspaceKey: string; lastActivityAt: number; idle: boolean } {
  return { workspaceKey, lastActivityAt, idle };
}

test("名额够时按最久未使用排序回收", () => {
  const keys = selectLruReclaimWorkspaceKeys({
    candidates: [
      candidate("recent", NOW - 1_000),
      candidate("oldest", NOW - 90_000),
      candidate("middle", NOW - 30_000),
    ],
    excludeWorkspaceKey: "starting",
    reclaimCount: 2,
    now: NOW,
    minIdleMs: 10_000,
  });
  assert.deepEqual(keys, ["oldest", "middle"]);
});

test("正在启动的那个 workspace 不会被回收", () => {
  const keys = selectLruReclaimWorkspaceKeys({
    candidates: [candidate("starting", NOW - 999_999), candidate("other", NOW - 60_000)],
    excludeWorkspaceKey: "starting",
    reclaimCount: 5,
    now: NOW,
    minIdleMs: 0,
  });
  assert.deepEqual(keys, ["other"]);
});

test("有在飞请求或仍在等存储启动的进程不可回收", () => {
  const keys = selectLruReclaimWorkspaceKeys({
    candidates: [
      candidate("has-request-in-flight", NOW - 999_999, false),
      candidate("awaiting-storage", NOW - 999_999, false),
      candidate("idle", NOW - 60_000),
    ],
    excludeWorkspaceKey: "starting",
    reclaimCount: 5,
    now: NOW,
    minIdleMs: 0,
  });
  // 宁可少回收也不打断正在跑的请求，也不回收还没完成存储准备的进程。
  assert.deepEqual(keys, ["idle"]);
});

test("空闲不足 minIdleMs 的进程留给以后，刚用过的 workspace 不被立刻冷恢复", () => {
  const keys = selectLruReclaimWorkspaceKeys({
    candidates: [candidate("just-used", NOW - 1_000), candidate("cold", NOW - 120_000)],
    excludeWorkspaceKey: "starting",
    reclaimCount: 5,
    now: NOW,
    minIdleMs: 60_000,
  });
  assert.deepEqual(keys, ["cold"]);
});

test("候选不足时返回已有候选，由调用方决定是否带警告继续 spawn", () => {
  const keys = selectLruReclaimWorkspaceKeys({
    candidates: [candidate("only", NOW - 60_000)],
    excludeWorkspaceKey: "starting",
    reclaimCount: 3,
    now: NOW,
    minIdleMs: 0,
  });
  assert.deepEqual(keys, ["only"]);
});

test("不需要回收时返回空数组，不做任何排序", () => {
  assert.deepEqual(
    selectLruReclaimWorkspaceKeys({
      candidates: [candidate("a", 0)],
      excludeWorkspaceKey: "starting",
      reclaimCount: 0,
      now: NOW,
      minIdleMs: 0,
    }),
    [],
  );
});

test("活动时间相同时按 workspaceKey 排序，回收顺序与插入顺序无关", () => {
  const sameActivityAt = NOW - 60_000;
  const keys = selectLruReclaimWorkspaceKeys({
    candidates: [
      candidate("zeta", sameActivityAt),
      candidate("alpha", sameActivityAt),
      candidate("mid", sameActivityAt),
    ],
    excludeWorkspaceKey: "starting",
    reclaimCount: 2,
    now: NOW,
    minIdleMs: 0,
  });
  assert.deepEqual(keys, ["alpha", "mid"]);
});