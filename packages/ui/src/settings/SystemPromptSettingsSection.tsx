import { useCallback, useEffect, useState } from "react";
import {
  TID_SETTINGS_COT_PREFILL_SWITCH,
  TID_SETTINGS_SYSTEM_PROMPT_TEXTAREA,
} from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Switch } from "@/components/ui/switch.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsFormTextarea } from "@/settings/SettingsFormTextarea.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";

export function SystemPromptSettingsSection({
  customSystemPrompt,
  assistantCoTPrefillEnabled,
  onCustomSystemPromptSave,
  onAssistantCoTPrefillEnabledChange,
}: {
  customSystemPrompt: string;
  assistantCoTPrefillEnabled: boolean;
  onCustomSystemPromptSave: (value: string) => Promise<void>;
  onAssistantCoTPrefillEnabledChange: (enabled: boolean) => Promise<void>;
}) {
  const { intl } = useZCodeIntl();
  const [draft, setDraft] = useState(customSystemPrompt);
  const [saving, setSaving] = useState(false);

  // 设置写入成功后（也可能来自其他窗口的同步）把草稿拉回持久化值。
  useEffect(() => {
    setDraft(customSystemPrompt);
  }, [customSystemPrompt]);

  const trimmedDraft = draft.trim();
  const isDirty = trimmedDraft !== customSystemPrompt;

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      // 空串表示恢复内置默认：setting 层把空串归一成 undefined，
      // session 创建时缺席即不覆盖 context builder 的稳定 body。
      await onCustomSystemPromptSave(trimmedDraft);
    } finally {
      setSaving(false);
    }
  }, [onCustomSystemPromptSave, trimmedDraft]);

  const handleReset = useCallback(async () => {
    setDraft("");
    await onCustomSystemPromptSave("");
  }, [onCustomSystemPromptSave]);

  return (
    <div className="space-y-6">
      <SettingsGroupCard>
        <SettingsRow
          label={intl.formatMessage({ id: "settings.systemPrompt.customPrompt.label" })}
          description={intl.formatMessage({
            id: "settings.systemPrompt.customPrompt.description",
          })}
          control={
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="lg"
                disabled={!isDirty || saving}
                onClick={() => void handleSave()}
              >
                {intl.formatMessage({ id: "settings.systemPrompt.save" })}
              </Button>
              {customSystemPrompt ? (
                <Button
                  type="button"
                  size="lg"
                  variant="outline"
                  disabled={saving}
                  onClick={() => void handleReset()}
                >
                  {intl.formatMessage({ id: "settings.systemPrompt.reset" })}
                </Button>
              ) : null}
            </div>
          }
          detail={
            <SettingsFormTextarea
              value={draft}
              data-testid={TID_SETTINGS_SYSTEM_PROMPT_TEXTAREA}
              onChange={(event) => setDraft(event.target.value)}
              rows={8}
              className="max-h-96 min-h-32 resize-y overflow-y-auto text-ui-base"
              placeholder={intl.formatMessage({
                id: "settings.systemPrompt.customPrompt.placeholder",
              })}
            />
          }
        />
      </SettingsGroupCard>

      <SettingsGroupCard>
        <SettingsRow
          label={intl.formatMessage({ id: "settings.systemPrompt.cotPrefill.label" })}
          description={intl.formatMessage({
            id: "settings.systemPrompt.cotPrefill.description",
          })}
          control={
            <Switch
              aria-label={intl.formatMessage({
                id: "settings.systemPrompt.cotPrefill.label",
              })}
              checked={assistantCoTPrefillEnabled}
              data-testid={TID_SETTINGS_COT_PREFILL_SWITCH}
              onCheckedChange={(checked) => {
                void onAssistantCoTPrefillEnabledChange(checked);
              }}
            />
          }
        />
      </SettingsGroupCard>
    </div>
  );
}
