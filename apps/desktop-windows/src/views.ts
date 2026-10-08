// Views layer — the router.
//
// Every view is its own module under `src/views/`, one file per view, because a
// single `views.ts` grew past 800 lines and every edit meant re-reading every
// other view to find out what it touched. `main.ts` imports from here; nothing
// imports a view module directly, so the routing table below stays the one
// place that knows what exists.

import type { IslandViewName } from "./island/layout";
import { renderHeader } from "./views/header";
import { renderOverviewView } from "./views/overview";
import { renderApprovalView, renderQuestionView } from "./views/approvals";
import { renderTerminalView } from "./views/terminal";
import { renderEmptyView } from "./views/empty";
import { renderPromptView } from "./views/activity";
import { renderLauncherView } from "./views/launcher";
import { renderMediaView } from "./views/media";
import { renderSettingsView } from "./views/settings";
import { renderSessionView } from "./views/working";

export { ViewData, can, esc, fmtTokens } from "./views/state";
export { refocusIfIdle } from "./views/overview";
export { currentTouchedFile, isSessionActive } from "./views/working";
export { renderWorkPanel, renderSessionView } from "./views/working";
export { renderHeader } from "./views/header";
export { renderCompactContent } from "./views/compact";

export function renderViewContent(view: IslandViewName): string {
  switch (view) {
    case "approval":
      return renderApprovalView();
    case "question":
      return renderQuestionView();
    case "empty":
      return renderEmptyView();
    case "prompt":
      return renderPromptView();
    case "launcher":
      return renderLauncherView();
    case "finished":
      return renderTerminalView(true);
    case "error":
      return renderTerminalView(false);
    case "session":
      return renderSessionView();
    case "media":
      return renderMediaView();
    case "settings":
      return renderSettingsView();
    case "overview":
    default:
      return renderOverviewView();
  }
}