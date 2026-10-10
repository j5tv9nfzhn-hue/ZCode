import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useShallow } from "zustand/react/shallow";
import type {
  WindowHostControllerTaskListItem,
  ZCodeTaskListKind,
  ZCodeTaskListWorkspaceScope,
} from "@zcode/services";
import { logger } from "@/logger.js";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";
import { selectWorkspaceZCodeState, useZCodeSessionStore } from "@/store/zcodeSessionStore.js";
import { attachTaskListRowActivity } from "@/v4/taskListRowActivity.js";
import { stabilizeTaskListItems } from "@/v4/taskListItemStabilization.js";
import { getWindowControllerTaskListRegistry } from "@/v4/windowControllerTaskListRegistry.js";
import type { WindowControllerTaskListVersion } from "@/v4/windowControllerTaskListRegistry.js";
import {
  buildWorkspaceTaskListVersionEntries,
  joinWorkspaceTaskListVersionSignature,
} from "@/hooks/workspaceTaskListRefreshSignatures.js";

type GlobalTaskListItem = WindowHostControllerTaskListItem;

const subscribeToNothing = () => () => {};
const zeroRevision = () => 0;

function buildWorkspaceScopes(workspaceTabs: WorkspaceTabState[]): ZCodeTaskListWorkspaceScope[] {
  const scopes = new Map<string, ZCodeTaskListWorkspaceScope>();
  for (const tab of workspaceTabs) {
    const scope = {
      workspacePath: tab.workspacePath,
      ...(tab.workspaceIdentity ? { workspaceIdentity: tab.workspaceIdentity } : {}),
    };
    scopes.set(
      JSON.stringify([tab.workspaceIdentity?.trim() || tab.workspacePath, tab.workspacePath]),
      scope,
    );
  }
  return Array.from(scopes.values());
}

export function useGlobalTaskList(params: {
  kind: ZCodeTaskListKind;
  workspaceTabs: WorkspaceTabState[];
  sortBy: "created" | "updated";
  searchQuery: string;
  expanded: boolean;
  collapsedLimit: number;
}) {
  const baseServices = useBaseWorkspaceServices();
  const controller = baseServices.windowControllerService;
  const controllerRegistry = useMemo(
    () => (controller ? getWindowControllerTaskListRegistry(controller) : null),
    [controller],
  );
  const controllerRevision = useSyncExternalStore(
    controllerRegistry?.subscribe ?? subscribeToNothing,
    controllerRegistry?.getRevision ?? zeroRevision,
    controllerRegistry?.getRevision ?? zeroRevision,
  );
  // 这两个签名只在依赖数组里用（判 workspaceTabs 是否实质变化），不参与对外契约。
  // 原先在 render 期直接执行「map + sort + 整数组 JSON.stringify」，每次父组件 render 都跑；
  // 改为 useMemo 缓存 + 分隔符拼接（避免 JSON 序列化开销）。分隔符选 `\u0000`
  // 与 joinWorkspaceTaskListVersionSignature 一致：workspacePath 可能含任意可打印字符，
  // 控制字符不出现在合法路径里。
  const workspaceSignature = useMemo(
    () =>
      params.workspaceTabs
        .map(
          (tab) => [tab.workspaceIdentity?.trim() || tab.workspacePath, tab.workspacePath] as const,
        )
        .sort(
          ([leftKey, leftPath], [rightKey, rightPath]) =>
            leftKey.localeCompare(rightKey) || leftPath.localeCompare(rightPath),
        )
        .map(([key, path]) => `${key}\u0000${path}`)
        .join("\u0001"),
    [params.workspaceTabs],
  );
  const workspaceSourceGenerationSignature = useMemo(
    () =>
      params.workspaceTabs
        .map(
          (tab) =>
            [
              tab.workspaceIdentity?.trim() || tab.workspacePath,
              tab.workspacePath,
              tab.remoteSessionId?.trim() || "",
            ] as const,
        )
        .sort(
          ([leftKey, leftPath, leftSession], [rightKey, rightPath, rightSession]) =>
            leftKey.localeCompare(rightKey) ||
            leftPath.localeCompare(rightPath) ||
            leftSession.localeCompare(rightSession),
        )
        .map(([key, path, session]) => `${key}\u0000${path}\u0000${session}`)
        .join("\u0001"),
    [params.workspaceTabs],
  );
  const workspaceScopes = useMemo(
    () => buildWorkspaceScopes(params.workspaceTabs),
    // workspaceSignature 是标准化后的 scope 值签名，避免父组件重建 tabs 数组时重复查询。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaceSignature],
  );
  // useShallow + 原始字符串条目：selector 每次 store 提交都会跑，在里面 JSON.stringify
  // 会把「选择器求值」变成一次全量序列化。旧实现在高频 activity 帧下是明确的卡顿点。
  // 与 useWorkspaceTaskLists 同一模式（该处已是正确写法）。
  const taskListVersionEntries = useZCodeSessionStore(
    useShallow((state) =>
      buildWorkspaceTaskListVersionEntries(
        params.workspaceTabs.map((tab) => {
          const workspace = selectWorkspaceZCodeState(
            state,
            tab.workspacePath,
            tab.workspaceIdentity,
          );
          return [
            tab.workspaceIdentity?.trim() || tab.workspacePath,
            workspace.taskListVersion,
          ] as const;
        }),
      ),
    ),
  );
  const taskListVersionSignature = useMemo(
    () => joinWorkspaceTaskListVersionSignature(taskListVersionEntries),
    [taskListVersionEntries],
  );
  const [items, setItems] = useState<GlobalTaskListItem[]>([]);
  const itemsRef = useRef<GlobalTaskListItem[]>(items);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(workspaceScopes.length > 0);
  const requestSerialRef = useRef(0);
  const manualRefreshSerialRef = useRef(0);

  const query = useMemo(
    () => ({
      kind: params.kind,
      workspaceScopes,
      sortBy: params.sortBy,
      search: params.searchQuery.trim() || undefined,
      limit: params.expanded ? undefined : params.collapsedLimit,
    }),
    [
      params.collapsedLimit,
      params.expanded,
      params.kind,
      params.searchQuery,
      params.sortBy,
      workspaceScopes,
    ],
  );
  const queryKey = useMemo(() => JSON.stringify(query), [query]);

  const load = useCallback(
    async (version: WindowControllerTaskListVersion) => {
      const requestSerial = ++requestSerialRef.current;
      if (workspaceScopes.length === 0) {
        setItems([]);
        itemsRef.current = [];
        setTotal(0);
        setHasMore(false);
        setLoading(false);
        return;
      }
      if (!controllerRegistry) {
        // 原子切换后 base attachment 必须提供 Controller；缺失代表 Host/Renderer 版本不一致。
        logger.error("[useGlobalTaskList] window Host Controller channel unavailable");
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const result = await controllerRegistry.list(queryKey, version, query);
        if (requestSerialRef.current !== requestSerial) {
          return;
        }
        // Controller 的每个 activity 帧（运行中任务的 tool 调用等）都会让本 hook 重查，
        // 而 attachTaskListRowActivity 与 tasks-index join 每次都产生全新对象。下游（grouped 视图）
        // 只能按引用判等，于是整棵列表树换代重渲染并重测量虚拟器。这里与 sessions-index lane 同款
        // 逐条引用稳定化：内容等价复用旧对象，整表等价复用旧数组。
        const nextItems = stabilizeTaskListItems(
          itemsRef.current,
          result.items.map((item) =>
            item.activity ? attachTaskListRowActivity(item, item.activity) : item,
          ),
        );
        itemsRef.current = nextItems;
        setItems(nextItems);
        setTotal(result.total);
        setHasMore(result.hasMore);
      } catch (error) {
        if (requestSerialRef.current === requestSerial) {
          // Controller 查询失败时保留最后可信列表，避免单 source 异常清空其他 workspace。
          logger.error(`[useGlobalTaskList] Controller 加载 ${params.kind} 列表失败`, error);
        }
      } finally {
        if (requestSerialRef.current === requestSerial) {
          setLoading(false);
        }
      }
    },
    [controllerRegistry, params.kind, query, queryKey, workspaceScopes],
  );

  const refresh = useCallback(async () => {
    manualRefreshSerialRef.current += 1;
    await load({
      controllerRevision,
      taskListVersionSignature,
      workspaceSourceGenerationSignature,
      manualRefreshSerial: manualRefreshSerialRef.current,
    });
  }, [controllerRevision, load, taskListVersionSignature, workspaceSourceGenerationSignature]);

  useEffect(() => {
    // 远程 workspace 从断开占位恢复为在线 session 时 identity/path 不变，
    // taskListVersion 也可能尚未变化，旧缓存因此永久保留连接前的空结果。remoteSessionId
    // 只作为 source 代际触发重查，不改变 workspaceIdentity 与 Controller 查询契约。
    void load({
      controllerRevision,
      taskListVersionSignature,
      workspaceSourceGenerationSignature,
    });
  }, [controllerRevision, load, taskListVersionSignature, workspaceSourceGenerationSignature]);

  const hasRemoteScope = params.workspaceTabs.some((tab) => Boolean(tab.workspaceIdentity));
  return {
    items,
    total,
    hasMore,
    loading,
    syncingRemoteWorkspaces: loading && hasRemoteScope,
    refresh,
  };
}
