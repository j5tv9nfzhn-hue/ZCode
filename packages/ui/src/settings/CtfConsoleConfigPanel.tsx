import { Switch } from "@/components/ui/switch.js";
import {
  TID_SETTINGS_COT_PREFILL_SWITCH,
  TID_SETTINGS_UNFILTERED_OUTPUT_SWITCH,
  TID_SETTINGS_PENTEST_ORCHESTRATION_SWITCH,
} from "@zcode/shared";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";

export function CtfConsoleConfigPanel({
  assistantCoTPrefillEnabled,
  unfilteredFullOutputEnabled,
  onAssistantCoTPrefillEnabledChange,
  onUnfilteredFullOutputChange,
  pentestOrchestrationEnabled,
  onPentestOrchestrationChange,
}: {
  assistantCoTPrefillEnabled: boolean;
  unfilteredFullOutputEnabled: boolean;
  onAssistantCoTPrefillEnabledChange: (enabled: boolean) => Promise<void>;
  onUnfilteredFullOutputChange: (enabled: boolean) => Promise<void>;
  /** 渗透编排总开关（默认关闭）。 */
  pentestOrchestrationEnabled: boolean;
  onPentestOrchestrationChange: (enabled: boolean) => Promise<void>;
}) {
  const { intl } = useZCodeIntl();
  return (
    <SettingsGroupCard>
      <SettingsRow
        label={intl.formatMessage({ id: "settings.systemPrompt.cotPrefill.label" })}
        description={intl.formatMessage({ id: "settings.systemPrompt.cotPrefill.description" })}
        control={
          <Switch
            aria-label={intl.formatMessage({ id: "settings.systemPrompt.cotPrefill.label" })}
            checked={assistantCoTPrefillEnabled}
            data-testid={TID_SETTINGS_COT_PREFILL_SWITCH}
            onCheckedChange={(checked) => {
              void onAssistantCoTPrefillEnabledChange(checked);
            }}
          />
        }
      />
      <SettingsRow
        label={intl.formatMessage({ id: "settings.ctfConsole.unfilteredOutput.label" })}
        description={intl.formatMessage({ id: "settings.ctfConsole.unfilteredOutput.description" })}
        control={
          <Switch
            aria-label={intl.formatMessage({ id: "settings.ctfConsole.unfilteredOutput.label" })}
            checked={unfilteredFullOutputEnabled}
            data-testid={TID_SETTINGS_UNFILTERED_OUTPUT_SWITCH}
            onCheckedChange={(checked) => {
              void onUnfilteredFullOutputChange(checked);
            }}
          />
        }
      />
      <SettingsRow
        label={intl.formatMessage({ id: "settings.ctfConsole.pentestOrchestration.label" })}
        description={intl.formatMessage({
          id: "settings.ctfConsole.pentestOrchestration.description",
        })}
        control={
          <Switch
            aria-label={intl.formatMessage({
              id: "settings.ctfConsole.pentestOrchestration.label",
            })}
            checked={pentestOrchestrationEnabled}
            data-testid={TID_SETTINGS_PENTEST_ORCHESTRATION_SWITCH}
            onCheckedChange={(checked) => {
              void onPentestOrchestrationChange(checked);
            }}
          />
        }
      />
    </SettingsGroupCard>
  );
}
