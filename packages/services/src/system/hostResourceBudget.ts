import os from "node:os";
import { deriveResourceBudget, type ResourceBudget } from "@zcode/shared";

/**
 * Host / 远程 stdio 服务端所在进程的进程侧资源预算。每个进程推导一次并缓存。
 *
 * 「每进程一次」是刻意的：预算描述的是**本进程自己的机器**。远程工作区的 agent 跑在远端，
 * 那里会跑自己的 `hostResourceBudget()`，因此远程链路天然按远端机器分档，不需要把
 * 客户端的机器事实传过去。同一进程内再推导第二次就会有两个可能不一致的预算副本，
 * 所以这里缓存单例。
 *
 * 纯函数在 `@zcode/shared`；这里只负责探测，且不抛错——探测失败就按 mid 档跑，
 * 不让「读不到内存大小」阻断 agent 启动。
 */
let cachedBudget: ResourceBudget | undefined;

export function hostResourceBudget(): ResourceBudget {
  if (cachedBudget) {
    return cachedBudget;
  }
  cachedBudget = deriveResourceBudget(readHostResourceBudgetProbe());
  return cachedBudget;
}

function readHostResourceBudgetProbe(): { totalMemBytes?: number; cpuCount?: number } {
  try {
    return { totalMemBytes: os.totalmem(), cpuCount: os.cpus().length };
  } catch {
    return {};
  }
}
