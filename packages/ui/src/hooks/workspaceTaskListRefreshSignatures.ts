import type { ZCodeTaskMeta } from "@zcode/shared";

type WorkspaceTaskListVersionEntry = readonly [workspaceKey: string, version: number];

interface WorkspaceRemoteSessionSignatureEntry {
  workspaceKey: string;
  remoteSessionId?: string;
  ready: boolean;
}

function sortByWorkspaceKey<T extends { workspaceKey: string }>(entries: ReadonlyArray<T>): T[] {
  return [...entries].sort((left, right) => left.workspaceKey.localeCompare(right.workspaceKey));
}

export function buildWorkspaceTaskListVersionEntries(
  entries: ReadonlyArray<WorkspaceTaskListVersionEntry>,
): string[] {
  // 返回排序后的 `workspaceKey:version` 原始条目，调用方用 useShallow 做结构相等。
  // 旧实现返回 JSON 字符串，代价是「选择器里 stringify + render 期 parse」的序列化往返，
  // 而这段代码在每次 store 提交时都会执行。版本号非负且位于末尾，
  // 因此用 lastIndexOf 定位分隔符，workspaceKey 自身含 ":" 也不会解析错。
  return entries.map(([workspaceKey, version]) => `${workspaceKey}:${version}`).sort();
}

export function joinWorkspaceTaskListVersionSignature(entries: ReadonlyArray<string>): string {
  return entries.join("\u0000");
}

export function parseWorkspaceTaskListVersions(
  entries: ReadonlyArray<string>,
): Map<string, number> {
  const versions = new Map<string, number>();
  for (const entry of entries) {
    const separatorIndex = entry.lastIndexOf(":");
    versions.set(entry.slice(0, separatorIndex), Number(entry.slice(separatorIndex + 1)));
  }
  return versions;
}

export function buildWorkspaceRemoteSessionSignature(
  entries: ReadonlyArray<WorkspaceRemoteSessionSignatureEntry>,
): string {
  return sortByWorkspaceKey(entries)
    .map((entry) => `${entry.workspaceKey}:${entry.remoteSessionId ?? "base"}:${entry.ready}`)
    .join("|");
}

export function areTaskListItemsEquivalent(left: ZCodeTaskMeta[], right: ZCodeTaskMeta[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((leftTask, index) => {
    const rightTask = right[index];
    return Boolean(
      rightTask &&
      leftTask.taskId === rightTask.taskId &&
      leftTask.title === rightTask.title &&
      leftTask.updatedAt === rightTask.updatedAt &&
      leftTask.createdAt === rightTask.createdAt &&
      leftTask.status === rightTask.status &&
      leftTask.unreadAt === rightTask.unreadAt &&
      leftTask.provider === rightTask.provider &&
      leftTask.model === rightTask.model,
    );
  });
}
