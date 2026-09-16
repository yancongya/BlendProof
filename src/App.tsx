/**
 * App.tsx — thin router/entry barrel.
 *
 * Re-exports the two page-level components so that main.tsx (and any tests
 * that import from "./App") continue to work without modification.
 *
 * The actual implementation is split across:
 *   src/pages/WorkspacePage.tsx  — upload workspace (formerly App())
 *   src/pages/SharePage.tsx      — /s/<token> viewer
 */

export { WorkspacePage as App } from "./pages/WorkspacePage";
export { SharePage } from "./pages/SharePage";
