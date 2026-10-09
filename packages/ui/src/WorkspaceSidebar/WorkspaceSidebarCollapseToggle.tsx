import { PanelLeftClose } from "lucide-react";

import { Button } from "@/components/ui/button.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

/**
 * 展开态的常驻折叠控件。
 *
 * 为什么需要它：折叠状态与 `handleToggleSidebar` 一直都存在（useAppPanels.ts:205/:1240），
 * 但此前侧栏把回调接过来就丢弃（WorkspaceSidebar.tsx:251 的 `_onToggleSidebar`），
 * 唯一入口是 DesktopTopOverlay 里那个**应用 Logo**——折叠图标靠 `group-hover` 才淡入，
 * 读起来是品牌标识而不是控件。结果是折叠功能事实上不可发现。
 *
 * 三个必须遵守的点：
 *  1. `no-drag`：本按钮坐在侧栏顶部的 `[app-region:drag]` 带里，Electron 会优先按
 *     父级命中拖拽区域，点击会被窗口拖动吞掉（同一教训见 DesktopTopOverlay.tsx:128-131）。
 *  2. 图标**常驻**，不靠 hover 显形——这正是原 Logo 入口的问题所在。
 *  3. 不引入折叠状态：只透传 `onToggleSidebar`，状态所有者仍只有 useAppPanels 一处。
 */
export function WorkspaceSidebarCollapseToggle({
  onToggleSidebar,
  toggleSidebarShortcutLabel,
}: {
  onToggleSidebar: () => void;
  toggleSidebarShortcutLabel?: string;
}) {
  const { intl } = useZCodeIntl();
  const label = intl.formatMessage({ id: "workspaceSidebar.toggleSidebar" });

  return (
    <div className="[app-region:no-drag] ml-auto">
      <ControlHintTooltip title={label} shortcut={toggleSidebarShortcutLabel} side="bottom">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          data-testid="workspace-sidebar-collapse-toggle"
          onClick={onToggleSidebar}
        >
          <PanelLeftClose className="size-4" />
        </Button>
      </ControlHintTooltip>
    </div>
  );
}
