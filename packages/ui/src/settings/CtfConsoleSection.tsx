import { useEffect, useRef, useState } from "react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useServices } from "@/hooks/useServices.js";
import {
  CtfConsoleConfigPanel,
  type InterceptJudgeFailAction,
} from "@/settings/CtfConsoleConfigPanel.js";
import { CtfConsoleCoveragePanel } from "@/settings/CtfConsoleCoveragePanel.js";
import { CtfConsoleOrchestrationPanel } from "@/settings/CtfConsoleOrchestrationPanel.js";
import type { SessionDebugPentestOverview } from "@zcode/shared";

const POLL_INTERVAL_MS = 3000;

/**
 * 编排态势轮询：先发现当前工作区最新会话，再读它的 pentestOverview。
 *
 * 合并为一个定时器（原先事件日志与态势各一个，白跑两轮 IPC）。快照只在
 * 内容真正变化时才 setState，避免每 3 秒用新对象引用触发整棵子树重渲染。
 */
function usePentestOverview(workspacePath?: string, workspaceIdentity?: string) {
  const services = useServices();
  const [overview, setOverview] = useState<SessionDebugPentestOverview | null | undefined>(
    undefined,
  );
  const sessionIdRef = useRef<string | undefined>(undefined);
  const lastJsonRef = useRef<string | null>(null);

  useEffect(() => {
    if (!workspacePath) {
      setOverview(undefined);
      return;
    }
    let stopped = false;
    const target = workspaceIdentity ? { workspacePath, workspaceIdentity } : { workspacePath };

    const poll = async (): Promise<void> => {
      try {
        if (!sessionIdRef.current) {
          const sessions = await services.zcodeAgentService.listSessions({
            ...target,
            runtimePolicy: "existing-only",
          });
          const latest = sessions[0];
          if (!latest || stopped) return;
          sessionIdRef.current = latest.sessionId;
        }
        const snapshot = await services.zcodeAgentService.readSessionDebug({
          ...target,
          sessionId: sessionIdRef.current,
        });
        if (stopped) return;
        // 内容比较：schema parse 每次都产出新引用，直接 set 会让面板每 3 秒重渲染一次。
        const next = snapshot.pentestOverview;
        const nextJson = next === null ? "null" : JSON.stringify(next);
        if (nextJson !== lastJsonRef.current) {
          lastJsonRef.current = nextJson;
          setOverview(next);
        }
      } catch {
        // 会话不存在/未就绪/远程不可达：保持上一个快照（首次为 undefined），不抛错。
        if (!stopped) setOverview(undefined);
      }
    };

    const timer = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);
    void poll();
    return () => {
      stopped = true;
      clearInterval(timer);
      sessionIdRef.current = undefined;
      lastJsonRef.current = null;
    };
  }, [services.zcodeAgentService, workspaceIdentity, workspacePath]);

  return overview;
}

export function CtfConsoleSection({
  assistantCoTPrefillEnabled,
  unfilteredFullOutputEnabled,
  pentestOrchestrationEnabled,
  interceptEnabled,
  interceptJudgeEnabled,
  interceptJudgeFailAction,
  workspacePath,
  workspaceIdentity,
  onAssistantCoTPrefillEnabledChange,
  onUnfilteredFullOutputChange,
  onPentestOrchestrationChange,
  onInterceptEnabledChange,
  onInterceptJudgeEnabledChange,
  onInterceptJudgeFailActionChange,
}: {
  assistantCoTPrefillEnabled: boolean;
  unfilteredFullOutputEnabled: boolean;
  /** 渗透编排总开关（默认关闭）。 */
  pentestOrchestrationEnabled: boolean;
  /** 工具调用拦截层（对齐 ARTEX guard + intercept，默认开启）。 */
  interceptEnabled: boolean;
  interceptJudgeEnabled: boolean;
  interceptJudgeFailAction: InterceptJudgeFailAction;
  workspacePath?: string;
  workspaceIdentity?: string;
  onAssistantCoTPrefillEnabledChange: (enabled: boolean) => Promise<void>;
  onUnfilteredFullOutputChange: (enabled: boolean) => Promise<void>;
  onPentestOrchestrationChange: (enabled: boolean) => Promise<void>;
  onInterceptEnabledChange: (enabled: boolean) => Promise<void>;
  onInterceptJudgeEnabledChange: (enabled: boolean) => Promise<void>;
  onInterceptJudgeFailActionChange: (action: InterceptJudgeFailAction) => Promise<void>;
}) {
  const { intl } = useZCodeIntl();
  const pentestOverview = usePentestOverview(workspacePath, workspaceIdentity);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card px-4 py-3">
        <h2 className="text-ui-lg text-foreground">
          {intl.formatMessage({ id: "settings.ctfConsole.title" })}
        </h2>
        <p className="mt-1 text-ui-caption text-foreground-subtle">
          {intl.formatMessage({ id: "settings.ctfConsole.description" })}
        </p>
      </div>

      <CtfConsoleConfigPanel
        assistantCoTPrefillEnabled={assistantCoTPrefillEnabled}
        unfilteredFullOutputEnabled={unfilteredFullOutputEnabled}
        onAssistantCoTPrefillEnabledChange={onAssistantCoTPrefillEnabledChange}
        onUnfilteredFullOutputChange={onUnfilteredFullOutputChange}
        pentestOrchestrationEnabled={pentestOrchestrationEnabled}
        onPentestOrchestrationChange={onPentestOrchestrationChange}
        interceptEnabled={interceptEnabled}
        interceptJudgeEnabled={interceptJudgeEnabled}
        interceptJudgeFailAction={interceptJudgeFailAction}
        onInterceptEnabledChange={onInterceptEnabledChange}
        onInterceptJudgeEnabledChange={onInterceptJudgeEnabledChange}
        onInterceptJudgeFailActionChange={onInterceptJudgeFailActionChange}
      />

      <CtfConsoleCoveragePanel overview={pentestOverview} />

      <CtfConsoleOrchestrationPanel overview={pentestOverview} />
    </div>
  );
}
