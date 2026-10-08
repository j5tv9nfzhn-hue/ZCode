import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export type CtfConsoleLogLevel = "model" | "tool" | "session" | "config";

export interface CtfConsoleLogEntry {
  id: string;
  at: number;
  level: CtfConsoleLogLevel;
  title: string;
  detail?: string;
}

const LEVEL_TONE: Record<CtfConsoleLogLevel, string> = {
  config: "text-foreground-subtle",
  model: "text-primary",
  session: "text-foreground-muted",
  tool: "text-accent",
};

function formatTime(at: number): string {
  const date = new Date(at);
  const pad = (value: number, width = 2): string => String(value).padStart(width, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export function CtfConsoleLogPanel({
  entries,
  live,
  onClear,
}: {
  entries: readonly CtfConsoleLogEntry[];
  /** 会话事件轮询是否在线（离线时说明日志只包含控制台本地事件）。 */
  live: boolean;
  onClear: () => void;
}) {
  const { intl } = useZCodeIntl();
  const [query, setQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState<CtfConsoleLogLevel | "all">("all");
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (levelFilter !== "all" && entry.level !== levelFilter) return false;
      if (!normalizedQuery) return true;
      return `${entry.title} ${entry.detail ?? ""}`.toLowerCase().includes(normalizedQuery);
    });
  }, [entries, levelFilter, query]);

  const handleCopyAll = () => {
    const text = filtered
      .map(
        (entry) =>
          `${formatTime(entry.at)} [${entry.level}] ${entry.title}${entry.detail ? ` — ${entry.detail}` : ""}`,
      )
      .join("\n");
    void navigator.clipboard?.writeText(text);
  };

  return (
    <section className="rounded-xl border border-border bg-card px-4 py-3">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-ui-base text-foreground">
            {intl.formatMessage({ id: "settings.ctfConsole.log.title" })}
          </h3>
          <span
            className={`text-ui-caption ${live ? "text-primary" : "text-foreground-subtle"}`}
            data-testid="ctf-console-log-live"
          >
            {intl.formatMessage({
              id: live ? "settings.ctfConsole.log.live" : "settings.ctfConsole.log.offline",
            })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={intl.formatMessage({ id: "settings.ctfConsole.log.search" })}
            className="h-8 w-44 text-ui-caption"
          />
          <select
            value={levelFilter}
            onChange={(event) =>
              setLevelFilter(event.currentTarget.value as CtfConsoleLogLevel | "all")
            }
            aria-label={intl.formatMessage({ id: "settings.ctfConsole.log.filter" })}
            className="h-8 rounded-lg border border-input-border bg-input px-2 text-ui-caption"
          >
            <option value="all">
              {intl.formatMessage({ id: "settings.ctfConsole.log.allLevels" })}
            </option>
            <option value="model">model</option>
            <option value="tool">tool</option>
            <option value="session">session</option>
            <option value="config">config</option>
          </select>
          <Button size="sm" variant="outline" onClick={handleCopyAll}>
            {intl.formatMessage({ id: "settings.ctfConsole.log.copy" })}
          </Button>
          <Button size="sm" variant="outline" onClick={onClear}>
            {intl.formatMessage({ id: "settings.ctfConsole.log.clear" })}
          </Button>
        </div>
      </header>
      <div
        ref={listRef}
        className="max-h-72 min-h-40 overflow-y-auto rounded-lg border border-border bg-background px-3 py-2 font-mono"
        data-testid="ctf-console-log-list"
      >
        {filtered.length === 0 ? (
          <p className="text-ui-caption text-foreground-subtle">
            {intl.formatMessage({ id: "settings.ctfConsole.log.empty" })}
          </p>
        ) : (
          filtered.map((entry) => (
            <div key={entry.id} className="flex gap-2 py-0.5 text-ui-caption">
              <span className="shrink-0 text-foreground-subtle">{formatTime(entry.at)}</span>
              <span className={`shrink-0 ${LEVEL_TONE[entry.level]}`}>[{entry.level}]</span>
              <span className="shrink-0 text-foreground">{entry.title}</span>
              {entry.detail ? (
                <span className="truncate text-foreground-subtle">{entry.detail}</span>
              ) : null}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
