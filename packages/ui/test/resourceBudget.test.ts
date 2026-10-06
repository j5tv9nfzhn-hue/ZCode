import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRendererPerformanceMode,
  deriveResourceBudget,
} from "../../shared/src/resource-budget.js";

const GB = 1024 ** 3;

/**
 * 本仓库调研过的一台真实机器：i3-3110M（2C/4T、2.4GHz 无睿频）、7.85GB 内存、
 * 核显 HD 4000。这组断言就是「低配机必须被判成 low」的直接依据。
 */
const LOW_SPEC_MACHINE = { totalMemBytes: Math.round(7.85 * GB), cpuCount: 4 };

test("低配机器被判为 low，并同时收紧进程与渲染两侧", () => {
  const budget = deriveResourceBudget(LOW_SPEC_MACHINE);
  assert.equal(budget.tier, "low");
  assert.equal(budget.processes.agentProcessMax, 2);
  assert.ok(budget.processes.agentIdleTimeoutMs !== undefined);
  assert.equal(budget.renderer.diffsWorkerPool, 1);
  assert.equal(budget.renderer.reducedMotion, true);
  assert.equal(budget.renderer.autoOpenGeneratedDocs, false);
});

test("8GB 边界按 <= 判为 low，而不是被 deviceMemory 的分桶抬到 mid", () => {
  // navigator.deviceMemory 按 0.25/0.5/1/2/4/8 分桶且上限 8，8GB 机器上报的就是 8。
  // 若这里用 <，最需要降级的 8GB 机器会漏到 mid。
  assert.equal(deriveResourceBudget({ totalMemBytes: 8 * GB, cpuCount: 8 }).tier, "low");
  assert.equal(deriveResourceBudget({ totalMemBytes: 8 * GB, cpuCount: 16 }).tier, "low");
});

test("高配机器不做空闲回收，且 diffs 池按核数的一半计算", () => {
  const budget = deriveResourceBudget({ totalMemBytes: 64 * GB, cpuCount: 16 });
  assert.equal(budget.tier, "high");
  // 高配上主动回收只会换来用户没要求的冷恢复延迟。
  assert.equal(budget.processes.agentIdleTimeoutMs, undefined);
  assert.equal(budget.processes.agentProcessMax, 12);
  assert.equal(budget.renderer.diffsWorkerPool, 4);
  assert.equal(budget.renderer.reducedMotion, false);
});

test("高核少内存仍按内存判 mid，不被核数单独抬到 high", () => {
  const budget = deriveResourceBudget({ totalMemBytes: 12 * GB, cpuCount: 32 });
  assert.equal(budget.tier, "mid");
  assert.equal(budget.processes.agentProcessMax, 4);
});

test("探测不全时退回 mid，而不是把探测失败当成低配", () => {
  for (const probe of [{}, { totalMemBytes: undefined, cpuCount: undefined }]) {
    assert.equal(deriveResourceBudget(probe).tier, "mid");
  }
  // 只有核数时也要能判：4 核笔记本没有 deviceMemory 也必须落 low。
  assert.equal(deriveResourceBudget({ cpuCount: 4 }).tier, "low");
});

test("非法探测值不被当成事实", () => {
  const budget = deriveResourceBudget({ totalMemBytes: 0, cpuCount: Number.NaN });
  assert.equal(budget.tier, "mid");
  assert.equal(budget.renderer.diffsWorkerPool, 2);
});

test("性能模式只改渲染段，绝不触碰进程侧预算", () => {
  const auto = deriveResourceBudget({ totalMemBytes: 64 * GB, cpuCount: 16 });
  const overridden = applyRendererPerformanceMode(auto, true);
  // 进程侧预算由 Host 按自己的机器推导，Renderer 的开关改不到也不该改。
  assert.deepEqual(overridden.processes, auto.processes);
  assert.equal(overridden.tier, auto.tier);
  assert.equal(overridden.renderer.diffsWorkerPool, 1);
  assert.equal(overridden.renderer.reducedMotion, true);
  assert.equal(overridden.renderer.autoOpenGeneratedDocs, false);
});

test("关闭性能模式不会把低配机器的进程侧保护一起关掉", () => {
  const auto = deriveResourceBudget(LOW_SPEC_MACHINE);
  // 必须原样返回同一个对象：用户关掉开关不等于要求恢复高档位。
  assert.equal(applyRendererPerformanceMode(auto, false), auto);
});