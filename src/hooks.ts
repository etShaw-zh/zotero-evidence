import { databaseService } from "./modules/db/database";
import { refreshProjectPaneContextCache } from "./modules/project/projectContext";
import { registerCodingPane } from "./modules/ui/codingPane";
import { EvidenceCommands } from "./modules/ui/commands";
import { registerFtQueuePane } from "./modules/ui/ftQueuePane";
import { registerScreenQueuePane } from "./modules/ui/screenQueuePane";
import { initLocale } from "./utils/locale";
import { createZToolkit } from "./utils/ztoolkit";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  await databaseService.init();
  await refreshProjectPaneContextCache();
  // Exposed on the shared Zotero[addonInstance] object (reachable across
  // sandbox boundaries, unlike a plain module import) so other contexts --
  // e.g. the test runner's separately-bundled sandbox -- can trigger a
  // refresh of *this* plugin instance's cache rather than their own copy.
  (addon.api as any).refreshProjectPaneContextCache =
    refreshProjectPaneContextCache;

  registerScreenQueuePane();
  registerFtQueuePane();
  registerCodingPane();

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  // Mark initialized as true to confirm plugin loading status
  // outside of the plugin (e.g. scaffold testing process)
  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  // Create ztoolkit for every window
  addon.data.ztoolkit = createZToolkit();

  // registerSection's header/sidenav l10nID resolve through the window's own
  // DOM Fluent system, separate from the getString() Localization instance
  // created in initLocale() -- both need the same ftl file loaded.
  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-addon.ftl`,
  );

  const doc = win.document;
  const styles = ztoolkit.UI.createElement(doc, "link", {
    properties: {
      type: "text/css",
      rel: "stylesheet",
      href: `chrome://${addon.data.config.addonRef}/content/zoteroPane.css`,
    },
  });
  doc.documentElement?.appendChild(styles);

  EvidenceCommands.registerMenus();
  EvidenceCommands.registerItemMenus();
}

async function onMainWindowUnload(win: Window): Promise<void> {
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
}

function onShutdown(): void {
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
  // Remove addon object
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

/**
 * This function is just an example of dispatcher for Notify events.
 * Any operations should be placed in a function to keep this funcion clear.
 */
async function onNotify(
  event: string,
  type: string,
  ids: Array<string | number>,
  extraData: { [key: string]: any },
) {
  ztoolkit.log("notify", event, type, ids, extraData);
}

/**
 * This function is just an example of dispatcher for Preference UI events.
 * Any operations should be placed in a function to keep this funcion clear.
 * @param type event type
 * @param data event data
 */
async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    default:
      return;
  }
}

function onShortcuts(type: string) {
  switch (type) {
    default:
      break;
  }
}

function onDialogEvents(type: string) {
  switch (type) {
    case "evidenceNewProject":
      EvidenceCommands.newProjectDialog();
      break;
    case "evidenceImport":
      EvidenceCommands.importDialog();
      break;
    case "evidenceImportExtract":
      EvidenceCommands.importExtractDialog();
      break;
    case "evidenceCriteria":
      EvidenceCommands.criteriaDialog();
      break;
    case "evidenceFtCriteria":
      EvidenceCommands.criteriaDialog("ft");
      break;
    case "evidenceAIProvider":
      EvidenceCommands.aiProviderDialog();
      break;
    case "evidenceProgress":
      EvidenceCommands.progressDialog();
      break;
    case "evidenceBatchRunAI":
      EvidenceCommands.batchRunAI();
      break;
    case "evidenceBatchConfirmAI":
      EvidenceCommands.batchConfirmAI();
      break;
    case "evidenceCodebookImport":
      EvidenceCommands.codebookImportDialog();
      break;
    case "evidenceCodebookAddVariable":
      EvidenceCommands.codebookAddVariableDialog();
      break;
    case "evidenceCodebookView":
      EvidenceCommands.codebookViewDialog();
      break;
    case "evidenceCodebookEditNotes":
      EvidenceCommands.codebookEditNotesDialog();
      break;
    case "evidenceExportPrisma":
      EvidenceCommands.exportPrismaDialog();
      break;
    case "evidenceExportScreeningLog":
      EvidenceCommands.exportScreeningLogDialog();
      break;
    case "evidenceExportCoding":
      EvidenceCommands.exportCodingDataDialog();
      break;
    default:
      break;
  }
}

// Add your hooks here. For element click, etc.
// Keep in mind hooks only do dispatch. Don't add code that does real jobs in hooks.
// Otherwise the code would be hard to read and maintain.

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
  onPrefsEvent,
  onShortcuts,
  onDialogEvents,
};
