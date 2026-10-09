import { useState } from "react";
import {
  normalizeTurnInputForNeutralTaskMode,
  neutralizeTextForNeutralTaskProjection,
} from "@zcode/shared";
import { TID_SETTINGS_CTF_PROBE_SUBMIT } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import { Input } from "@/components/ui/input.js";
import { Textarea } from "@/components/ui/textarea.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

const DEFAULT_TEMPLATE = "帮我渗透 {TARGET}，先摸清它对外暴露了什么。";

export function CtfConsoleProbePanel({
  neutralTaskProjectionEnabled,
  targetAllowlist,
  onSubmit,
}: {
  neutralTaskProjectionEnabled: boolean;
  /** 登记表：与运行时同一份（命中时预览会展示作用域事实行）。 */
  targetAllowlist: readonly string[];
  onSubmit: (entry: { target: string; instruction: string; projected: string }) => void;
}) {
  const { intl } = useZCodeIntl();
  const [acknowledged, setAcknowledged] = useState(false);
  const [target, setTarget] = useState("");
  const [instruction, setInstruction] = useState(DEFAULT_TEMPLATE);
  const [preview, setPreview] = useState<string | null>(null);
  // 投影遥测：作用域是否命中 + 请求里保留了哪些攻击语义词（能力保持模式不删词）。
  const [projectionInfo, setProjectionInfo] = useState<{
    scopeMatched: boolean;
    lexicalTriggers: readonly string[];
  }>({ scopeMatched: false, lexicalTriggers: [] });

  const resolvedInstruction = instruction.replaceAll("{TARGET}", target.trim());

  const handlePreview = () => {
    // 与运行时同一入参形态：登记表走同一份判据，预览才能预演作用域事实注入。
    const normalized = normalizeTurnInputForNeutralTaskMode(resolvedInstruction, {
      targetAllowlist,
    });
    const projected = neutralTaskProjectionEnabled
      ? normalized.text
      : neutralizeTextForNeutralTaskProjection(normalized.text);
    setPreview(projected);
    setProjectionInfo({
      scopeMatched: normalized.scopeMatched === true,
      lexicalTriggers: normalized.lexicalTriggers ?? [],
    });
    onSubmit({
      target: target.trim(),
      instruction: resolvedInstruction,
      projected,
    });
  };

  return (
    <section className="rounded-xl border border-border bg-card px-4 py-3">
      <h3 className="mb-2 text-ui-base text-foreground">
        {intl.formatMessage({ id: "settings.ctfConsole.probe.title" })}
      </h3>
      <label className="flex items-start gap-2 rounded-lg border border-border bg-background px-3 py-2">
        <Checkbox
          checked={acknowledged}
          data-testid="ctf-console-probe-ack"
          onCheckedChange={(checked) => setAcknowledged(checked === true)}
        />
        <span className="text-ui-caption text-foreground-subtle">
          {intl.formatMessage({ id: "settings.ctfConsole.probe.disclaimer" })}
        </span>
      </label>

      <div className="mt-3 grid gap-3">
        <div className="space-y-1.5">
          <span className="text-ui-caption text-foreground-subtle">
            {intl.formatMessage({ id: "settings.ctfConsole.probe.targetLabel" })}
          </span>
          <Input
            value={target}
            disabled={!acknowledged}
            onChange={(event) => setTarget(event.currentTarget.value)}
            placeholder={intl.formatMessage({ id: "settings.ctfConsole.probe.targetPlaceholder" })}
            className="text-ui-base"
          />
        </div>
        <div className="space-y-1.5">
          <span className="text-ui-caption text-foreground-subtle">
            {intl.formatMessage({ id: "settings.ctfConsole.probe.instructionLabel" })}
          </span>
          <Textarea
            value={instruction}
            disabled={!acknowledged}
            onChange={(event) => setInstruction(event.currentTarget.value)}
            rows={3}
            className="text-ui-base"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="lg"
            disabled={!acknowledged || target.trim().length === 0}
            data-testid={TID_SETTINGS_CTF_PROBE_SUBMIT}
            onClick={handlePreview}
          >
            {intl.formatMessage({ id: "settings.ctfConsole.probe.preview" })}
          </Button>
          {preview ? (
            <Button
              size="lg"
              variant="outline"
              onClick={() => {
                void navigator.clipboard?.writeText(resolvedInstruction);
              }}
            >
              {intl.formatMessage({ id: "settings.ctfConsole.probe.copyOriginal" })}
            </Button>
          ) : null}
        </div>
      </div>

      {preview ? (
        <div className="mt-3 space-y-1.5">
          <span className="text-ui-caption text-foreground-subtle">
            {intl.formatMessage({ id: "settings.ctfConsole.probe.previewLabel" })}
          </span>
          <pre
            className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-background px-3 py-2 font-mono text-ui-caption"
            data-testid="ctf-console-probe-preview"
          >
            {preview}
          </pre>
          {projectionInfo.scopeMatched ? (
            <p
              className="text-ui-caption text-foreground-subtle"
              data-testid="ctf-console-probe-scope"
            >
              {intl.formatMessage({ id: "settings.ctfConsole.probe.scopeMatched" })}
            </p>
          ) : null}
          {projectionInfo.lexicalTriggers.length > 0 ? (
            <p
              className="rounded-lg border border-warning/40 bg-warning/10 px-2 py-1 text-ui-caption text-warning"
              data-testid="ctf-console-probe-triggers"
            >
              {intl.formatMessage(
                { id: "settings.ctfConsole.probe.lexicalTriggers" },
                { terms: projectionInfo.lexicalTriggers.join("、") },
              )}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
