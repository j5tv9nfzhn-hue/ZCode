/* eslint-disable max-lines -- 模型菜单同时维护触发器、模型项、provider family 连接方式子菜单和焦点恢复，拆开会增加受控 Dropdown 状态同步成本。 */
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { cn } from "@/components/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip.js";
import { AlertCircle, CheckIcon, ChevronDownIcon, LoaderIcon, PackageIcon } from "lucide-react";
import {
  TID_CHAT_MODEL_SELECT_GROUP,
  TID_CHAT_MODEL_SELECT_ITEM,
  TID_CHAT_MODEL_SELECT_TRIGGER,
  testId,
} from "@zcode/shared";
import {
  isCoarseTouchDevice,
  shouldRestoreChatInputFocusAfterPickerClose,
} from "@/lib/pickerFocus.js";
import { RollingToolbarLabel } from "@/chat-input-toolbar/RollingToolbarLabel.js";
import { ModelInputCapabilityBadge } from "@/components/ModelInputCapabilityBadge.js";

export interface ModelSelectGroupItem {
  key: string;
  value: string;
  name: string;
  badgeLabel?: string;
  supportsVisionInput?: boolean;
}

export interface ModelSelectConnectionOption {
  key: string;
  label: string;
  badgeLabel?: string;
  value: string;
  providerId: string;
  familyId: string;
  mode: "oauth" | "apiKey";
  disabled?: boolean;
}

export interface ModelSelectGroup {
  key: string;
  label: string;
  labelBadge?: string;
  directItems?: boolean;
  selectedOptionKey?: string;
  connectionOptions?: ModelSelectConnectionOption[];
  items: ModelSelectGroupItem[];
}

export interface ModelSelectFooterAction {
  key: string;
  label: string;
  selected?: boolean;
  onSelect?: () => void;
}

const EMPTY_MODEL_SELECT_FOOTER_ACTIONS: readonly ModelSelectFooterAction[] = [];

/**
 * 模型菜单长列表优化（本地自用分支性能修复）。
 *
 * 单 provider 或 `directItems` 组会把**全部**模型内联进菜单，模型多时（如接了
 * OpenAI 兼容端点一次返回数百个）滚动要反复对屏外行做布局与绘制。
 * `content-visibility: auto` 让浏览器跳过屏外行的布局/绘制，
 * `contain-intrinsic-size: auto 2rem`（`min-h-8` = 2rem）表示「优先用上次实测高度，
 * 未渲染过则按 2rem 估算」，保证滚动条高度稳定。
 *
 * 刻意**不做 DOM 虚拟化**：ModelConfigSelect 被聊天工具栏、子代理、自动化、错峰、
 * 工作流设置等 6+ 处复用，Radix DropdownMenu 的焦点/键盘/typeahead 依赖真实 DOM 节点，
 * 虚拟化会让键盘无法走到未渲染项。content-visibility 保留完整 DOM 语义，
 * 只省掉不可见行的绘制成本，是这里风险最低的等价优化。
 */
const MODEL_ITEM_OFFSCREEN_CLASS_NAME =
  "[content-visibility:auto] [contain-intrinsic-size:auto_2rem]";
export const MODEL_CONFIG_SELECT_BADGE_CLASS_NAME =
  "shrink-0 rounded-full bg-surface px-1 py-px text-ui-xs font-medium leading-normal text-foreground-subtle";

/**
 * 一组模型项的纯渲染组件。存在的唯一理由是 memo 边界：
 * 父组件（ModelConfigSelect）在菜单打开时每轮 render 都会重建所有 group 的内容，
 * 模型多的 provider（一次返回数百个）会反复对屏外行做 diff。这里让「items 引用
 * 不变 + 三个稳定回调」直接短路子树，只有 items 真变化时才重建。
 *
 * 刻意不接收父组件里的 renderModelItem/renderModelItems 回调——那会让 memo 恒失效。
 */
const ModelItemsGroup = memo(function ModelItemsGroupComponent({
  items,
  normalizedValue,
  isItemLocked,
  lockReasonMessage,
  onValueChange,
}: {
  items: readonly ModelSelectGroupItem[];
  normalizedValue: string;
  isItemLocked: (candidateValue: string) => boolean;
  lockReasonMessage: string;
  /** 已包含「提交选择 + 关闭菜单」两个动作，引用必须稳定。 */
  onValueChange: (value: string) => void;
}) {
  return (
    <DropdownMenuRadioGroup value={normalizedValue}>
      {items.map((item) => (
        <ModelItemRow
          key={item.key}
          item={item}
          selected={item.value === normalizedValue}
          locked={isItemLocked(item.value)}
          lockReasonMessage={lockReasonMessage}
          onValueChange={onValueChange}
        />
      ))}
    </DropdownMenuRadioGroup>
  );
});

const ModelItemRow = memo(function ModelItemRowComponent({
  item,
  selected,
  locked,
  lockReasonMessage,
  onValueChange,
}: {
  item: ModelSelectGroupItem;
  selected: boolean;
  locked: boolean;
  lockReasonMessage: string;
  /** 已包含「提交选择 + 关闭菜单」两个动作。 */
  onValueChange: (value: string) => void;
}) {
  const commonProps = {
    "data-model-option-locked": locked ? "true" : undefined,
    "data-model-option-selected": selected ? "true" : undefined,
    "data-testid": testId(TID_CHAT_MODEL_SELECT_ITEM, item.value),
    "data-checked": selected ? "true" : undefined,
  } as const;
  const content = (
    <>
      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
        <span className="min-w-0 truncate" title={item.name}>
          {item.name}
        </span>
        {item.badgeLabel ? (
          <span className={MODEL_CONFIG_SELECT_BADGE_CLASS_NAME}>{item.badgeLabel}</span>
        ) : null}
        {item.supportsVisionInput ? <ModelInputCapabilityBadge /> : null}
      </span>
      {locked ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="inline-flex size-4 items-center justify-center rounded-full text-foreground-subtlest hover:text-foreground-subtle"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
              >
                <AlertCircle className="size-4" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="right" align="center" sideOffset={6}>
              {lockReasonMessage}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : null}
      {locked && selected ? <CheckIcon className="size-4 text-foreground-subtle" /> : null}
    </>
  );

  if (locked) {
    return (
      <DropdownMenuItem
        {...commonProps}
        className={cn(
          "min-h-8 cursor-not-allowed gap-2 px-2 text-ui-base text-foreground-subtlest data-[highlighted]:text-foreground-subtlest",
          MODEL_ITEM_OFFSCREEN_CLASS_NAME,
        )}
        onSelect={(event) => event.preventDefault()}
      >
        {content}
      </DropdownMenuItem>
    );
  }

  return (
    <DropdownMenuRadioItem
      {...commonProps}
      value={item.value}
      className={cn("min-h-8 gap-2 pl-2 pr-8 text-ui-base", MODEL_ITEM_OFFSCREEN_CLASS_NAME)}
      onSelect={() => {
        onValueChange(item.value);
      }}
    >
      {content}
    </DropdownMenuRadioItem>
  );
});

function shouldShowModelProviderLevel(modelGroups: readonly ModelSelectGroup[]): boolean {
  return modelGroups.length > 0;
}

function isFamilyConnectionGroup(
  group: Pick<ModelSelectGroup, "connectionOptions" | "key" | "labelBadge">,
): boolean {
  return (
    group.key.startsWith("family:") ||
    Boolean(group.labelBadge?.trim()) ||
    (group.connectionOptions?.length ?? 0) > 0
  );
}

function shouldRenderModelGroupSeparator(
  previousGroup: Pick<ModelSelectGroup, "connectionOptions" | "key" | "labelBadge"> | undefined,
  currentGroup: Pick<ModelSelectGroup, "connectionOptions" | "key" | "labelBadge">,
): boolean {
  if (!previousGroup) {
    return false;
  }
  return isFamilyConnectionGroup(previousGroup) || isFamilyConnectionGroup(currentGroup);
}

function isModelSelectGroupSelected(
  group: Pick<ModelSelectGroup, "items">,
  normalizedValue: string,
): boolean {
  return group.items.some((item) => item.value === normalizedValue);
}

function getModelTriggerLabelClassName({
  labelVisibilityClassName,
  triggerLabelClassName,
}: {
  labelVisibilityClassName: string | undefined;
  triggerLabelClassName?: string;
}): string {
  if (triggerLabelClassName?.trim()) {
    return triggerLabelClassName;
  }

  return cn("min-w-0 text-left", labelVisibilityClassName);
}

interface ModelConfigSelectProps {
  modelGroups: readonly ModelSelectGroup[];
  normalizedValue: string;
  triggerLabel: string;
  triggerLabelPrefix?: string;
  triggerLabelValue?: string;
  triggerLabelPrefixClassName?: string;
  showManageModelsAction: boolean;
  lockReasonMessage: string;
  isItemLocked: (candidateValue: string) => boolean;
  onValueChange: (value: string) => void;
  onConnectionValueChange?: (option: ModelSelectConnectionOption) => void;
  disabled?: boolean;
  tooltipTitle?: string;
  guideTooltipTitle?: ReactNode;
  guideTooltipOpen?: boolean;
  onGuideTooltipDismiss?: () => void;
  shortcutLabel?: string;
  triggerRef?: RefObject<HTMLSpanElement | null>;
  /** 传入时由调用方统一协调菜单；省略则保持组件原有的内部开关状态。 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  openRequestKey?: number;
  pendingLabel?: string | null;
  pending?: boolean;
  labelVisibilityClassName?: string;
  indicatorClassName?: string;
  triggerClassName?: string;
  triggerIconClassName?: string;
  triggerLabelClassName?: string;
  triggerTestId?: string;
  formatTriggerLabel?: (label: string) => string;
  /** false 时把第一个 group 作为无 provider 层的扁平模型列表展示。 */
  showProviderLevel?: boolean;
  /** 覆盖 provider 二级模型菜单样式；缺省按内容扩展并保留最小宽度。 */
  providerSubmenuClassName?: string;
  footerActions?: readonly ModelSelectFooterAction[];
  manageModelsLabel?: string;
  onManageModels?: () => void;
  focusSelectorOnClose?: string | null;
  contentSide?: "top" | "bottom" | "left" | "right";
  contentAlign?: "start" | "center" | "end";
  /**
   * 排在所有分组之上的单选项（与分组之间隔一条线）。工作流「配置」弹层用它把「会话模型」放在第一位；
   * 缺省即无。
   */
  leadingItems?: readonly ModelSelectGroupItem[];
  /** 触发器里标签之后的小徽标（如「会话模型」「不可用」）；缺省即无。 */
  triggerBadge?: ReactNode;
}

export const ModelConfigSelect = memo(function ModelConfigSelectComponent({
  modelGroups,
  normalizedValue,
  triggerLabel,
  triggerLabelPrefix,
  triggerLabelValue,
  triggerLabelPrefixClassName,
  showManageModelsAction,
  lockReasonMessage,
  isItemLocked,
  onValueChange,
  onConnectionValueChange,
  disabled,
  tooltipTitle,
  guideTooltipTitle,
  guideTooltipOpen = false,
  onGuideTooltipDismiss,
  shortcutLabel,
  triggerRef,
  open: controlledOpen,
  onOpenChange,
  openRequestKey = 0,
  pendingLabel,
  pending,
  labelVisibilityClassName = "hidden @xl/composer:inline-flex",
  indicatorClassName,
  triggerClassName,
  triggerIconClassName = "hidden",
  triggerLabelClassName: customTriggerLabelClassName,
  triggerTestId = TID_CHAT_MODEL_SELECT_TRIGGER,
  formatTriggerLabel,
  showProviderLevel,
  providerSubmenuClassName,
  footerActions = EMPTY_MODEL_SELECT_FOOTER_ACTIONS,
  manageModelsLabel,
  onManageModels,
  focusSelectorOnClose = '[data-testid="chat-input"]',
  contentSide = "top",
  contentAlign = "start",
  leadingItems,
  triggerBadge,
}: ModelConfigSelectProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const lastOpenRequestKeyRef = useRef(openRequestKey);
  const hasSelectableModel = modelGroups.length > 0;
  // 闲时任务白名单只有一层模型值；只要存在 group 就强制展示 provider 层的话，
  // 下方已有的扁平模型分支永远不可达，也无法复用 New Task 模型选择器。
  const shouldShowProviderLevel = showProviderLevel ?? shouldShowModelProviderLevel(modelGroups);
  // 模型名和上游占位值可能大小写敏感，强制大写会把 `<synthetic>` 改成 `<SYNTHETIC>` 这类非原始值。
  const triggerDisplayLabel = triggerLabel;
  const renderedTriggerDisplayLabel =
    formatTriggerLabel?.(triggerDisplayLabel) ?? triggerDisplayLabel;
  const renderedPendingLabel =
    pendingLabel && formatTriggerLabel ? formatTriggerLabel(pendingLabel) : pendingLabel;
  const currentTriggerLabel =
    pending && renderedPendingLabel ? renderedPendingLabel : renderedTriggerDisplayLabel;
  const currentTriggerTitle = pending && pendingLabel ? pendingLabel : triggerDisplayLabel;
  const triggerLabelClassName = getModelTriggerLabelClassName({
    labelVisibilityClassName,
    triggerLabelClassName: customTriggerLabelClassName,
  });

  const handlePopoverOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (controlledOpen === undefined) {
        setUncontrolledOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    },
    [controlledOpen, onOpenChange],
  );

  useEffect(() => {
    if (openRequestKey <= 0 || openRequestKey === lastOpenRequestKeyRef.current) {
      return;
    }
    lastOpenRequestKeyRef.current = openRequestKey;

    if (disabled) {
      return;
    }

    // 模型菜单是受控 DropdownMenu，快捷键不能依赖模拟 click 触发。
    // Tooltip/Dropdown 多层 asChild 合并 ref 时，click 可能找不到真实 trigger；这里直接打开菜单状态。
    handlePopoverOpenChange(true);
    triggerRef?.current?.focus();
  }, [disabled, handlePopoverOpenChange, openRequestKey, triggerRef]);

  // 稳定引用：ModelItemsGroup/ModelItemRow 是 memo 组件，若把箭头函数作为 prop
  // 传入，每次父 render 都会换引用，memo 恒失效。这个回调同时承担「提交选择 +
  // 关闭菜单」两个动作，与旧 renderModelItem 里内联 onSelect 的语义一致。
  const handleModelItemSelect = useCallback(
    (nextValue: string) => {
      onValueChange(nextValue);
      handlePopoverOpenChange(false);
    },
    [onValueChange, handlePopoverOpenChange],
  );

  const triggerAriaLabel = useMemo(() => {
    return pending && pendingLabel ? pendingLabel : (tooltipTitle ?? currentTriggerTitle);
  }, [currentTriggerTitle, pending, pendingLabel, tooltipTitle]);

  // 模型列表内容 memo 化：菜单打开时父组件每轮 render 都会重建全部 group 的
  // 模型项（含 directItems 内联的整组模型）。这里把「items 数组 + 三个稳定回调」
  // 作为 memo 边界，group.items 引用不变时直接复用已渲染的子树。
  const renderModelItems = useCallback(
    (items: readonly ModelSelectGroupItem[]) => (
      <ModelItemsGroup
        items={items}
        normalizedValue={normalizedValue}
        isItemLocked={isItemLocked}
        lockReasonMessage={lockReasonMessage}
        onValueChange={handleModelItemSelect}
      />
    ),
    [handleModelItemSelect, isItemLocked, lockReasonMessage, normalizedValue],
  );

  const renderGroupLabel = useCallback(
    (group: ModelSelectGroup, options: { mutedLabel?: boolean } = {}) => (
      <span className="min-w-0 flex-1 items-center gap-1.5 text-left inline-flex">
        <span
          className={cn(
            "min-w-0 whitespace-normal break-words text-ui-base",
            options.mutedLabel && "text-foreground-subtle",
          )}
          title={group.label}
        >
          {group.label}
        </span>
        {group.labelBadge ? (
          <span className={MODEL_CONFIG_SELECT_BADGE_CLASS_NAME}>{group.labelBadge}</span>
        ) : null}
      </span>
    ),
    [],
  );

  const renderProviderConnectionHeader = useCallback(
    (group: ModelSelectGroup) => {
      const options = group.connectionOptions ?? [];
      if (options.length > 0) {
        const selectedOptionKey = group.selectedOptionKey ?? options[0]?.key;
        const selectedConnection =
          options.find((option) => option.key === selectedOptionKey) ?? options[0];
        return (
          <div className="flex min-h-8 items-center gap-2 px-2 py-1">
            <span
              className="min-w-0 flex-1 truncate text-left text-ui-sm font-medium text-foreground-subtlest"
              title={group.label}
            >
              {group.label}
            </span>
            <Select
              value={selectedOptionKey}
              onValueChange={(nextKey) => {
                const option = options.find((candidate) => candidate.key === nextKey);
                if (!option) {
                  return;
                }
                // 切换连接方式后需要保留外层模型菜单，方便用户继续选择刷新后的模型。
                onConnectionValueChange?.(option);
              }}
            >
              <SelectTrigger
                size="xs"
                variant="outline"
                className="min-w-0 shrink-0 gap-0.5 rounded-full pr-1.5 text-ui-sm text-foreground-subtle [&_svg]:size-3"
                data-testid={testId(TID_CHAT_MODEL_SELECT_GROUP, group.key)}
                data-model-provider-key={group.key}
                onPointerDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <span className="max-w-28 truncate">
                  {selectedConnection?.badgeLabel ?? selectedConnection?.label ?? group.label}
                </span>
              </SelectTrigger>
              <SelectContent
                align="end"
                position="popper"
                className="w-max min-w-40 max-w-72"
                onCloseAutoFocus={(event) => event.preventDefault()}
              >
                {options.map((option) => (
                  <SelectItem
                    key={option.key}
                    value={option.key}
                    data-model-connection-option={option.key}
                  >
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      }

      return null;
    },
    [onConnectionValueChange],
  );

  const renderedFooterActions = useMemo<ModelSelectFooterAction[]>(() => {
    const actions = [...footerActions];
    if (showManageModelsAction && manageModelsLabel) {
      actions.push({
        key: "manage-models",
        label: manageModelsLabel,
        onSelect: onManageModels,
      });
    }
    return actions;
  }, [footerActions, manageModelsLabel, onManageModels, showManageModelsAction]);

  const modelTrigger = (
    <DropdownMenuTrigger asChild>
      <Button
        type="button"
        variant="ghost"
        size="default"
        disabled={disabled}
        data-chat-toolbar-popover-trigger="true"
        data-testid={triggerTestId}
        data-model-current-value={normalizedValue}
        aria-label={triggerAriaLabel}
        onClick={guideTooltipOpen ? onGuideTooltipDismiss : undefined}
        className={cn(
          "w-fit justify-between gap-1 rounded-lg pl-2 pr-1.5 text-ui-base whitespace-nowrap",
          triggerClassName,
        )}
      >
        <PackageIcon
          className={cn("pointer-events-none size-4 shrink-0 text-current", triggerIconClassName)}
          aria-hidden="true"
        />
        <span className={triggerLabelClassName} title={currentTriggerTitle}>
          <RollingToolbarLabel
            label={currentTriggerLabel}
            prefix={pending ? undefined : triggerLabelPrefix}
            prefixClassName={triggerLabelPrefixClassName}
            value={pending ? undefined : triggerLabelValue}
          />
        </span>
        {triggerBadge}
        {pending ? (
          <LoaderIcon className="pointer-events-none size-3.5 animate-spin text-foreground" />
        ) : null}
        {!pending && (
          <ChevronDownIcon
            className={cn(
              "pointer-events-none size-3.5 text-foreground-subtle",
              indicatorClassName,
            )}
          />
        )}
      </Button>
    </DropdownMenuTrigger>
  );

  return (
    <DropdownMenu open={open} onOpenChange={handlePopoverOpenChange}>
      {tooltipTitle ? (
        <ControlHintTooltip
          title={guideTooltipOpen && guideTooltipTitle ? guideTooltipTitle : tooltipTitle}
          shortcut={guideTooltipOpen ? undefined : shortcutLabel}
          triggerRef={triggerRef}
          open={guideTooltipOpen ? true : undefined}
          className={guideTooltipOpen ? "bg-background py-0.5 pr-0.5 pl-2" : undefined}
        >
          {modelTrigger}
        </ControlHintTooltip>
      ) : (
        modelTrigger
      )}
      {open ? (
        <DropdownMenuContent
          className={cn(
            shouldShowProviderLevel
              ? // provider 级菜单此前没有高度上限：`directItems` 组（账号/权益 provider）
                // 会把全部模型内联渲染，模型多时弹层会高到溢出视口且无法滚动。
                // 这里补上「可用高度与 24rem 取小」的上限并允许滚动；子菜单是 portal 渲染，
                // 不会被这个 overflow 裁切。
                "w-max min-w-48 max-w-[calc(100vw-2rem)] max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto"
              : "w-48 max-h-72 overflow-y-auto",
          )}
          align={contentAlign}
          side={contentSide}
          onCloseAutoFocus={(event) => {
            if (!focusSelectorOnClose) {
              // Automations 没有聊天输入框可恢复；保留 Radix 默认行为，
              // 让键盘焦点回到触发器，而不是 preventDefault 后掉到 body。
              return;
            }
            event.preventDefault();
            if (
              !shouldRestoreChatInputFocusAfterPickerClose({
                isCoarseTouchDevice: isCoarseTouchDevice(),
              })
            ) {
              return;
            }
            // 聊天输入框的 data-testid 挂在 contenteditable 自身上，不是父节点。
            // 这里与 mode 选择器保持同一个入口，避免关闭模型弹层后找不到输入框而丢失焦点。
            const input = document.querySelector<HTMLElement>(focusSelectorOnClose);
            input?.focus();
          }}
        >
          {leadingItems !== undefined && leadingItems.length > 0 ? (
            <>
              {renderModelItems(leadingItems)}
              {hasSelectableModel ? <DropdownMenuSeparator /> : null}
            </>
          ) : null}
          {hasSelectableModel && shouldShowProviderLevel
            ? modelGroups.map((group, index) => {
                const groupSeparator = shouldRenderModelGroupSeparator(
                  modelGroups[index - 1],
                  group,
                ) ? (
                  <DropdownMenuSeparator />
                ) : null;
                if (group.directItems) {
                  return (
                    <Fragment key={group.key}>
                      {groupSeparator}
                      <div>
                        <DropdownMenuLabel
                          className="flex min-h-8 items-center px-2 py-1"
                          data-testid={testId(TID_CHAT_MODEL_SELECT_GROUP, group.key)}
                          data-model-provider-key={group.key}
                        >
                          {renderGroupLabel(group)}
                        </DropdownMenuLabel>
                        {renderProviderConnectionHeader(group)}
                        {renderModelItems(group.items)}
                      </div>
                    </Fragment>
                  );
                }

                const groupSelected = isModelSelectGroupSelected(group, normalizedValue);
                return (
                  <Fragment key={group.key}>
                    {groupSeparator}
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger
                        className="min-h-8"
                        data-testid={testId(TID_CHAT_MODEL_SELECT_GROUP, group.key)}
                        data-model-provider-key={group.key}
                        data-model-provider-selected={groupSelected ? "true" : undefined}
                      >
                        {renderGroupLabel(group)}
                        {groupSelected ? (
                          <CheckIcon className="size-4 text-foreground-subtle" />
                        ) : null}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent
                        className={cn(
                          "max-h-72 overflow-y-auto",
                          // 固定宽度会提前截断模型名；按内容扩展，并让可用空间优先于最小宽度。
                          providerSubmenuClassName ??
                            "w-max min-w-[min(12rem,var(--radix-dropdown-menu-content-available-width))] max-w-(--radix-dropdown-menu-content-available-width)",
                        )}
                      >
                        {renderModelItems(group.items)}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  </Fragment>
                );
              })
            : hasSelectableModel
              ? renderModelItems(modelGroups[0]?.items ?? [])
              : null}
          {renderedFooterActions.length > 0 ? (
            <div className="sticky bottom-0 z-10 bg-menu after:absolute after:left-0 after:top-full after:h-1 after:w-full after:bg-menu after:content-['']">
              {hasSelectableModel ? <DropdownMenuSeparator /> : null}
              {renderedFooterActions.map((action) => (
                <DropdownMenuItem
                  key={action.key}
                  className="min-h-8 gap-2 px-2"
                  data-model-footer-action={action.key}
                  data-model-footer-action-selected={action.selected ? "true" : undefined}
                  onSelect={() => {
                    handlePopoverOpenChange(false);
                    action.onSelect?.();
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{action.label}</span>
                  {action.selected ? <CheckIcon className="size-4 text-foreground-subtle" /> : null}
                </DropdownMenuItem>
              ))}
            </div>
          ) : null}
        </DropdownMenuContent>
      ) : null}
    </DropdownMenu>
  );
});
