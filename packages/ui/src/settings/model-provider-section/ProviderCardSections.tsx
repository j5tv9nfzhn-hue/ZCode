/* eslint-disable max-lines -- 模型供应商卡片仍在迁移期集中维护多个紧耦合区块，后续拆分时再移除。 */
import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  type ReactNode,
} from "react";
import type {
  ProviderSettingsFormProvider,
  ProviderSettingsFormModel,
} from "@/lib/providerSettingsFormTypes.js";
import type { ModelConnectivityResult } from "@zcode/shared";
import type { ProviderApiType } from "@zcode/provider";
import { createVirtualizerElementRef } from "@/lib/virtualizerElementRef.js";
import {
  TID_MODEL_PROVIDER_ADD_MODEL_BUTTON,
  TID_MODEL_PROVIDER_BASE_URL_INPUT,
  TID_MODEL_PROVIDER_FETCH_MODELS_BUTTON,
  TID_MODEL_PROVIDER_MODEL_DELETE_BUTTON,
  TID_MODEL_PROVIDER_MODEL_INPUT,
  TID_MODEL_PROVIDER_NAME_EDIT_BUTTON,
  TID_MODEL_PROVIDER_NAME_INPUT,
  testId,
} from "@zcode/shared";
import {
  InfoIcon,
  LockKeyholeIcon,
  Plus,
  Pencil,
  Trash2,
  MoreHorizontal,
  Download,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useServices } from "@/hooks/useServices.js";
import { TECHNICAL_INPUT_ATTRIBUTES } from "@/lib/technicalInputAttributes.js";
import { ApiKeyInput } from "./ApiKeyInput.js";
import { ModelRowInput } from "./ProviderFormControls.js";
import { PresetProviderApiKeyBanner } from "./PresetProviderApiKeyBanner.js";
import { type ProviderModelDraftValues } from "@/settings/model-provider-section/ProviderModelMetadata.js";
import { ProviderModelMetadataDialog } from "@/settings/model-provider-section/ProviderModelMetadataDialog.js";
import {
  ProviderApiFormatSelect,
  resolveProviderConnectionApiFormatDisplayLabel,
} from "@/settings/model-provider-section/ProviderApiFormatSelect.js";
import { SortableProviderModelList } from "@/settings/model-provider-section/SortableProviderModelList.js";
import { useProviderModelDraft } from "@/settings/model-provider-section/useProviderModelDraft.js";
import { ProviderLogo } from "@/settings/model-provider-section/ProviderLogo.js";
import type { ProviderConfigObject } from "@zcode/provider";

export { formatModelContextWindowLabel } from "@/lib/tokenNumberFormat.js";
export {
  resolveProviderConnectionApiFormatDisplayLabel,
  resolveProviderConnectionApiFormatOptions,
} from "@/settings/model-provider-section/ProviderApiFormatSelect.js";

function shouldShowProviderApiFormat(
  _provider: Pick<ProviderSettingsFormProvider, "providerId">,
): boolean {
  return true;
}

export function ProviderCardHeader({
  providerName,
  logo,
  editingName,
  nameValue,
  nameInputRef,
  nameEditable = true,
  onNameChange,
  onNameBlur,
  onNameKeyDown,
  onNameCompositionEnd,
  onNameCompositionStart,
  onStartEditName,
  onDelete,
  actionsVisible = true,
  providerToggle,
}: {
  providerName: string;
  logo?: ProviderConfigObject["logo"];
  editingName: boolean;
  nameValue: string;
  nameInputRef: RefObject<HTMLInputElement | null>;
  nameEditable?: boolean;
  onNameChange: (value: string) => void;
  onNameBlur: () => void;
  onNameKeyDown: (event: ReactKeyboardEvent) => void;
  onNameCompositionEnd?: () => void;
  onNameCompositionStart?: () => void;
  onStartEditName: () => void;
  onDelete?: () => void;
  actionsVisible?: boolean;
  providerToggle?: ReactNode;
}) {
  const { intl } = useZCodeIntl();
  const renameRequestedRef = useRef(false);
  const secondaryActionsVisible = actionsVisible && (nameEditable || Boolean(onDelete));

  return (
    <div className="flex items-center justify-between gap-3" data-testid="model-provider-header">
      <div className="flex min-w-0 items-center gap-2">
        <ProviderLogo logo={logo} className="size-5" />
        {editingName ? (
          <Input
            {...TECHNICAL_INPUT_ATTRIBUTES}
            ref={nameInputRef}
            data-testid={TID_MODEL_PROVIDER_NAME_INPUT}
            type="text"
            size="lg"
            className="w-auto min-w-0 text-ui-lg font-semibold"
            value={nameValue}
            onChange={(event) => onNameChange(event.target.value)}
            onCompositionEnd={onNameCompositionEnd}
            onCompositionStart={onNameCompositionStart}
            onBlur={onNameBlur}
            onKeyDown={onNameKeyDown}
          />
        ) : (
          <>
            <div className="min-w-0 truncate text-ui-lg font-semibold text-foreground">
              {providerName}
            </div>
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {providerToggle}
        {secondaryActionsVisible ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                data-testid="model-provider-actions-button"
                aria-label={intl.formatMessage({ id: "common.more" })}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onCloseAutoFocus={(event) => {
                // 重命名后的焦点交给输入框，不能被菜单关闭时重新抢回触发按钮。
                if (renameRequestedRef.current) {
                  event.preventDefault();
                  renameRequestedRef.current = false;
                }
              }}
            >
              {nameEditable ? (
                <DropdownMenuItem
                  data-testid={TID_MODEL_PROVIDER_NAME_EDIT_BUTTON}
                  onSelect={() => {
                    renameRequestedRef.current = true;
                    onStartEditName();
                  }}
                >
                  <Pencil className="size-3.5" />
                  {intl.formatMessage({ id: "settings.modelProvider.renameProvider" })}
                </DropdownMenuItem>
              ) : null}
              {nameEditable && onDelete ? <DropdownMenuSeparator /> : null}
              {onDelete ? (
                <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                  <Trash2 className="size-3.5" />
                  {intl.formatMessage({ id: "common.delete" })}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  );
}

export function ProviderConnectionSection({
  provider,
  readOnly,
  apiFormat,
  baseUrlValue,
  onApiFormatChange,
  onBaseUrlChange,
  onBaseUrlBlur,
  onBaseUrlKeyDown,
  onBaseUrlCompositionStart,
  onBaseUrlCompositionEnd,
}: {
  provider: ProviderSettingsFormProvider;
  readOnly?: boolean;
  apiFormat: ProviderApiType;
  baseUrlValue: string;
  onApiFormatChange: (value: ProviderApiType) => void;
  onBaseUrlChange: (value: string) => void;
  onBaseUrlBlur: () => void;
  onBaseUrlKeyDown?: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onBaseUrlCompositionStart?: () => void;
  onBaseUrlCompositionEnd?: () => void;
}) {
  const { intl } = useZCodeIntl();
  const showApiFormat = shouldShowProviderApiFormat(provider);
  const readOnlyBaseUrl = provider.config.api?.baseUrl ?? "";
  const resolvedApiFormat = provider.config.api?.type ?? "anthropic-messages";

  const renderReadOnlyField = (label: string, value: string) => (
    <div>
      <label className="mb-1 block text-ui-base text-foreground-subtle">{label}</label>
      <div className="flex min-h-8 items-center gap-2 rounded-lg border border-input-border bg-input px-3 py-1.5 text-ui-base text-foreground">
        <span className="min-w-0 flex-1 break-all">{value || "-"}</span>
        <span
          role="img"
          aria-label={intl.formatMessage(
            { id: "settings.modelProvider.readOnlyField" },
            { field: label },
          )}
          className="shrink-0 text-foreground-subtle"
        >
          <LockKeyholeIcon className="size-3.5" aria-hidden="true" />
        </span>
      </div>
    </div>
  );

  if (readOnly) {
    return (
      <>
        {renderReadOnlyField(
          intl.formatMessage({ id: "settings.modelProvider.baseUrl" }),
          readOnlyBaseUrl,
        )}
        {showApiFormat
          ? renderReadOnlyField(
              intl.formatMessage({ id: "settings.modelProvider.apiFormat" }),
              resolveProviderConnectionApiFormatDisplayLabel(intl, resolvedApiFormat),
            )
          : null}
      </>
    );
  }

  return (
    <>
      <div>
        <label className="mb-1 block text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "settings.modelProvider.baseUrl" })}
        </label>
        <Input
          {...TECHNICAL_INPUT_ATTRIBUTES}
          type="text"
          size="lg"
          data-testid={TID_MODEL_PROVIDER_BASE_URL_INPUT}
          value={baseUrlValue}
          placeholder={intl.formatMessage({
            id: "settings.modelProvider.baseUrlPlaceholder",
          })}
          onChange={(event) => onBaseUrlChange(event.target.value)}
          onBlur={onBaseUrlBlur}
          onKeyDown={onBaseUrlKeyDown}
          onCompositionStart={onBaseUrlCompositionStart}
          onCompositionEnd={onBaseUrlCompositionEnd}
        />
      </div>
      {showApiFormat ? (
        <div>
          <label className="mb-1 block text-ui-base text-foreground-subtle">
            {intl.formatMessage({ id: "settings.modelProvider.apiFormat" })}
          </label>
          <ProviderApiFormatSelect value={apiFormat} onChange={onApiFormatChange} />
        </div>
      ) : null}
    </>
  );
}

export function ProviderApiKeySection({
  apiKeyValue,
  apiKeyVisible,
  readOnly,
  presetApiKeyUrl,
  onOpenPresetApiKey,
  onApiKeyChange,
  onApiKeyBlur,
  onApiKeyKeyDown,
  onApiKeyCompositionStart,
  onApiKeyCompositionEnd,
  onToggleApiKeyVisibility,
}: {
  apiKeyValue: string;
  apiKeyVisible: boolean;
  readOnly?: boolean;
  presetApiKeyUrl?: string;
  onOpenPresetApiKey?: () => void;
  onApiKeyChange: (value: string) => void;
  onApiKeyBlur: () => void;
  onApiKeyKeyDown?: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onApiKeyCompositionStart?: () => void;
  onApiKeyCompositionEnd?: () => void;
  onToggleApiKeyVisibility: () => void;
}) {
  const { intl } = useZCodeIntl();

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label className="block text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "settings.modelProvider.apiKey" })}
        </label>
        {presetApiKeyUrl && onOpenPresetApiKey ? (
          <PresetProviderApiKeyBanner onOpenApiKey={onOpenPresetApiKey} />
        ) : null}
      </div>
      <ApiKeyInput
        value={apiKeyValue}
        visible={apiKeyVisible}
        readOnly={readOnly}
        onChange={onApiKeyChange}
        onBlur={onApiKeyBlur}
        onKeyDown={onApiKeyKeyDown}
        onCompositionStart={onApiKeyCompositionStart}
        onCompositionEnd={onApiKeyCompositionEnd}
        onToggleVisibility={onToggleApiKeyVisibility}
      />
    </div>
  );
}

function createEmptyModel(): ProviderSettingsFormModel {
  return {
    kind: "candidate",
    modelId: "",
    builtin: false,
    personalConfig: {},
    // 空 ID 尚未解析模型配置，硬编码档位会被误认为智能推荐。
    config: {
      properties: { supportsToolCall: true },
    },
    hasPersonalConfig: false,
    executable: false,
    selectable: false,
  };
}

/**
 * 发现结果里的一行。
 *
 * 单独抽成 memo 组件的原因：`discoveredModelIds` 在 OpenRouter 这类 provider 上
 * 可能有数百条，而勾选任意一行都会更新 `selectedDiscoveredIds`。若把行内联在
 * `map()` 里，每次勾选都会让**全部行**重渲染（连同每行的 Radix Checkbox 与
 * `intl.formatMessage` 调用），在几百行时表现为明显的点击延迟。
 *
 * memo 之后只有 `checked` 真正变化的那一行会重渲染。为此：
 * - `onToggle` 由父级 useCallback 稳定（依赖为空，通过 modelId 参数区分行）；
 * - `alreadyConfiguredLabel` 由父级算一次传入，避免每行各自 formatMessage。
 */
const DiscoveredModelRow = memo(function DiscoveredModelRow({
  modelId,
  checked,
  alreadyConfigured,
  alreadyConfiguredLabel,
  onToggle,
}: {
  modelId: string;
  checked: boolean;
  alreadyConfigured: boolean;
  alreadyConfiguredLabel: string;
  onToggle: (modelId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(modelId)}
      className="flex h-full w-full items-center gap-2 px-3 py-2 text-left text-ui-base hover:bg-hover"
    >
      {/* 勾选框只作视觉指示：整行是唯一的点击目标，避免 label 转发造成双次切换。 */}
      <Checkbox checked={checked} tabIndex={-1} className="pointer-events-none" />
      <span className="min-w-0 flex-1 truncate font-mono">{modelId}</span>
      {alreadyConfigured ? (
        <span className="shrink-0 text-ui-xs text-foreground-subtlest">
          {alreadyConfiguredLabel}
        </span>
      ) : null}
    </button>
  );
});

/** 发现结果行高（px）。虚拟化需要固定行高：`py-2` × 2 + 单行文字 ≈ 36。 */
const DISCOVERED_MODEL_ROW_HEIGHT_PX = 36;

export function ProviderModelsSection({
  providerId,
  providerName,
  providerEnabled = true,
  providerAccess,
  models,
  onTestModel,
  onModelCommit,
  onModelEnabledChange,
  onDeleteModel,
  onAddModel,
  onReorderModelIds,
  settingsRevision = 0,
}: {
  providerId: string;
  providerName?: string;
  providerEnabled?: boolean;
  providerAccess?: ProviderConfigObject["access"];
  models: ProviderSettingsFormModel[];
  onTestModel?: (model: string) => Promise<ModelConnectivityResult>;
  onModelCommit: (
    originalModelId: string,
    model: ProviderSettingsFormModel,
    basedOnRevision: number,
  ) => void | Promise<void>;
  onDeleteModel: (modelId: string) => void;
  onModelEnabledChange?: (modelId: string, enabled: boolean) => void | Promise<void>;
  onAddModel: (model: ProviderSettingsFormModel) => void | Promise<void>;
  onReorderModelIds?: (modelIds: string[]) => void;
  settingsRevision?: number;
}) {
  const { intl } = useZCodeIntl();
  const { providerSettingsService } = useServices();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const addSavingRef = useRef(false);
  const [addCommitError, setAddCommitError] = useState<string | null>(null);
  const [addModel] = useState(createEmptyModel);
  const [addDraftErrorField, setAddDraftErrorField] = useState<
    | "id"
    | "contextWindow"
    | "maxOutputTokens"
    | "inputFormat"
    | "reasoningLevelValues"
    | "reasoningLevelMap"
    | null
  >(null);
  const resolveAddModelConfig = useCallback(
    (modelId: string) => providerSettingsService.resolveModelConfig({ providerId, modelId }),
    [providerId, providerSettingsService],
  );
  const editor = useProviderModelDraft({
    model: addModel,
    open: addDialogOpen,
    scopeKey: providerId,
    resolve: resolveAddModelConfig,
  });
  const { draft: addDraft } = editor;

  const openAddDialog = useCallback(() => {
    editor.reset(createEmptyModel());
    setAddDraftErrorField(null);
    setAddCommitError(null);
    setAddDialogOpen(true);
  }, [editor.reset]);

  const updateAddDraft = (patch: Partial<ProviderModelDraftValues>) => {
    editor.change(patch);
    setAddDraftErrorField(null);
  };

  const cancelAddDialog = () => {
    setAddDialogOpen(false);
    editor.reset(createEmptyModel());
    setAddDraftErrorField(null);
    editor.cancel();
  };

  const handleAddDialogOpenChange = useCallback(
    (open: boolean) => {
      // 保存中的关闭/再打开会让旧请求结束掉新草稿，等待本次提交完成再结束编辑。
      if (addSavingRef.current) return;
      if (!open) {
        cancelAddDialog();
        return;
      }
      setAddDialogOpen(true);
    },
    [cancelAddDialog],
  );

  const commitAddDraft = useCallback(async (): Promise<boolean> => {
    if (addSavingRef.current) return false;
    addSavingRef.current = true;
    setAddSaving(true);
    setAddCommitError(null);
    try {
      const result = await editor.commit();
      if (result.status === "invalid") {
        setAddDraftErrorField(result.field);
        return false;
      }
      // 过去只发起异步添加就关闭弹窗，失败后输入也丢了；以实际保存完成作为结束边界。
      await onAddModel(result.model);
      setAddDialogOpen(false);
      editor.reset(createEmptyModel());
      return true;
    } catch (error) {
      setAddCommitError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      addSavingRef.current = false;
      setAddSaving(false);
    }
  }, [editor, onAddModel]);
  const addDraftErrorMessage = addDraftErrorField
    ? intl.formatMessage({
        id: `settings.modelProvider.modelMetadata.invalid.${addDraftErrorField}`,
      })
    : null;

  // ── 从 provider 端点发现模型（GET {baseUrl}/models）──
  // 发现动作走 providerSettingsService（Host 进程执行），Renderer 不直连网络，也不接触 API Key。
  // 不自动落库：拉到结果只进本地组件状态并弹出勾选框，只有用户在对话框里确认的条目
  // 才会经 onAddModel 写入 provider 配置。刷新/关闭对话框即丢弃。
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [discoveredModelIds, setDiscoveredModelIds] = useState<readonly string[]>([]);
  const [selectedDiscoveredIds, setSelectedDiscoveredIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [importingModels, setImportingModels] = useState(false);

  const existingModelIds = useMemo(() => new Set(models.map((model) => model.modelId)), [models]);

  // 文案在父级算一次：行组件被 memo，若每行各自调 formatMessage，
  // 数百行就是数百次 Intl 查找，且会让 memo 的 props 每次都是新字符串而失效。
  const alreadyConfiguredLabel = intl.formatMessage({
    id: "settings.modelProvider.fetchModels.alreadyConfigured",
  });

  // 发现结果列表虚拟化。
  //
  // 为什么必须虚拟化而不只是 memo：memo 解决的是「勾选时不要全量重渲染」，但对话框
  // 首次打开仍要挂载全部行。OpenRouter 这类 provider 一次能返回数百个模型，每个行都含
  // 一个 Radix Checkbox（自带 context 与 effect），全量挂载会造成对话框打开时的明显卡顿。
  // 虚拟化后只渲染可见的十余行，几百条与十几条的打开开销一致。
  const discoveredListRef = useRef<HTMLDivElement | null>(null);
  const discoveredVirtualizer = useVirtualizer({
    count: discoveredModelIds.length,
    getScrollElement: () => discoveredListRef.current,
    estimateSize: () => DISCOVERED_MODEL_ROW_HEIGHT_PX,
    overscan: 8,
  });

  // ── 2026-10-09 修复：拉取模型列表后面板空白 ──
  //
  // 症状：点「从端点获取模型」→ 对话框弹出、行数与计数显示正常，但列表整片空白；
  //       手动点一下「全选 / 全不选 / 取消」又立刻恢复正常。
  //
  // 根因是三层时序叠加，不是渲染逻辑写错：
  //   1. `DialogContent` 经 Radix Portal 挂载，而 Portal 是
  //      `useLayoutEffect(() => setMounted(true))` 的**延迟一帧**挂载
  //      （@radix-ui/react-portal dist/index.mjs:12-13）。打开对话框那次渲染里，
  //      滚动容器还不在 DOM 上。
  //   2. `useVirtualizer` 只在**宿主组件（ProviderModelsSection）渲染**时才读
  //      `getScrollElement()`（@tanstack/react-virtual dist/esm/index.js:27-32 的
  //      `_willUpdate` 无依赖数组，但门槛是「宿主渲染」）。而 Portal 挂载只触发
  //      Portal 子树重渲染，宿主的 `_willUpdate` 不再执行。
  //   3. 于是 `Virtualizer.scrollElement` 始终为 null、订阅没建立，
  //      `getVirtualItems()` 恒返回空数组 → 列表空白。
  //
  // 为什么点全选/取消能恢复：那三个按钮都调 `setSelectedDiscoveredIds` /
  // `setDiscoverOpen`，把宿主渲染了一次，`_willUpdate` 这才补上订阅。
  // 也就是说「恢复」只是碰巧触发了本缺失的那次渲染，按钮本身没有魔力。
  //
  // 修法与「为什么必须是回调 ref」见 @/lib/virtualizerElementRef 的文件头注释。
  const attachDiscoveredListRef = useMemo(
    () => createVirtualizerElementRef(discoveredListRef, discoveredVirtualizer),
    [discoveredVirtualizer],
  );

  const handleDiscoverModels = useCallback(async () => {
    if (discovering) return;
    setDiscovering(true);
    setDiscoverError(null);
    try {
      const result = await providerSettingsService.discoverProviderModels({ providerId });
      if (result.status === "ok") {
        setDiscoveredModelIds(result.modelIds);
        // 默认只勾选本地还没有的：点这个按钮的意图就是补齐缺失项，
        // 已经配好的模型再走一次添加会覆盖掉用户手改过的元数据。
        setSelectedDiscoveredIds(
          new Set(result.modelIds.filter((id) => !existingModelIds.has(id))),
        );
      } else {
        setDiscoveredModelIds([]);
        setSelectedDiscoveredIds(new Set());
        setDiscoverError(result.status === "unsupported" ? result.reason : result.message);
      }
      setDiscoverOpen(true);
    } catch (error) {
      setDiscoveredModelIds([]);
      setSelectedDiscoveredIds(new Set());
      setDiscoverError(error instanceof Error ? error.message : String(error));
      setDiscoverOpen(true);
    } finally {
      setDiscovering(false);
    }
  }, [discovering, existingModelIds, providerId, providerSettingsService]);

  const toggleDiscoveredId = useCallback((modelId: string) => {
    setSelectedDiscoveredIds((current) => {
      const next = new Set(current);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  }, []);

  // 全选：选中全部发现结果（含本地已配置的——用户可能就是想重置它们的元数据）。
  // 与拉取时的默认行为区分开：默认只勾未配置的，全选是用户的显式动作。
  const selectAllDiscovered = useCallback(() => {
    setSelectedDiscoveredIds(new Set(discoveredModelIds));
  }, [discoveredModelIds]);

  const clearDiscoveredSelection = useCallback(() => {
    setSelectedDiscoveredIds(new Set());
  }, []);

  const allDiscoveredSelected =
    discoveredModelIds.length > 0 && selectedDiscoveredIds.size === discoveredModelIds.length;

  const handleImportDiscoveredModels = useCallback(async () => {
    if (importingModels) return;
    setImportingModels(true);
    try {
      // 逐个添加而不是批量：addPersonalModel 每次返回权威 View 并提交，
      // 中途失败时已完成的部分已经落库，用户能看到实际结果而不是整体回滚的假象。
      for (const modelId of discoveredModelIds) {
        if (!selectedDiscoveredIds.has(modelId)) continue;
        await onAddModel({ ...createEmptyModel(), modelId });
      }
      setDiscoverOpen(false);
      setDiscoveredModelIds([]);
      setSelectedDiscoveredIds(new Set());
    } finally {
      setImportingModels(false);
    }
  }, [discoveredModelIds, importingModels, onAddModel, selectedDiscoveredIds]);

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <span className="text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "settings.modelProvider.models" })}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="default"
            className="rounded-lg"
            data-testid={TID_MODEL_PROVIDER_FETCH_MODELS_BUTTON}
            disabled={discovering}
            onClick={() => void handleDiscoverModels()}
          >
            <Download data-icon="inline-start" aria-hidden="true" />
            {discovering
              ? intl.formatMessage({ id: "settings.modelProvider.fetchModels.loading" })
              : intl.formatMessage({ id: "settings.modelProvider.fetchModels" })}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="default"
            className="rounded-lg"
            data-testid={TID_MODEL_PROVIDER_ADD_MODEL_BUTTON}
            onClick={openAddDialog}
          >
            <Plus data-icon="inline-start" aria-hidden="true" />
            {intl.formatMessage({ id: "settings.modelProvider.addModel" })}
          </Button>
        </div>
      </div>
      <Dialog
        open={discoverOpen}
        onOpenChange={(open) => {
          if (!open) setDiscoverOpen(false);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {intl.formatMessage({ id: "settings.modelProvider.fetchModels.title" })}
            </DialogTitle>
          </DialogHeader>
          {discoverError ? (
            <p className="text-ui-base text-warning">{discoverError}</p>
          ) : discoveredModelIds.length === 0 ? (
            <p className="text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: "settings.modelProvider.fetchModels.empty" })}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-ui-sm text-foreground-subtle">
                  {intl.formatMessage(
                    { id: "settings.modelProvider.fetchModels.count" },
                    { count: discoveredModelIds.length },
                  )}
                </p>
                {/* 全选 / 全不选：几百条结果时逐个点不现实。
                    全选包含本地已配置项（用户可能想统一重置元数据），与拉取时的
                    「默认只勾未配置项」是两个不同意图，所以分开呈现而不是合并成一个开关。 */}
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="default"
                    className="h-7 rounded-md px-2 text-ui-sm"
                    disabled={allDiscoveredSelected}
                    onClick={selectAllDiscovered}
                  >
                    {intl.formatMessage({ id: "settings.modelProvider.fetchModels.selectAll" })}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="default"
                    className="h-7 rounded-md px-2 text-ui-sm"
                    disabled={selectedDiscoveredIds.size === 0}
                    onClick={clearDiscoveredSelection}
                  >
                    {intl.formatMessage({ id: "settings.modelProvider.fetchModels.selectNone" })}
                  </Button>
                </div>
              </div>
              <div
                ref={attachDiscoveredListRef}
                className="max-h-72 overflow-y-auto rounded-lg border border-input-border bg-input"
              >
                <div
                  style={{
                    height: `${discoveredVirtualizer.getTotalSize()}px`,
                    width: "100%",
                    position: "relative",
                  }}
                >
                  {discoveredVirtualizer.getVirtualItems().map((virtualItem) => {
                    const modelId = discoveredModelIds[virtualItem.index];
                    if (modelId === undefined) return null;
                    return (
                      <div
                        key={virtualItem.key}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          height: `${virtualItem.size}px`,
                          transform: `translateY(${virtualItem.start}px)`,
                        }}
                      >
                        <DiscoveredModelRow
                          modelId={modelId}
                          checked={selectedDiscoveredIds.has(modelId)}
                          alreadyConfigured={existingModelIds.has(modelId)}
                          alreadyConfiguredLabel={alreadyConfiguredLabel}
                          onToggle={toggleDiscoveredId}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="default"
              className="rounded-lg"
              onClick={() => setDiscoverOpen(false)}
            >
              {intl.formatMessage({ id: "common.cancel" })}
            </Button>
            <Button
              type="button"
              variant="default"
              size="default"
              className="rounded-lg"
              disabled={
                importingModels || discoverError !== null || selectedDiscoveredIds.size === 0
              }
              onClick={() => void handleImportDiscoveredModels()}
            >
              {intl.formatMessage(
                { id: "settings.modelProvider.fetchModels.import" },
                { count: selectedDiscoveredIds.size },
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {models.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-input-border bg-input">
          <SortableProviderModelList
            modelIds={models.map((model) => model.modelId)}
            sortableModelIds={models.map((model) => model.modelId)}
            onReorder={onReorderModelIds}
            renderModel={(_modelId, index) => {
              const model = models[index]!;
              const inputFormat = model.config.properties?.inputFormat;
              const outputFormat = model.config.properties?.outputFormat;
              const completeProperties =
                model.config.properties?.contextWindow != null &&
                inputFormat?.supportsText != null &&
                inputFormat.supportsImage != null &&
                inputFormat.supportsVideo != null &&
                inputFormat.supportsAudio != null &&
                inputFormat.supportsPdf != null &&
                outputFormat?.supportsText != null;
              return (
                <>
                  <ModelRowInput
                    key={`${providerId}/${model.modelId}`}
                    providerId={providerId}
                    providerName={providerName}
                    providerEnabled={providerEnabled}
                    providerAccess={providerAccess}
                    inputTestId={testId(TID_MODEL_PROVIDER_MODEL_INPUT, String(index))}
                    deleteTestId={testId(TID_MODEL_PROVIDER_MODEL_DELETE_BUTTON, String(index))}
                    model={model}
                    onCommit={(value, basedOnRevision) =>
                      onModelCommit(model.modelId, value, basedOnRevision)
                    }
                    onResolveDraft={(nextModelId, personalConfig) =>
                      providerSettingsService.resolveModelConfig({
                        providerId,
                        originalModelId: model.modelId,
                        modelId: nextModelId,
                        personalConfig: structuredClone(personalConfig),
                      })
                    }
                    settingsRevision={settingsRevision}
                    onDelete={!model.builtin ? () => onDeleteModel(model.modelId) : undefined}
                    onEnabledChange={(enabled) => {
                      void Promise.resolve(onModelEnabledChange?.(model.modelId, enabled)).catch(
                        () => undefined,
                      );
                    }}
                    onTest={onTestModel}
                  />
                  {!completeProperties && (
                    <div className="px-3 pb-2 text-ui-sm text-destructive">
                      {model.issues?.[0]?.message ??
                        intl.formatMessage({ id: "settings.modelProvider.modelConfigIncomplete" })}
                    </div>
                  )}
                </>
              );
            }}
          />
        </div>
      ) : (
        <div className="mt-1 flex h-12 items-center justify-start gap-2 rounded-lg border border-dashed border-border px-4 text-left text-ui-base text-foreground-subtle">
          <InfoIcon className="size-4 shrink-0" aria-hidden="true" />
          {intl.formatMessage({ id: "settings.modelProvider.modelsEmpty" })}
        </div>
      )}
      <>
        <ProviderModelMetadataDialog
          onRestore={() => {
            setAddDraftErrorField(null);
            setAddCommitError(null);
            void editor
              .restore()
              .catch((error) =>
                setAddCommitError(error instanceof Error ? error.message : String(error)),
              );
          }}
          mode="add"
          open={addDialogOpen}
          draft={addDraft}
          draftErrorMessage={addCommitError ?? addDraftErrorMessage}
          draftErrorField={addDraftErrorField}
          inheritedConfig={editor.inheritedConfig}
          overrideFields={editor.overrides}
          onOpenChange={handleAddDialogOpenChange}
          onDraftChange={updateAddDraft}
          onCommit={commitAddDraft}
          saving={addSaving}
          modelConfigResolutionPending={editor.pending}
          modelDefaultsLoaded={editor.defaultsLoaded}
          onModelIdBlur={() => {
            void editor.flush().catch(() => undefined);
          }}
        />
      </>
    </div>
  );
}
