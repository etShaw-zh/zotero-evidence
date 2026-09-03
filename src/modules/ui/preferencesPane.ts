import { config } from "../../../package.json";

// The project's tsconfig targets Zotero's privileged sandbox (lib: ESNext
// only, no DOM globals -- every other file gets `document`/`window` handed
// in as a parameter from a Zotero API instead). This file is the one
// exception: it's loaded as a real <script> into the Settings window, a
// genuine browser-like DOM context, where these two ARE ambient globals at
// runtime. `Document`/`Window` themselves already resolve project-wide via
// zotero-types' bundled Gecko DOM lib -- only the global variable bindings
// are missing, so declaring just those two (not pulling in TS's own lib.dom
// wholesale, which would duplicate zotero-types' declarations) is enough.
declare const document: Document;

/**
 * Runs inside Zotero's Settings window, in that window's OWN sandbox --
 * NOT part of the main plugin bundle (src/index.ts), same reason the
 * MuPDF worker is its own bundle (see zotero-plugin.config.ts). Nothing
 * from src/modules is importable here; the only way to reach the running
 * plugin instance is the shared Zotero[addonInstance] object hooks.ts's
 * onStartup() attaches api functions to, exactly like the MuPDF worker
 * reaches the plugin via chrome:// URLs instead of a module import.
 *
 * Every STATIC label in the pane (caption, hint, button text, the "about"
 * line) is wired declaratively in preferencesPane.xhtml itself via
 * `data-l10n-id`/`data-l10n-args` -- Zotero's own preferences.js already
 * runs `document.l10n.translateFragment()` on every pane it loads. The one
 * thing that can't be a static Fluent string is which AI provider is
 * currently active, so that's the only round-trip this script makes back
 * into the addon.
 *
 * Zotero's preferences.js loads a pane's `scripts` via
 * Services.scriptloader.loadSubScript() BEFORE fetching/parsing/inserting
 * that pane's own XHTML fragment -- confirmed against the shipped
 * preferences.js (`rest()`: script loading happens first, `pane.container.
 * append(contentFragment)` only after) and against the sibling
 * beaver-zotero plugin's own working pane script, which hits this exact
 * issue and documents the fix: don't look up an element by id at the top
 * level (it doesn't exist yet -- returns null, so a naive first attempt at
 * this file silently did nothing). Two different fixes for the two
 * different needs below.
 */
interface EvidenceAddonApi {
  getActiveProviderSummary: () => string;
  openAIProviderDialog: () => void;
  openAIUsageDialog: () => void;
  openUserGuide: () => void;
}

function getApi(): EvidenceAddonApi | null {
  return (Zotero as any)[config.addonInstance]?.api ?? null;
}

const AI_PROVIDER_BTN = "zotero-evidence-prefs-ai-provider-btn";
const AI_USAGE_BTN = "zotero-evidence-prefs-ai-usage-btn";
const USER_GUIDE_BTN = "zotero-evidence-prefs-user-guide-btn";

/**
 * Button clicks: listen on `document` itself (which -- unlike the buttons
 * -- already exists at script-load time) for the "command" event bubbling
 * up, exactly like beaver-zotero's addon/content/beaverZoteroPrefs.js.
 * Registered once, works no matter when/whether the fragment beneath it
 * gets inserted or re-inserted.
 */
document.addEventListener("command", (event: Event) => {
  const id = (event.target as Element | null)?.id;
  if (!id) return;
  const api = getApi();
  if (!api) return;
  if (id === AI_PROVIDER_BTN) api.openAIProviderDialog();
  else if (id === AI_USAGE_BTN) api.openAIUsageDialog();
  else if (id === USER_GUIDE_BTN) api.openUserGuide();
});

/**
 * The active-provider status line: unlike a click listener, this needs
 * the actual element (nothing to delegate a "set my textContent" event
 * through), so it has to wait for the fragment to actually exist. Polling
 * via a MutationObserver rather than guessing a delay -- reacts to the
 * real insertion moment whenever Zotero's own pane-loading sequence gets
 * there, not a fixed timeout that could in principle still race it.
 */
function renderStatus(): boolean {
  const statusEl = document.getElementById("zotero-evidence-prefs-status");
  const api = getApi();
  if (!statusEl || !api) return false;
  statusEl.textContent = api.getActiveProviderSummary();
  return true;
}

/**
 * "showing" is Zotero's own signal that this pane is on-screen again
 * (dispatched on every direct child of the pane's container each time the
 * user navigates back to it, per `_showPane` in preferences.js) -- wired
 * up once the root element genuinely exists, so the status line reflects
 * a provider change made via this pane's own "AI Provider Settings..."
 * button (a separate popup window) without needing the Settings window
 * closed and reopened.
 */
function wireShowingRefresh(): void {
  document
    .getElementById("zotero-evidence-prefs-pane")
    ?.addEventListener("showing", renderStatus);
}

if (renderStatus()) {
  wireShowingRefresh();
} else {
  const observer = new MutationObserver(() => {
    if (renderStatus()) {
      observer.disconnect();
      wireShowingRefresh();
    }
  });
  observer.observe(document.documentElement || document, {
    childList: true,
    subtree: true,
  });
}
