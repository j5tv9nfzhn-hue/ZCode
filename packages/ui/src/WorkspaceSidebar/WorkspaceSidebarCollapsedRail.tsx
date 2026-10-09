import { PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function WorkspaceSidebarCollapsedRail({
  onToggleSidebar,
  toggleSidebarShortcutLabel,
}: {
  onToggleSidebar: () => void;
  toggleSidebarShortcutLabel?: string;
}) {
  const { intl } = useZCodeIntl();

  return (
    <aside className="flex h-full flex-col overflow-hidden border-r border-border bg-background-alt">
      {/*
        高度对齐展开态的 h-12 拖拽带：折叠与展开切换时按钮不跳位。
        图标**常驻**显示 PanelLeftOpen，不做 Logo↔图标交叉淡入——
        本 rail 是折叠后**唯一**的展开入口，按「看得见才算控件」处理。
        （原先沿用 DesktopTopOverlay 的 Logo 淡入式样，在只有这一个按钮的
        36px 条里没有任何品牌展示价值，反而让唯一的入口难以识别。）
      */}
      <div className="flex h-12 shrink-0 items-center justify-center px-1.5 [app-region:drag]">
        <div className="[app-region:no-drag]">
          <ControlHintTooltip
            title={intl.formatMessage({ id: "workspaceSidebar.toggleSidebar" })}
            shortcut={toggleSidebarShortcutLabel}
            side="bottom"
          >
            <Button
              type="button"
              variant="ghost"
              size="icon-md"
              className="rounded-lg"
              onClick={onToggleSidebar}
              aria-label={intl.formatMessage({
                id: "workspaceSidebar.toggleSidebar",
              })}
              data-testid="workspace-sidebar-expand-toggle"
            >
              <PanelLeftOpen className="size-4" />
            </Button>
          </ControlHintTooltip>
        </div>
      </div>
    </aside>
  );
}
