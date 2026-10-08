import { useCallback, useEffect, useRef, useState } from "react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useServices } from "@/hooks/useServices.js";
import { CtfConsoleConfigPanel } from "@/settings/CtfConsoleConfigPanel.js";
import { CtfConsoleLogPanel, type CtfConsoleLogEntry } from "@/settings/CtfConsoleLogPanel.js";
import { CtfConsoleProbePanel } from "@/settings/CtfConsoleProbePanel.js";

const MAX_LOG_ENTRIES = 300;
const POLL_INTERVAL_MS = 3000;

function summarizeEvent(event: { type: string; seq: number; payload?: unknown }): {
  level: CtfConsoleLogEntry["level"];
  title: string;
  detail?: string;
} {
  if (event.type === "tool.updated") {
    const payload = event.payload as { toolName?: string; state?: unknown } | undefined;
    return {
      level: "tool",
      title: `tool ${payload?.toolName ?? "unknown"}`,
      detail: payload?.state ? JSON.stringify(payload.state).slice(0, 160) : undefined,
    };
  }
  if (event.type === "model.streaming") return { level: "model", title: "model.streaming" };
  if (event.type.startsWith("turn.")) return { level: "session", title: event.type };
  if (event.type.startsWith("session.")) return { level: "session", title: event.type };
  return { level: "session", title: event.type };
}

export function CtfConsoleSection({
  neutralTaskProjectionEnabled,
  assistantCoTPrefillEnabled,
  unfilteredFullOutputEnabled,
  workspacePath,
  workspaceIdentity,
  onNeutralTaskProjectionChange,
  onAssistantCoTPrefillEnabledChange,
  onUnfilteredFullOutputChange,
}: {
  neutralTaskProjectionEnabled: boolean;
  assistantCoTPrefillEnabled: boolean;
  unfilteredFullOutputEnabled: boolean;
  workspacePath?: string;
  workspaceIdentity?: string;
  onNeutralTaskProjectionChange: (enabled: boolean) => Promise<void>;
  onAssistantCoTPrefillEnabledChange: (enabled: boolean) => Promise<void>;
  onUnfilteredFullOutputChange: (enabled: boolean) => Promise<void>;
}) {
  const { intl } = useZCodeIntl();
  const services = useServices();
  const [entries, setEntries] = useState<CtfConsoleLogEntry[]>([]);
  const [live, setLive] = useState(false);
  const sessionIdRef = useRef<string | undefined>(undefined);
  const lastSeqRef = useRef<number>(-1);

  const appendEntries = useCallback((incoming: readonly CtfConsoleLogEntry[]) => {
    if (incoming.length === 0) return;
    setEntries((previous) => [...previous, ...incoming].slice(-MAX_LOG_ENTRIES));
  }, []);

  // 轮询会话事件作为实时日志源：按 seq 增量拉取，避免重复与全量扫描。
  useEffect(() => {
    if (!workspacePath) {
      setLive(false);
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
        const events = await services.zcodeAgentService.readSessionEvents({
          ...target,
          sessionId: sessionIdRef.current,
          ...(lastSeqRef.current >= 0 ? { afterSeq: lastSeqRef.current } : {}),
          limit: 100,
        });
        if (stopped) return;
        if (events.length > 0) {
          lastSeqRef.current = events[events.length - 1]?.seq ?? lastSeqRef.current;
          appendEntries(
            events.map((event) => {
              const summary = summarizeEvent(event);
              return {
                id: `${event.sessionId}:${event.seq}:${event.type}`,
                at: event.timestamp,
                ...summary,
              };
            }),
          );
        }
        setLive(true);
      } catch {
        // 会话不存在/未就绪/远程不可达：保持离线态，不向设置页抛错。
        if (!stopped) setLive(false);
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
      lastSeqRef.current = -1;
    };
  }, [appendEntries, services.zcodeAgentService, workspaceIdentity, workspacePath]);

  const handleClear = useCallback(() => {
    setEntries([]);
  }, []);

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
        neutralTaskProjectionEnabled={neutralTaskProjectionEnabled}
        assistantCoTPrefillEnabled={assistantCoTPrefillEnabled}
        unfilteredFullOutputEnabled={unfilteredFullOutputEnabled}
        onNeutralTaskProjectionChange={onNeutralTaskProjectionChange}
        onAssistantCoTPrefillEnabledChange={onAssistantCoTPrefillEnabledChange}
        onUnfilteredFullOutputChange={onUnfilteredFullOutputChange}
      />

      <CtfConsoleProbePanel
        neutralTaskProjectionEnabled={neutralTaskProjectionEnabled}
        onSubmit={({ target, instruction, projected }) => {
          const now = Date.now();
          appendEntries([
            {
              id: `probe-${now}-input`,
              at: now,
              level: "config",
              title: `probe input ${target}`,
              detail: instruction,
            },
            {
              id: `probe-${now}-projected`,
              at: now + 1,
              level: "config",
              title: "probe projected",
              detail: projected.split("\n")[0],
            },
          ]);
        }}
      />

      <CtfConsoleLogPanel entries={entries} live={live} onClear={handleClear} />
    </div>
  );
}
