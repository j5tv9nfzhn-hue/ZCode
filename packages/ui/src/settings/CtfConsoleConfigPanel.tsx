import { Switch } from "@/components/ui/switch.js";
import {
  TID_SETTINGS_COT_PREFILL_SWITCH,
  TID_SETTINGS_UNFILTERED_OUTPUT_SWITCH,
  TID_SETTINGS_PENTEST_ORCHESTRATION_SWITCH,
  TID_SETTINGS_INTERCEPT_ENABLED_SWITCH,
  TID_SETTINGS_INTERCEPT_JUDGE_ENABLED_SWITCH,
  TID_SETTINGS_INTERCEPT_JUDGE_FAIL_ACTION,
} from "@zcode/shared";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";

/** judge 失败策略的三个取值（对齐 ARTEX failAction）。 */
export type InterceptJudgeFailAction = "allow" | "ask" | "deny";

export function CtfConsoleConfigPanel({
  assistantCoTPrefillEnabled,
  unfilteredFullOutputEnabled,
  onAssistantCoTPrefillEnabledChange,
  onUnfilteredFullOutputChange,
  pentestOrchestrationEnabled,
  onPentestOrchestrationChange,
  interceptEnabled,
  interceptJudgeEnabled,
  interceptJudgeFailAction,
  onInterceptEnabledChange,
  onInterceptJudgeEnabledChange,
  onInterceptJudgeFailActionChange,
}: {
  assistantCoTPrefillEnabled: boolean;
  unfilteredFullOutputEnabled: boolean;
  onAssistantCoTPrefillEnabledChange: (enabled: boolean) => Promise<void>;
  onUnfilteredFullOutputChange: (enabled: boolean) => Promise<void>;
  /** 渗透编排总开关（默认关闭）。 */
  pentestOrchestrationEnabled: boolean;
  onPentestOrchestrationChange: (enabled: boolean) => Promise<void>;
  /** 工具调用拦截层（对齐 ARTEX guard + intercept，默认开启）。 */
  interceptEnabled: boolean;
  interceptJudgeEnabled: boolean;
  interceptJudgeFailAction: InterceptJudgeFailAction;
  onInterceptEnabledChange: (enabled: boolean) => Promise<void>;
  onInterceptJudgeEnabledChange: (enabled: boolean) => Promise<void>;
  onInterceptJudgeFailActionChange: (action: InterceptJudgeFailAction) => Promise<void>;
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
      <SettingsRow
        label={intl.formatMessage({ id: "settings.ctfConsole.intercept.label" })}
        description={intl.formatMessage({ id: "settings.ctfConsole.intercept.description" })}
        control={
          <Switch
            aria-label={intl.formatMessage({ id: "settings.ctfConsole.intercept.label" })}
            checked={interceptEnabled}
            data-testid={TID_SETTINGS_INTERCEPT_ENABLED_SWITCH}
            onCheckedChange={(checked) => {
              void onInterceptEnabledChange(checked);
            }}
          />
        }
      />
      <SettingsRow
        label={intl.formatMessage({ id: "settings.ctfConsole.interceptJudge.label" })}
        description={intl.formatMessage({
          id: "settings.ctfConsole.interceptJudge.description",
        })}
        control={
          <Switch
            aria-label={intl.formatMessage({ id: "settings.ctfConsole.interceptJudge.label" })}
            checked={interceptJudgeEnabled}
            disabled={!interceptEnabled}
            data-testid={TID_SETTINGS_INTERCEPT_JUDGE_ENABLED_SWITCH}
            onCheckedChange={(checked) => {
              void onInterceptJudgeEnabledChange(checked);
            }}
          />
        }
      />
      <SettingsRow
        label={intl.formatMessage({ id: "settings.ctfConsole.interceptFailAction.label" })}
        description={intl.formatMessage({
          id: "settings.ctfConsole.interceptFailAction.description",
        })}
        control={
          <Select
            value={interceptJudgeFailAction}
            disabled={!interceptEnabled || !interceptJudgeEnabled}
            onValueChange={(value) => {
              void onInterceptJudgeFailActionChange(value as InterceptJudgeFailAction);
            }}
          >
            <SelectTrigger
              size="lg"
              className="w-32 min-w-0 justify-between"
              aria-label={intl.formatMessage({
                id: "settings.ctfConsole.interceptFailAction.label",
              })}
              data-testid={TID_SETTINGS_INTERCEPT_JUDGE_FAIL_ACTION}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="allow">
                {intl.formatMessage({
                  id: "settings.ctfConsole.interceptFailAction.allow",
                })}
              </SelectItem>
              <SelectItem value="ask">
                {intl.formatMessage({ id: "settings.ctfConsole.interceptFailAction.ask" })}
              </SelectItem>
              <SelectItem value="deny">
                {intl.formatMessage({ id: "settings.ctfConsole.interceptFailAction.deny" })}
              </SelectItem>
            </SelectContent>
          </Select>
        }
      />
    </SettingsGroupCard>
  );
}
