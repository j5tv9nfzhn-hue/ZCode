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
  onSubmit,
}: {
  neutralTaskProjectionEnabled: boolean;
  onSubmit: (entry: { target: string; instruction: string; projected: string }) => void;
}) {
  const { intl } = useZCodeIntl();
  const [acknowledged, setAcknowledged] = useState(false);
  const [target, setTarget] = useState("");
  const [instruction, setInstruction] = useState(DEFAULT_TEMPLATE);
  const [preview, setPreview] = useState<string | null>(null);
  const [projectionResidual, setProjectionResidual] = useState<readonly string[]>([]);

  const resolvedInstruction = instruction.replaceAll("{TARGET}", target.trim());

  const handlePreview = () => {
    const normalized = normalizeTurnInputForNeutralTaskMode(resolvedInstruction);
    const projected = neutralTaskProjectionEnabled
      ? normalized.text
      : neutralizeTextForNeutralTaskProjection(normalized.text);
    setPreview(projected);
    setProjectionResidual(normalized.projectionResidual ?? []);
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
        <span className="text-ui-caption text-foreground-muted">
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
          {projectionResidual.length > 0 ? (
            <p
              className="rounded-lg border border-warning/60 bg-[color-mix(in_oklab,var(--color-warning)_12%,transparent)] px-2 py-1 text-ui-caption text-warning"
              data-testid="ctf-console-probe-residual"
            >
              投影自检命中残留安全语境词：{projectionResidual.join("、")}（已退回保守模板）
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
