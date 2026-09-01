import { FluentMessageId } from "../../../typings/i10n";
import { config } from "../../../package.json";
import { getPref } from "../../utils/prefs";
import { getString } from "../../utils/locale";
import { runWithConcurrency } from "../../utils/concurrency";
import {
  getActiveProvider,
  setActiveProviderId,
  upsertProvider,
} from "../ai/providerConfig";
import { getAIUsageStats } from "../ai/usageService";
import { exportProjectArchive } from "../archive/archiveExportService";
import { importProjectArchive } from "../archive/archiveImportService";
import {
  CodebookVariable,
  getLatestCodebook,
  parseCodebookCsv,
  saveCodebook,
} from "../coding/codebookService";
import { computeCodingStats } from "../coding/codingService";
import {
  getSynthesisRows,
  runSynthesis,
  SynthesisRow,
} from "../coding/synthesisService";
import { exportCodingData } from "../export/codingExport";
import { exportSynthesisData } from "../export/synthesisExport";
import {
  computePrismaData,
  exportScreeningLog,
  formatPrismaCsv,
} from "../export/screeningExport";
import {
  importDirectToCoding,
  importLiteratureFile,
} from "../import/importService";
import {
  currentDeciderId,
  escapeHtml,
  quotePreview,
  resolveAttachment,
} from "./paneHelpers";
import {
  resolveProjectCollections,
  SOURCE_DATABASE_LABELS,
} from "../project/collectionStructure";
import {
  findProjectPaneContext,
  getRootCollectionId,
  refreshProjectPaneContextCache,
} from "../project/projectContext";
import {
  createProject,
  deleteProject,
  EvidenceProject,
  listProjects,
} from "../project/projectManager";
import {
  getLatestCriteria,
  saveCriteria,
  ScreeningCriteria,
} from "../screening/criteriaService";
import {
  confirmDecision,
  getScreeningState,
  runAIJudgment,
} from "../screening/taScreeningService";
import { markUnavailable } from "../screening/ftScreeningService";
import {
  getScreeningConsistency,
  ScreeningConsistencyResult,
  ScreeningConsistencyStage,
  ScreeningConsistencyStats,
} from "../screening/consistencyService";
import {
  applyReconciliation,
  computeRoundConsistency,
  ConsistencyResolution,
  ConsistencyRound,
  getActiveRound,
  HumanConsistencyResult,
  recordCollectedCsv,
  startFullRound,
  startPilotRound,
} from "../screening/humanConsistencyService";

export class EvidenceCommands {
  static registerMenus() {
    ztoolkit.Menu.register("menuFile", { tag: "menuseparator" });
    ztoolkit.Menu.register("menuFile", {
      tag: "menu",
      id: "zotero-evidence-project-menu",
      label: getString("menu-group-project"),
      icon: `chrome://${config.addonRef}/content/icons/icon.svg`,
      children: [
        {
          tag: "menuitem",
          id: "zotero-evidence-new-project",
          label: getString("menu-new-project"),
          commandListener: () =>
            addon.hooks.onDialogEvents("evidenceNewProject"),
        },
        {
          tag: "menuitem",
          id: "zotero-evidence-delete-project",
          label: getString("menu-delete-project"),
          commandListener: () =>
            addon.hooks.onDialogEvents("evidenceDeleteProject"),
        },
        {
          tag: "menuitem",
          id: "zotero-evidence-archive-project",
          label: getString("menu-archive-project"),
          commandListener: () =>
            addon.hooks.onDialogEvents("evidenceArchiveProject"),
        },
        {
          tag: "menuitem",
          id: "zotero-evidence-restore-archive",
          label: getString("menu-restore-archive"),
          commandListener: () =>
            addon.hooks.onDialogEvents("evidenceRestoreArchive"),
        },
        {
          tag: "menuitem",
          id: "zotero-evidence-progress",
          label: getString("menu-progress"),
          commandListener: () => addon.hooks.onDialogEvents("evidenceProgress"),
        },
      ],
    });
    ztoolkit.Menu.register("menuFile", {
      tag: "menu",
      id: "zotero-evidence-import-menu",
      label: getString("menu-group-import"),
      icon: `chrome://${config.addonRef}/content/icons/icon.svg`,
      children: [
        {
          tag: "menuitem",
          id: "zotero-evidence-import",
          label: getString("menu-import"),
          commandListener: () => addon.hooks.onDialogEvents("evidenceImport"),
        },
        {
          tag: "menuitem",
          id: "zotero-evidence-import-extract",
          label: getString("menu-import-extract"),
          commandListener: () =>
            addon.hooks.onDialogEvents("evidenceImportExtract"),
        },
      ],
    });
    ztoolkit.Menu.register("menuFile", {
      tag: "menu",
      id: "zotero-evidence-criteria-menu",
      label: getString("menu-group-criteria"),
      icon: `chrome://${config.addonRef}/content/icons/icon.svg`,
      children: [
        {
          tag: "menuitem",
          id: "zotero-evidence-criteria",
          label: getString("menu-criteria"),
          commandListener: () => addon.hooks.onDialogEvents("evidenceCriteria"),
        },
      ],
    });
    ztoolkit.Menu.register("menuFile", {
      tag: "menu",
      id: "zotero-evidence-codebook-menu",
      label: getString("menu-codebook"),
      icon: `chrome://${config.addonRef}/content/icons/icon.svg`,
      children: [
        {
          tag: "menuitem",
          id: "zotero-evidence-codebook-import",
          label: getString("menu-codebook-import"),
          commandListener: () =>
            addon.hooks.onDialogEvents("evidenceCodebookImport"),
        },
        {
          tag: "menuitem",
          id: "zotero-evidence-codebook-add-variable",
          label: getString("menu-codebook-add-variable"),
          commandListener: () =>
            addon.hooks.onDialogEvents("evidenceCodebookAddVariable"),
        },
        {
          tag: "menuitem",
          id: "zotero-evidence-codebook-view",
          label: getString("menu-codebook-view"),
          commandListener: () =>
            addon.hooks.onDialogEvents("evidenceCodebookView"),
        },
        {
          tag: "menuitem",
          id: "zotero-evidence-codebook-edit-variable",
          label: getString("menu-codebook-edit-variable"),
          commandListener: () =>
            addon.hooks.onDialogEvents("evidenceCodebookEditVariable"),
        },
      ],
    });
    ztoolkit.Menu.register("menuFile", {
      tag: "menu",
      id: "zotero-evidence-synthesis-menu",
      label: getString("menu-group-synthesis"),
      icon: `chrome://${config.addonRef}/content/icons/icon.svg`,
      children: [
        {
          tag: "menuitem",
          id: "zotero-evidence-synthesis",
          label: getString("menu-synthesis"),
          commandListener: () =>
            addon.hooks.onDialogEvents("evidenceSynthesis"),
        },
      ],
    });
    ztoolkit.Menu.register("menuFile", {
      tag: "menu",
      id: "zotero-evidence-consistency-menu",
      label: getString("menu-group-consistency"),
      icon: `chrome://${config.addonRef}/content/icons/icon.svg`,
      children: [
        {
          tag: "menuitem",
          id: "zotero-evidence-consistency",
          label: getString("menu-consistency"),
          commandListener: () =>
            addon.hooks.onDialogEvents("evidenceConsistency"),
        },
        {
          tag: "menuitem",
          id: "zotero-evidence-human-consistency",
          label: getString("menu-human-consistency"),
          commandListener: () =>
            addon.hooks.onDialogEvents("evidenceHumanConsistency"),
        },
      ],
    });
    ztoolkit.Menu.register("menuFile", {
      tag: "menu",
      id: "zotero-evidence-export-menu",
      label: getString("menu-group-export"),
      icon: `chrome://${config.addonRef}/content/icons/icon.svg`,
      children: [
        {
          tag: "menuitem",
          id: "zotero-evidence-export-prisma",
          label: getString("menu-export-prisma"),
          commandListener: () =>
            addon.hooks.onDialogEvents("evidenceExportPrisma"),
        },
        {
          tag: "menuitem",
          id: "zotero-evidence-export-screening-log",
          label: getString("menu-export-screening-log"),
          commandListener: () =>
            addon.hooks.onDialogEvents("evidenceExportScreeningLog"),
        },
        {
          tag: "menuitem",
          id: "zotero-evidence-export-coding",
          label: getString("menu-export-coding"),
          commandListener: () =>
            addon.hooks.onDialogEvents("evidenceExportCoding"),
        },
        {
          tag: "menuitem",
          id: "zotero-evidence-export-synthesis",
          label: getString("menu-export-synthesis"),
          commandListener: () =>
            addon.hooks.onDialogEvents("evidenceExportSynthesis"),
        },
      ],
    });
    ztoolkit.Menu.register("menuFile", {
      tag: "menu",
      id: "zotero-evidence-ai-menu",
      label: getString("menu-group-ai"),
      icon: `chrome://${config.addonRef}/content/icons/icon.svg`,
      children: [
        {
          tag: "menuitem",
          id: "zotero-evidence-ai-provider",
          label: getString("menu-ai-provider"),
          commandListener: () =>
            addon.hooks.onDialogEvents("evidenceAIProvider"),
        },
        {
          tag: "menuitem",
          id: "zotero-evidence-ai-usage",
          label: getString("menu-ai-usage"),
          commandListener: () => addon.hooks.onDialogEvents("evidenceAIUsage"),
        },
      ],
    });
  }

  static registerItemMenus() {
    ztoolkit.Menu.register("item", {
      tag: "menuitem",
      id: "zotero-evidence-batch-run-ai",
      label: getString("menu-batch-run-ai"),
      commandListener: () => addon.hooks.onDialogEvents("evidenceBatchRunAI"),
    });
    ztoolkit.Menu.register("item", {
      tag: "menuitem",
      id: "zotero-evidence-batch-confirm-ai",
      label: getString("menu-batch-confirm-ai"),
      commandListener: () =>
        addon.hooks.onDialogEvents("evidenceBatchConfirmAI"),
    });
    ztoolkit.Menu.register("item", {
      tag: "menuitem",
      id: "zotero-evidence-batch-mark-unavailable",
      label: getString("menu-batch-mark-unavailable"),
      commandListener: () =>
        addon.hooks.onDialogEvents("evidenceBatchMarkUnavailable"),
    });
  }

  // ztoolkit.Dialog builds every content row as an XUL <hbox flex="1">
  // (see DialogHelper's constructor in zotero-plugin-toolkit) -- all rows
  // share the window's height EQUALLY, regardless of how much content each
  // one actually needs. That's fine when the window is auto-sized to
  // exactly match total natural content height (ztoolkit's own
  // `fitContent: true` tries this via a delayed `win.sizeToContent()`, but
  // that measurement under-sizes things enough to clip text). Passing an
  // explicit fixed height instead avoids the clipping but makes the
  // equal-share stretch spread short rows out with ugly empty gaps
  // whenever the guessed height is taller than the content needs.
  //
  // Fix: right after open, flatten every row to its natural height
  // (flex="0") and THEN size the window ourselves -- so height is never
  // guessed or clipped, only width is set explicitly.
  private static openSizedDialog(
    dialog: {
      open: (title: string, windowFeatures?: any) => any;
      window?: Window;
    },
    title: string,
    width: number,
  ) {
    dialog.open(title, {
      width,
      left: 60,
      top: 60,
      centerscreen: false,
      resizable: true,
      fitContent: false,
    });
    const win = dialog.window;
    win?.setTimeout(() => {
      const doc = win.document;
      doc.querySelectorAll('vbox > hbox[flex="1"]').forEach((row: Element) => {
        row.setAttribute("flex", "0");
      });
      win.sizeToContent();
      // Some dialogs populate a row's content (e.g. a status line or a
      // rendered list) asynchronously after open, on their own ~50ms
      // delay -- resize once more, later, so the window fits that too
      // instead of sizing to what was still empty a moment earlier.
      win.setTimeout(() => win.sizeToContent(), 250);
    }, 50);
  }

  // ztoolkit's Dialog renders <select> as a popup of menuitems and sets
  // `select.value` directly when one is picked (see zotero-plugin-toolkit's
  // replaceElement()) -- that assignment doesn't reliably dispatch any
  // particular DOM event (the element may never receive real focus, so
  // even the "blur" it calls afterwards can be a no-op). Poll the value
  // instead of depending on an event firing at all.
  private static watchSelectValue(
    dialogData: { [key: string]: any },
    win: Window | null | undefined,
    selectEl: HTMLSelectElement | null | undefined,
    onChange: (value: string) => void | Promise<void>,
  ) {
    if (!selectEl || !win) return;
    let lastValue = selectEl.value;
    const handle = win.setInterval(() => {
      if (selectEl.value === lastValue) return;
      lastValue = selectEl.value;
      void onChange(selectEl.value);
    }, 250);
    dialogData.unloadLock.promise.then(() => win.clearInterval(handle));
  }

  static async newProjectDialog() {
    // Only libraries the user can actually write to are offered -- a
    // read-only Group Library membership couldn't save the Collection tree
    // this creates. Most users only ever have the personal library, so the
    // picker itself is only shown when there's an actual choice to make;
    // one option would just be clutter.
    const writableLibraries = Zotero.Libraries.getAll().filter((lib) =>
      Zotero.Libraries.isEditable(lib.libraryID),
    );
    const showLibraryPicker = writableLibraries.length > 1;

    const dialogData: { [key: string]: any } = {
      projectName: "",
      libraryID: String(Zotero.Libraries.userLibraryID),
    };

    const cols = showLibraryPicker ? 2 : 1;
    const dialog = new ztoolkit.Dialog(showLibraryPicker ? 4 : 3, cols)
      .addCell(0, 0, {
        tag: "h1",
        properties: { innerHTML: getString("dialog-new-project-title") },
      })
      .addCell(1, 0, {
        tag: "label",
        namespace: "html",
        attributes: { for: "evidence-project-name" },
        properties: { innerHTML: getString("dialog-project-name-label") },
      })
      .addCell(
        2,
        0,
        {
          tag: "input",
          namespace: "html",
          id: "evidence-project-name",
          attributes: {
            "data-bind": "projectName",
            "data-prop": "value",
            type: "text",
          },
        },
        false,
      );

    if (showLibraryPicker) {
      dialog
        .addCell(3, 0, {
          tag: "label",
          namespace: "html",
          properties: {
            innerHTML: getString("dialog-new-project-library-label"),
          },
        })
        .addCell(
          3,
          1,
          {
            tag: "select",
            namespace: "html",
            attributes: { "data-bind": "libraryID", "data-prop": "value" },
            children: writableLibraries.map((lib) => ({
              tag: "option",
              namespace: "html",
              properties: {
                value: String(lib.libraryID),
                innerHTML: escapeHtml(lib.name),
              },
            })),
          },
          false,
        );
    }

    dialog
      .addButton(getString("dialog-confirm"), "confirm")
      .addButton(getString("dialog-cancel"), "cancel")
      .setDialogData(dialogData);
    EvidenceCommands.openSizedDialog(
      dialog,
      getString("dialog-new-project-title"),
      showLibraryPicker ? 480 : 460,
    );

    await dialogData.unloadLock.promise;
    if (dialogData._lastButtonId !== "confirm") return;

    const name = String(dialogData.projectName || "").trim();
    if (!name) {
      ztoolkit.getGlobal("alert")(getString("error-project-name-required"));
      return;
    }
    const libraryID =
      Number(dialogData.libraryID) || Zotero.Libraries.userLibraryID;

    const project = await createProject(name, libraryID);
    await refreshProjectPaneContextCache();
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({
        text: getString("progress-project-created", {
          args: { name: project.name },
        }),
        type: "success",
        progress: 100,
      })
      .show();
  }

  static async deleteProjectDialog() {
    const projects = await listProjects();
    if (projects.length === 0) {
      ztoolkit.getGlobal("alert")(getString("error-no-projects"));
      return;
    }

    const dialogData: { [key: string]: any } = {
      projectId: String(projects[0].id),
      confirmName: "",
    };

    const dialog = new ztoolkit.Dialog(5, 2)
      .addCell(0, 0, {
        tag: "h1",
        properties: { innerHTML: getString("dialog-delete-project-title") },
      })
      .addCell(1, 0, {
        tag: "label",
        namespace: "html",
        properties: { innerHTML: getString("dialog-delete-project-label") },
      })
      .addCell(
        1,
        1,
        {
          tag: "select",
          namespace: "html",
          id: "evidence-delete-project-select",
          attributes: { "data-bind": "projectId", "data-prop": "value" },
          children: projects.map((p) => ({
            tag: "option",
            namespace: "html",
            properties: { value: String(p.id), innerHTML: escapeHtml(p.name) },
          })),
        },
        false,
      )
      .addCell(2, 0, {
        tag: "p",
        namespace: "html",
        properties: {
          innerHTML: getString("dialog-delete-project-warning"),
        },
        styles: { color: "var(--fill-secondary, #a33)", fontWeight: "bold" },
      })
      .addCell(3, 0, {
        tag: "label",
        namespace: "html",
        properties: {
          innerHTML: getString("dialog-delete-project-name-display-label"),
        },
      })
      .addCell(
        3,
        1,
        {
          tag: "label",
          namespace: "html",
          id: "evidence-delete-project-name-display",
          properties: { innerHTML: escapeHtml(projects[0].name) },
          styles: { fontWeight: "bold" },
        },
        false,
      )
      .addCell(4, 0, {
        tag: "label",
        namespace: "html",
        attributes: { for: "evidence-delete-project-confirm" },
        properties: {
          innerHTML: getString("dialog-delete-project-confirm-label"),
        },
      })
      .addCell(
        4,
        1,
        {
          tag: "input",
          namespace: "html",
          id: "evidence-delete-project-confirm",
          attributes: {
            "data-bind": "confirmName",
            "data-prop": "value",
            type: "text",
          },
        },
        false,
      )
      .addButton(getString("dialog-delete-project-confirm-button"), "confirm")
      .addButton(getString("dialog-cancel"), "cancel")
      .setDialogData(dialogData);
    EvidenceCommands.openSizedDialog(
      dialog,
      getString("dialog-delete-project-title"),
      520,
    );

    // The name-to-type-to-confirm display must track whichever project is
    // currently selected in the dropdown, not just the initial default --
    // see watchSelectValue's own comment for why polling is needed instead
    // of a change-event listener. Same delay as every other dialog that
    // wires up watchSelectValue (criteriaDialog, codebookViewDialog, ...):
    // dialog.window/its DOM aren't necessarily ready the instant
    // openSizedDialog() returns, so grabbing the <select> immediately can
    // silently find nothing and watchSelectValue no-ops.
    await Zotero.Promise.delay(50);
    const projectSelectEl = dialog.window?.document.getElementById(
      "evidence-delete-project-select",
    ) as HTMLSelectElement | null;
    EvidenceCommands.watchSelectValue(
      dialogData,
      dialog.window,
      projectSelectEl,
      (value) => {
        const project = projects.find((p) => p.id === Number(value));
        const displayEl = dialog.window?.document.getElementById(
          "evidence-delete-project-name-display",
        );
        if (displayEl && project) displayEl.textContent = project.name;
      },
    );

    await dialogData.unloadLock.promise;
    if (dialogData._lastButtonId !== "confirm") return;

    const projectId = Number(dialogData.projectId);
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;

    const typedName = String(dialogData.confirmName || "").trim();
    if (typedName !== project.name) {
      ztoolkit.getGlobal("alert")(
        getString("error-delete-project-name-mismatch"),
      );
      return;
    }

    await deleteProject(project.id);
    await refreshProjectPaneContextCache();
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({
        text: getString("progress-project-deleted", {
          args: { name: project.name },
        }),
        type: "success",
        progress: 100,
      })
      .show();
  }

  static async archiveProjectDialog() {
    const projects = await listProjects();
    if (projects.length === 0) {
      ztoolkit.getGlobal("alert")(getString("error-no-projects"));
      return;
    }

    const dialogData: { [key: string]: any } = {
      projectId: String(projects[0].id),
    };
    const dialog = new ztoolkit.Dialog(2, 2)
      .addCell(0, 0, {
        tag: "h1",
        properties: { innerHTML: getString("dialog-archive-project-title") },
      })
      .addCell(1, 0, {
        tag: "label",
        namespace: "html",
        properties: { innerHTML: getString("dialog-archive-project-label") },
      })
      .addCell(
        1,
        1,
        {
          tag: "select",
          namespace: "html",
          id: "evidence-archive-project-select",
          attributes: { "data-bind": "projectId", "data-prop": "value" },
          children: projects.map((p) => ({
            tag: "option",
            namespace: "html",
            properties: { value: String(p.id), innerHTML: escapeHtml(p.name) },
          })),
        },
        false,
      )
      .addButton(getString("dialog-confirm"), "confirm")
      .addButton(getString("dialog-cancel"), "cancel")
      .setDialogData(dialogData);
    EvidenceCommands.openSizedDialog(
      dialog,
      getString("dialog-archive-project-title"),
      480,
    );

    await dialogData.unloadLock.promise;
    if (dialogData._lastButtonId !== "confirm") return;

    const projectId = Number(dialogData.projectId);
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;

    const outputPath = await new ztoolkit.FilePicker(
      getString("dialog-archive-project-title"),
      "save",
      [["Zip Archive (*.zip)", "*.zip"]],
      `${project.name}.zip`,
    ).open();
    if (!outputPath || typeof outputPath !== "string") return;

    const progressWindow = new ztoolkit.ProgressWindow(
      addon.data.config.addonName,
    )
      .createLine({
        text: getString("progress-archive-project-running", {
          args: { name: project.name },
        }),
        type: "default",
        progress: 0,
      })
      .show();
    try {
      await exportProjectArchive(project.id, outputPath);
      progressWindow.changeLine({
        text: getString("progress-archive-project-done", {
          args: { name: project.name },
        }),
        type: "success",
        progress: 100,
      });
      progressWindow.startCloseTimer(5000);
    } catch (e) {
      progressWindow.changeLine({
        text: getString("error-archive-project-failed"),
        type: "error",
        progress: 100,
      });
      progressWindow.startCloseTimer(8000);
      throw e;
    }
  }

  static async restoreArchiveDialog() {
    // Same reasoning as newProjectDialog: an archive carries no library of
    // its own (you might restore it into a different library than it was
    // archived from), so the picker offers every *writable* library, and
    // only appears at all when there's an actual choice to make.
    const writableLibraries = Zotero.Libraries.getAll().filter((lib) =>
      Zotero.Libraries.isEditable(lib.libraryID),
    );
    const showLibraryPicker = writableLibraries.length > 1;

    const dialogData: { [key: string]: any } = {
      filePath: "",
      libraryID: String(Zotero.Libraries.userLibraryID),
    };

    const fileLabelRow = showLibraryPicker ? 2 : 1;
    const fileButtonRow = showLibraryPicker ? 3 : 2;

    const dialog = new ztoolkit.Dialog(showLibraryPicker ? 4 : 3, 2).addCell(
      0,
      0,
      {
        tag: "h1",
        properties: { innerHTML: getString("dialog-restore-archive-title") },
      },
    );

    if (showLibraryPicker) {
      dialog
        .addCell(1, 0, {
          tag: "label",
          namespace: "html",
          properties: {
            innerHTML: getString("dialog-new-project-library-label"),
          },
        })
        .addCell(
          1,
          1,
          {
            tag: "select",
            namespace: "html",
            attributes: { "data-bind": "libraryID", "data-prop": "value" },
            children: writableLibraries.map((lib) => ({
              tag: "option",
              namespace: "html",
              properties: {
                value: String(lib.libraryID),
                innerHTML: escapeHtml(lib.name),
              },
            })),
          },
          false,
        );
    }

    dialog
      .addCell(fileLabelRow, 0, {
        tag: "label",
        namespace: "html",
        properties: {
          innerHTML: getString("dialog-restore-archive-file-label"),
        },
      })
      .addCell(
        fileLabelRow,
        1,
        {
          tag: "label",
          namespace: "html",
          id: "evidence-restore-archive-file-display",
          properties: {
            innerHTML: getString("dialog-import-file-none"),
          },
        },
        false,
      )
      .addCell(
        fileButtonRow,
        1,
        {
          tag: "button",
          namespace: "html",
          attributes: { type: "button" },
          properties: { innerHTML: getString("dialog-import-file-button") },
          listeners: [
            {
              type: "click",
              listener: async () => {
                const path = await new ztoolkit.FilePicker(
                  getString("dialog-import-file-button"),
                  "open",
                  [["Zip Archive (*.zip)", "*.zip"]],
                ).open();
                if (path && typeof path === "string") {
                  dialogData.filePath = path;
                  const displayEl = dialog.window?.document.getElementById(
                    "evidence-restore-archive-file-display",
                  );
                  if (displayEl) displayEl.textContent = path;
                }
              },
            },
          ],
        },
        false,
      )
      .addButton(getString("dialog-restore-archive-confirm-button"), "confirm")
      .addButton(getString("dialog-cancel"), "cancel")
      .setDialogData(dialogData);
    EvidenceCommands.openSizedDialog(
      dialog,
      getString("dialog-restore-archive-title"),
      520,
    );

    await dialogData.unloadLock.promise;
    if (dialogData._lastButtonId !== "confirm") return;
    if (!dialogData.filePath) {
      ztoolkit.getGlobal("alert")(getString("error-no-file-selected"));
      return;
    }
    const libraryID =
      Number(dialogData.libraryID) || Zotero.Libraries.userLibraryID;

    const progressWindow = new ztoolkit.ProgressWindow(
      addon.data.config.addonName,
    )
      .createLine({
        text: getString("progress-restore-archive-running"),
        type: "default",
        progress: 0,
      })
      .show();
    try {
      const project = await importProjectArchive(
        String(dialogData.filePath),
        libraryID,
      );
      progressWindow.changeLine({
        text: getString("progress-restore-archive-done", {
          args: { name: project.name },
        }),
        type: "success",
        progress: 100,
      });
      progressWindow.startCloseTimer(5000);
    } catch (e) {
      progressWindow.changeLine({
        text: getString("error-restore-archive-failed"),
        type: "error",
        progress: 100,
      });
      progressWindow.startCloseTimer(8000);
      throw e;
    }
  }

  static async importDialog() {
    const projects = await listProjects();
    if (projects.length === 0) {
      ztoolkit.getGlobal("alert")(getString("error-no-projects"));
      return;
    }

    // The Sources sub-collection this feeds (ensureSourceCollection,
    // collectionStructure.ts) and item_sources.source_database (plain TEXT,
    // no CHECK constraint) both already accept any string -- SOURCE_DATABASE_
    // LABELS was only ever a UI convenience for the three most common
    // databases, not an actual limit on what Zotero's own translators can
    // import. A free-text field plus a "presets" picker keeps that one-click
    // convenience (including whatever custom labels this project has
    // already used, so repeat imports reuse the same string instead of
    // drifting) while allowing any source name.
    //
    // Empirically confirmed: a plain HTML <input list="..."> + <datalist> --
    // the normal way to do this on the web -- doesn't show its suggestion
    // popup inside Zotero's XUL dialog window, presumably because that
    // relies on browser-chrome autocomplete UI this embedded HTML content
    // doesn't get. A second, ordinary <select> that copies its chosen value
    // into the text input avoids that entirely: both pieces (bound text
    // input, watched select) are patterns already proven to work in this
    // exact dialog framework elsewhere in this file.
    const sourceLabelOptions = (projectId: number): string[] => {
      const labels = new Set<string>(SOURCE_DATABASE_LABELS);
      const project = projects.find((p) => p.id === projectId);
      const rootId = project ? getRootCollectionId(project) : null;
      if (rootId !== null) {
        try {
          const collections = resolveProjectCollections(rootId!);
          for (const label of Object.keys(collections.sourceCollectionIds)) {
            labels.add(label);
          }
        } catch {
          // Structure incomplete -- fall back to just the built-in presets.
        }
      }
      return Array.from(labels);
    };

    const refreshSourcePresetSelect = (doc: Document, projectId: number) => {
      const select = doc.getElementById(
        "evidence-import-source-preset",
      ) as HTMLSelectElement | null;
      if (!select) return;
      select.innerHTML = "";
      const placeholder = doc.createElement("option");
      placeholder.setAttribute("value", "");
      placeholder.textContent = getString(
        "dialog-import-source-preset-placeholder",
      );
      select.appendChild(placeholder);
      for (const label of sourceLabelOptions(projectId)) {
        const option = doc.createElement("option");
        option.setAttribute("value", label);
        option.textContent = label;
        select.appendChild(option);
      }
      select.value = "";
    };

    const dialogData: { [key: string]: any } = {
      projectId: String(projects[0].id),
      sourceLabel: SOURCE_DATABASE_LABELS[0] as string,
      filePath: "",
    };

    const dialog = new ztoolkit.Dialog(7, 2)
      .addCell(0, 0, {
        tag: "h1",
        properties: { innerHTML: getString("dialog-import-title") },
      })
      .addCell(1, 0, {
        tag: "label",
        namespace: "html",
        properties: { innerHTML: getString("dialog-import-project-label") },
      })
      .addCell(
        1,
        1,
        {
          tag: "select",
          namespace: "html",
          id: "evidence-import-project",
          attributes: { "data-bind": "projectId", "data-prop": "value" },
          children: projects.map((p) => ({
            tag: "option",
            namespace: "html",
            properties: { value: String(p.id), innerHTML: escapeHtml(p.name) },
          })),
        },
        false,
      )
      .addCell(2, 0, {
        tag: "label",
        namespace: "html",
        properties: { innerHTML: getString("dialog-import-source-label") },
      })
      .addCell(
        2,
        1,
        {
          tag: "div",
          namespace: "html",
          styles: { display: "flex", gap: "4px", alignItems: "center" },
          children: [
            {
              tag: "input",
              namespace: "html",
              id: "evidence-import-source",
              attributes: {
                type: "text",
                "data-bind": "sourceLabel",
                "data-prop": "value",
              },
              styles: { flex: "1 1 auto", minWidth: "0" },
            },
            {
              tag: "select",
              namespace: "html",
              id: "evidence-import-source-preset",
              styles: { flex: "0 0 auto" },
              children: [
                {
                  tag: "option",
                  namespace: "html",
                  properties: {
                    value: "",
                    innerHTML: getString(
                      "dialog-import-source-preset-placeholder",
                    ),
                  },
                },
                ...sourceLabelOptions(projects[0].id).map((label) => ({
                  tag: "option",
                  namespace: "html",
                  properties: { value: label, innerHTML: escapeHtml(label) },
                })),
              ],
            },
          ],
        },
        false,
      )
      .addCell(3, 0, {
        tag: "label",
        namespace: "html",
        properties: { innerHTML: getString("dialog-import-file-label") },
      })
      .addCell(
        3,
        1,
        {
          tag: "label",
          namespace: "html",
          id: "evidence-import-file-display",
          properties: { innerHTML: getString("dialog-import-file-none") },
        },
        false,
      )
      .addCell(
        4,
        1,
        {
          tag: "button",
          namespace: "html",
          attributes: { type: "button" },
          properties: { innerHTML: getString("dialog-import-file-button") },
          listeners: [
            {
              type: "click",
              listener: async () => {
                const path = await new ztoolkit.FilePicker(
                  getString("dialog-import-file-button"),
                  "open",
                  [
                    [
                      "RIS/BibTeX/MEDLINE/XML (*.ris;*.bib;*.txt;*.xml;*.nbib)",
                      "*.ris;*.bib;*.txt;*.xml;*.nbib",
                    ],
                    ["Any", "*.*"],
                  ],
                ).open();
                if (path && typeof path === "string") {
                  dialogData.filePath = path;
                  const displayEl = dialog.window?.document.getElementById(
                    "evidence-import-file-display",
                  );
                  if (displayEl) displayEl.textContent = path;
                }
              },
            },
          ],
        },
        false,
      )
      .addCell(5, 0, {
        tag: "p",
        namespace: "html",
        properties: {
          innerHTML: getString("dialog-import-wait-note"),
        },
        styles: { color: "var(--fill-secondary, #666)", fontSize: "0.9em" },
      })
      .addCell(6, 0, {
        tag: "p",
        namespace: "html",
        id: "evidence-import-status",
        properties: { innerHTML: "" },
        styles: { fontWeight: "bold" },
      })
      .addButton(getString("dialog-confirm"), "confirm", {
        // Importing can take a while for large files -- rather than close
        // immediately (the previous behavior: the window vanished the
        // instant you clicked Confirm, with only a toast notification once
        // it was already done, which is exactly what looked like a freeze),
        // keep the dialog open, show live status in it, and only close it
        // once the import has actually finished.
        noClose: true,
        callback: async () => {
          const doc = dialog.window?.document;
          const statusEl = doc?.getElementById("evidence-import-status");
          const confirmBtn = doc?.getElementById(
            "confirm",
          ) as HTMLButtonElement | null;
          const cancelBtn = doc?.getElementById(
            "cancel",
          ) as HTMLButtonElement | null;

          if (!dialogData.filePath) {
            if (statusEl) {
              statusEl.textContent = getString("error-no-file-selected");
            }
            return;
          }
          const sourceLabel = String(dialogData.sourceLabel || "").trim();
          if (!sourceLabel) {
            if (statusEl) {
              statusEl.textContent = getString("error-import-source-required");
            }
            return;
          }

          const projectId = Number(dialogData.projectId);
          const project = projects.find((p) => p.id === projectId);
          if (!project) return;

          const rootCollection = Zotero.Collections.getByLibraryAndKey(
            project.libraryID,
            project.collectionKey,
          );
          if (!rootCollection) {
            if (statusEl) {
              statusEl.textContent = getString("error-import-failed");
            }
            return;
          }

          if (confirmBtn) confirmBtn.disabled = true;
          if (cancelBtn) cancelBtn.disabled = true;
          if (statusEl) {
            statusEl.textContent = getString("dialog-import-status-running");
          }

          try {
            const result = await importLiteratureFile(
              project.id,
              (rootCollection as Zotero.Collection).id,
              sourceLabel,
              dialogData.filePath as string,
            );
            dialog.window?.close();
            new ztoolkit.ProgressWindow(addon.data.config.addonName)
              .createLine({
                text: getString("progress-import-result", {
                  args: {
                    total: result.totalParsed,
                    added: result.newCount,
                    duplicates: result.duplicateCount,
                  },
                }),
                type: "success",
                progress: 100,
              })
              .show();
          } catch (e: any) {
            ztoolkit.log("Import failed", e);
            if (statusEl) {
              statusEl.textContent = `${getString("error-import-failed")} ${e?.message ?? e}`;
            }
            if (confirmBtn) confirmBtn.disabled = false;
            if (cancelBtn) cancelBtn.disabled = false;
          }
        },
      })
      .addButton(getString("dialog-cancel"), "cancel")
      .setDialogData(dialogData);
    EvidenceCommands.openSizedDialog(
      dialog,
      getString("dialog-import-title"),
      560,
    );

    // Switching the project should offer THAT project's already-used
    // source labels (plus the built-in presets), not leave the previous
    // project's custom labels sitting in the presets list as if they
    // applied here too. Same delay as every other dialog that wires up
    // watchSelectValue -- see its own comment for why.
    await Zotero.Promise.delay(50);
    const projectSelectEl = dialog.window?.document.getElementById(
      "evidence-import-project",
    ) as HTMLSelectElement | undefined;
    EvidenceCommands.watchSelectValue(
      dialogData,
      dialog.window,
      projectSelectEl,
      (value) => {
        if (dialog.window) {
          refreshSourcePresetSelect(dialog.window.document, Number(value));
        }
      },
    );

    // Picking a preset just fills the free-text field with it -- the field
    // itself (not this select) is what's bound to dialogData.sourceLabel,
    // so it stays editable afterward.
    const presetSelectEl = dialog.window?.document.getElementById(
      "evidence-import-source-preset",
    ) as HTMLSelectElement | undefined;
    EvidenceCommands.watchSelectValue(
      dialogData,
      dialog.window,
      presetSelectEl,
      (value) => {
        if (!value) return;
        dialogData.sourceLabel = value;
        const sourceInputEl = dialog.window?.document.getElementById(
          "evidence-import-source",
        ) as HTMLInputElement | undefined;
        if (sourceInputEl) sourceInputEl.value = value;
        // Reset to the placeholder so the same preset can be picked again
        // later (e.g. after the user has typed something else in between)
        // -- a <select> that already shows "Web of Science" wouldn't fire
        // another change event if you picked "Web of Science" again.
        if (presetSelectEl) presetSelectEl.value = "";
      },
    );
  }

  static async importExtractDialog() {
    const projects = await listProjects();
    if (projects.length === 0) {
      ztoolkit.getGlobal("alert")(getString("error-no-projects"));
      return;
    }

    const dialogData: { [key: string]: any } = {
      projectId: String(projects[0].id),
      filePath: "",
    };

    const dialog = new ztoolkit.Dialog(4, 2)
      .addCell(0, 0, {
        tag: "h1",
        properties: { innerHTML: getString("dialog-import-extract-title") },
      })
      .addCell(1, 0, {
        tag: "label",
        namespace: "html",
        properties: { innerHTML: getString("dialog-import-project-label") },
      })
      .addCell(
        1,
        1,
        {
          tag: "select",
          namespace: "html",
          attributes: { "data-bind": "projectId", "data-prop": "value" },
          children: projects.map((p) => ({
            tag: "option",
            namespace: "html",
            properties: { value: String(p.id), innerHTML: escapeHtml(p.name) },
          })),
        },
        false,
      )
      .addCell(2, 0, {
        tag: "label",
        namespace: "html",
        properties: { innerHTML: getString("dialog-import-file-label") },
      })
      .addCell(
        2,
        1,
        {
          tag: "label",
          namespace: "html",
          id: "evidence-import-extract-file-display",
          properties: { innerHTML: getString("dialog-import-file-none") },
        },
        false,
      )
      .addCell(
        3,
        1,
        {
          tag: "button",
          namespace: "html",
          attributes: { type: "button" },
          properties: { innerHTML: getString("dialog-import-file-button") },
          listeners: [
            {
              type: "click",
              listener: async () => {
                const path = await new ztoolkit.FilePicker(
                  getString("dialog-import-file-button"),
                  "open",
                  [
                    [
                      "RIS/BibTeX/MEDLINE/XML (*.ris;*.bib;*.txt;*.xml;*.nbib)",
                      "*.ris;*.bib;*.txt;*.xml;*.nbib",
                    ],
                    ["Any", "*.*"],
                  ],
                ).open();
                if (path && typeof path === "string") {
                  dialogData.filePath = path;
                  const displayEl = dialog.window?.document.getElementById(
                    "evidence-import-extract-file-display",
                  );
                  if (displayEl) displayEl.textContent = path;
                }
              },
            },
          ],
        },
        false,
      )
      .addButton(getString("dialog-confirm"), "confirm")
      .addButton(getString("dialog-cancel"), "cancel")
      .setDialogData(dialogData);
    EvidenceCommands.openSizedDialog(
      dialog,
      getString("dialog-import-extract-title"),
      560,
    );

    await dialogData.unloadLock.promise;
    if (dialogData._lastButtonId !== "confirm") return;
    if (!dialogData.filePath) {
      ztoolkit.getGlobal("alert")(getString("error-no-file-selected"));
      return;
    }

    const projectId = Number(dialogData.projectId);
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;

    const rootCollection = Zotero.Collections.getByLibraryAndKey(
      project.libraryID,
      project.collectionKey,
    );
    if (!rootCollection) {
      ztoolkit.getGlobal("alert")(getString("error-import-failed"));
      return;
    }

    try {
      const count = await importDirectToCoding(
        (rootCollection as Zotero.Collection).id,
        dialogData.filePath as string,
      );
      new ztoolkit.ProgressWindow(addon.data.config.addonName)
        .createLine({
          text: getString("progress-import-extract-result", {
            args: { count },
          }),
          type: "success",
          progress: 100,
        })
        .show();
    } catch (e: any) {
      ztoolkit.log("Import Extract Literature failed", e);
      ztoolkit.getGlobal("alert")(
        `${getString("error-import-failed")}\n${e?.message ?? e}`,
      );
    }
  }

  // One shared set of eligibility criteria per project now, not separate
  // TA/FT ones -- standard Cochrane/PRISMA practice: the same criteria are
  // screened liberally at title/abstract (limited information, so only
  // exclude on a clear mismatch) and strictly at full-text (complete
  // information, so apply the criteria directly and record why). Storage
  // still keeps a 'ta' and an 'ft' screening_criteria row per project
  // (unchanged schema, and each screening service still reads its own
  // stage) -- this dialog just always writes the same content to both, so
  // every other reader of getLatestCriteria(projectId, stage) keeps
  // working unmodified.
  static async criteriaDialog() {
    const titleKey = "dialog-criteria-title";
    const projects = await listProjects();
    if (projects.length === 0) {
      ztoolkit.getGlobal("alert")(getString("error-no-projects"));
      return;
    }

    // Reflect whatever's already saved back into the form -- previously
    // this dialog always opened blank, silently discarding the existing
    // criteria the moment you hit Save again. 'ta' is read as the
    // canonical copy to display; if a project still has divergent TA/FT
    // criteria from before this dialog unified them, saving here
    // overwrites both with this (the TA) content.
    const criteriaFields = (criteria: ScreeningCriteria | null) => ({
      researchQuestion: criteria?.researchQuestion ?? "",
      inclusionCriteria: (criteria?.inclusionCriteria ?? []).join("\n"),
      exclusionCriteria: (criteria?.exclusionCriteria ?? []).join("\n"),
    });

    const initial = await getLatestCriteria(projects[0].id, "ta");
    const dialogData: { [key: string]: any } = {
      projectId: String(projects[0].id),
      ...criteriaFields(initial?.criteria ?? null),
    };

    const dialog = new ztoolkit.Dialog(5, 2)
      .addCell(0, 0, {
        tag: "h1",
        properties: { innerHTML: getString(titleKey) },
      })
      .addCell(1, 0, {
        tag: "label",
        namespace: "html",
        properties: { innerHTML: getString("dialog-import-project-label") },
      })
      .addCell(
        1,
        1,
        {
          tag: "select",
          namespace: "html",
          id: "evidence-criteria-project",
          attributes: { "data-bind": "projectId", "data-prop": "value" },
          children: projects.map((p) => ({
            tag: "option",
            namespace: "html",
            properties: { value: String(p.id), innerHTML: escapeHtml(p.name) },
          })),
        },
        false,
      )
      .addCell(2, 0, {
        tag: "label",
        namespace: "html",
        properties: {
          innerHTML: getString("dialog-criteria-question-label"),
        },
      })
      .addCell(
        2,
        1,
        {
          tag: "textarea",
          namespace: "html",
          attributes: {
            "data-bind": "researchQuestion",
            "data-prop": "value",
            rows: "3",
            cols: "40",
          },
        },
        false,
      )
      .addCell(3, 0, {
        tag: "label",
        namespace: "html",
        properties: {
          innerHTML: getString("dialog-criteria-inclusion-label"),
        },
      })
      .addCell(
        3,
        1,
        {
          tag: "textarea",
          namespace: "html",
          attributes: {
            "data-bind": "inclusionCriteria",
            "data-prop": "value",
            rows: "4",
            cols: "40",
          },
        },
        false,
      )
      .addCell(4, 0, {
        tag: "label",
        namespace: "html",
        properties: {
          innerHTML: getString("dialog-criteria-exclusion-label"),
        },
      })
      .addCell(
        4,
        1,
        {
          tag: "textarea",
          namespace: "html",
          attributes: {
            "data-bind": "exclusionCriteria",
            "data-prop": "value",
            rows: "4",
            cols: "40",
          },
        },
        false,
      )
      .addButton(getString("dialog-confirm"), "confirm")
      .addButton(getString("dialog-cancel"), "cancel")
      .setDialogData(dialogData);
    EvidenceCommands.openSizedDialog(dialog, getString(titleKey), 640);

    // Switching the project should re-reflect THAT project's saved
    // criteria, not leave the previous project's text sitting in the form
    // as if it belonged to the new one.
    await Zotero.Promise.delay(50);
    const selectEl = dialog.window?.document.getElementById(
      "evidence-criteria-project",
    ) as HTMLSelectElement | undefined;
    EvidenceCommands.watchSelectValue(
      dialogData,
      dialog.window,
      selectEl,
      async (value) => {
        const doc = selectEl!.ownerDocument;
        if (!doc) return;
        const latest = await getLatestCriteria(Number(value), "ta");
        const fields = criteriaFields(latest?.criteria ?? null);
        for (const [key, fieldValue] of Object.entries(fields)) {
          const field = doc.querySelector(`[data-bind="${key}"]`) as
            | HTMLInputElement
            | HTMLTextAreaElement
            | null;
          if (field) field.value = fieldValue;
        }
      },
    );

    await dialogData.unloadLock.promise;
    if (dialogData._lastButtonId !== "confirm") return;

    const toLines = (s: string) =>
      String(s || "")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

    const criteria = {
      researchQuestion: String(dialogData.researchQuestion || "").trim(),
      inclusionCriteria: toLines(dialogData.inclusionCriteria),
      exclusionCriteria: toLines(dialogData.exclusionCriteria),
    };
    const projectId = Number(dialogData.projectId);
    // Same criteria for both stages -- see this method's doc comment.
    await saveCriteria(projectId, "ta", criteria);
    await saveCriteria(projectId, "ft", criteria);

    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({
        text: getString("progress-criteria-saved"),
        type: "success",
        progress: 100,
      })
      .show();
  }

  static async aiProviderDialog() {
    const existing = getActiveProvider();
    const dialogData: { [key: string]: any } = {
      name: existing?.name ?? "Default Provider",
      baseURL:
        existing?.baseURL ?? "https://api.openai.com/v1/chat/completions",
      apiKey: existing?.apiKey ?? "",
      model: existing?.model ?? "gpt-4o-mini",
    };

    const dialog = new ztoolkit.Dialog(5, 2)
      .addCell(0, 0, {
        tag: "h1",
        properties: { innerHTML: getString("dialog-ai-provider-title") },
      })
      .addCell(1, 0, {
        tag: "label",
        namespace: "html",
        properties: { innerHTML: getString("dialog-ai-provider-name-label") },
      })
      .addCell(
        1,
        1,
        {
          tag: "input",
          namespace: "html",
          attributes: {
            "data-bind": "name",
            "data-prop": "value",
            type: "text",
          },
        },
        false,
      )
      .addCell(2, 0, {
        tag: "label",
        namespace: "html",
        properties: {
          innerHTML: getString("dialog-ai-provider-baseurl-label"),
        },
      })
      .addCell(
        2,
        1,
        {
          tag: "input",
          namespace: "html",
          attributes: {
            "data-bind": "baseURL",
            "data-prop": "value",
            type: "text",
          },
        },
        false,
      )
      .addCell(3, 0, {
        tag: "label",
        namespace: "html",
        properties: { innerHTML: getString("dialog-ai-provider-model-label") },
      })
      .addCell(
        3,
        1,
        {
          tag: "input",
          namespace: "html",
          attributes: {
            "data-bind": "model",
            "data-prop": "value",
            type: "text",
          },
        },
        false,
      )
      .addCell(4, 0, {
        tag: "label",
        namespace: "html",
        properties: {
          innerHTML: getString("dialog-ai-provider-apikey-label"),
        },
      })
      .addCell(
        4,
        1,
        {
          tag: "input",
          namespace: "html",
          attributes: {
            "data-bind": "apiKey",
            "data-prop": "value",
            type: "password",
          },
        },
        false,
      )
      .addButton(getString("dialog-confirm"), "confirm")
      .addButton(getString("dialog-cancel"), "cancel")
      .setDialogData(dialogData);
    EvidenceCommands.openSizedDialog(
      dialog,
      getString("dialog-ai-provider-title"),
      600,
    );

    await dialogData.unloadLock.promise;
    if (dialogData._lastButtonId !== "confirm") return;

    upsertProvider({
      id: "default",
      name: String(dialogData.name || "Default Provider"),
      baseURL: String(dialogData.baseURL || ""),
      apiKey: String(dialogData.apiKey || ""),
      model: String(dialogData.model || ""),
    });
    setActiveProviderId("default");

    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({
        text: getString("progress-ai-provider-saved"),
        type: "success",
        progress: 100,
      })
      .show();
  }

  static async aiUsageDialog() {
    const stats = await getAIUsageStats();

    const purposeLabel = (purpose: string): string => {
      switch (purpose) {
        case "ta_screening":
          return getString("ai-usage-purpose-ta-screening");
        case "ft_screening":
          return getString("ai-usage-purpose-ft-screening");
        case "coding":
          return getString("ai-usage-purpose-coding");
        case "synthesis":
          return getString("ai-usage-purpose-synthesis");
        default:
          return purpose;
      }
    };

    const rows = [
      ...stats.byPurpose.map((r) => ({ ...r, label: purposeLabel(r.purpose) })),
      { ...stats.total, label: getString("ai-usage-purpose-total") },
    ];

    const columns = 5;
    const dialog = new ztoolkit.Dialog(rows.length + 2, columns).addCell(0, 0, {
      tag: "h1",
      properties: { innerHTML: getString("dialog-ai-usage-title") },
    });
    const headers = [
      getString("dialog-ai-usage-col-purpose"),
      getString("dialog-ai-usage-col-calls"),
      getString("dialog-ai-usage-col-prompt-tokens"),
      getString("dialog-ai-usage-col-completion-tokens"),
      getString("dialog-ai-usage-col-total-tokens"),
    ];
    headers.forEach((h, col) =>
      dialog.addCell(1, col, {
        tag: "strong",
        namespace: "html",
        properties: { innerHTML: h },
      }),
    );
    rows.forEach((r, i) => {
      const row = i + 2;
      const values = [
        r.label,
        r.calls,
        r.promptTokens,
        r.completionTokens,
        r.totalTokens,
      ];
      values.forEach((v, col) =>
        dialog.addCell(row, col, {
          tag: r.purpose === "total" ? "strong" : "span",
          namespace: "html",
          properties: { innerHTML: escapeHtml(String(v)) },
        }),
      );
    });
    dialog.addButton(getString("dialog-close"), "close");
    EvidenceCommands.openSizedDialog(
      dialog,
      getString("dialog-ai-usage-title"),
      620,
    );
  }

  static async progressDialog() {
    const projects = await listProjects();
    if (projects.length === 0) {
      ztoolkit.getGlobal("alert")(getString("error-no-projects"));
      return;
    }

    const countItems = (collectionId: number) =>
      (
        Zotero.Collections.get(collectionId) as Zotero.Collection
      ).getChildItems().length;

    const rows = (
      await Promise.all(
        projects.map(async (p) => {
          const rootId = getRootCollectionId(p);
          if (rootId === null) return null;
          const collections = resolveProjectCollections(rootId);
          // computePrismaData/computeCodingStats each re-resolve the
          // project's own collections (they're written as standalone,
          // project-id-only entry points for the export/dialog call sites
          // that only have an id) -- a little redundant with the
          // resolveProjectCollections call just above, but cheap and keeps
          // this dialog from having to know their internals.
          const [prisma, coding] = await Promise.all([
            computePrismaData(p.id),
            computeCodingStats(p.id),
          ]);
          return {
            name: p.name,
            pending: countItems(collections.screenQueueId),
            include: prisma.screening.includedToFt,
            exclude: prisma.screening.excluded,
            unclear: prisma.screening.unclearToFt,
            ftInclude: prisma.included.finalStudies,
            ftExclude: prisma.eligibility.excluded,
            ftUnavailable: prisma.eligibility.unavailable,
            codingConfirmed: coding.itemsWithConfirmedEvidence,
            codingTotal: coding.totalInCoding,
          };
        }),
      )
    ).filter((r): r is NonNullable<typeof r> => r !== null);

    const columns = 10;
    const dialog = new ztoolkit.Dialog(rows.length + 2, columns).addCell(0, 0, {
      tag: "h1",
      properties: { innerHTML: getString("dialog-progress-title") },
    });
    const headers = [
      getString("dialog-progress-col-project"),
      getString("dialog-progress-col-pending"),
      getString("dialog-progress-col-include"),
      getString("dialog-progress-col-exclude"),
      getString("dialog-progress-col-unclear"),
      getString("dialog-progress-col-ft-include"),
      getString("dialog-progress-col-ft-exclude"),
      getString("dialog-progress-col-ft-unavailable"),
      getString("dialog-progress-col-coding-confirmed"),
      getString("dialog-progress-col-coding-total"),
    ];
    headers.forEach((h, col) =>
      dialog.addCell(1, col, {
        tag: "strong",
        namespace: "html",
        properties: { innerHTML: h },
      }),
    );
    rows.forEach((r, i) => {
      const row = i + 2;
      const values = [
        r.name,
        r.pending,
        r.include,
        r.exclude,
        r.unclear,
        r.ftInclude,
        r.ftExclude,
        r.ftUnavailable,
        r.codingConfirmed,
        r.codingTotal,
      ];
      values.forEach((v, col) =>
        dialog.addCell(row, col, {
          tag: "span",
          namespace: "html",
          properties: { innerHTML: escapeHtml(String(v)) },
        }),
      );
    });
    dialog.addButton(getString("dialog-close"), "close");
    // 10 columns of headers/numbers need real width, not the ~300px a
    // dialog gets by default; height auto-fits the row count.
    EvidenceCommands.openSizedDialog(
      dialog,
      getString("dialog-progress-title"),
      1080,
    );
  }

  private static async resolveScreenQueueBatchContext() {
    const ZoteroPaneGlobal = ztoolkit.getGlobal("ZoteroPane");
    const collectionId = ZoteroPaneGlobal.getSelectedCollection(true);
    const ctx = await findProjectPaneContext(collectionId ?? null);
    if (!ctx || ctx.role !== "screen_queue") {
      ztoolkit.getGlobal("alert")(getString("error-not-screen-queue"));
      return null;
    }
    const items = (ZoteroPaneGlobal.getSelectedItems() as Zotero.Item[]).filter(
      (i) => i.isRegularItem(),
    );
    if (items.length === 0) return null;
    return { ctx, items };
  }

  static async batchRunAI() {
    const resolved = await EvidenceCommands.resolveScreenQueueBatchContext();
    if (!resolved) return;
    const { ctx, items } = resolved;

    const concurrency = Number(getPref("aiConcurrency")) || 3;
    let done = 0;
    let failed = 0;
    const progressWin = new ztoolkit.ProgressWindow(
      addon.data.config.addonName,
      { closeOnClick: false, closeTime: -1 },
    )
      .createLine({
        text: getString("progress-batch-running", {
          args: { done: 0, total: items.length },
        }),
        type: "default",
        progress: 0,
      })
      .show();

    await runWithConcurrency(items, concurrency, async (item) => {
      try {
        await runAIJudgment(ctx.project.id, item);
      } catch (e: any) {
        failed++;
        ztoolkit.log("Batch AI judgment failed", item.key, e);
      }
      done++;
      progressWin.changeLine({
        progress: Math.round((done / items.length) * 100),
        text: getString("progress-batch-running", {
          args: { done, total: items.length },
        }),
      });
    });

    progressWin.changeLine({
      progress: 100,
      text: getString("progress-batch-done", {
        args: { done, total: items.length, failed },
      }),
      type: failed > 0 ? "error" : "success",
    });
    progressWin.startCloseTimer(5000);
  }

  static async batchConfirmAI() {
    const resolved = await EvidenceCommands.resolveScreenQueueBatchContext();
    if (!resolved) return;
    const { ctx, items } = resolved;

    let confirmed = 0;
    let skipped = 0;
    for (const item of items) {
      const state = await getScreeningState(ctx.project.id, item.key);
      if (state?.aiDecision && !state.decision) {
        await confirmDecision(
          ctx.project.id,
          item,
          ctx.collections,
          state.id,
          state.aiDecision,
          currentDeciderId(),
        );
        confirmed++;
      } else {
        skipped++;
      }
    }

    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({
        text: getString("progress-batch-confirm-done", {
          args: { confirmed, skipped },
        }),
        type: "success",
        progress: 100,
      })
      .show();
  }

  private static async resolveFtQueueBatchContext() {
    const ZoteroPaneGlobal = ztoolkit.getGlobal("ZoteroPane");
    const collectionId = ZoteroPaneGlobal.getSelectedCollection(true);
    const ctx = await findProjectPaneContext(collectionId ?? null);
    if (!ctx || ctx.role !== "ft_queue") {
      ztoolkit.getGlobal("alert")(getString("error-not-ft-queue"));
      return null;
    }
    const items = (ZoteroPaneGlobal.getSelectedItems() as Zotero.Item[]).filter(
      (i) => i.isRegularItem(),
    );
    if (items.length === 0) return null;
    return { ctx, items };
  }

  // Distinct from batchConfirmAI (TA): this doesn't touch any AI suggestion
  // at all -- it's a bulk cleanup for items the human never even got a PDF
  // for. Each selected item is only moved to FT-Unavailable if it still has
  // NO detected PDF attachment; an item that does have one is left alone
  // entirely (no action taken) so a batch run can't accidentally overwrite
  // a real screening decision for an item that's actually readable.
  static async batchMarkUnavailable() {
    const resolved = await EvidenceCommands.resolveFtQueueBatchContext();
    if (!resolved) return;
    const { ctx, items } = resolved;

    let marked = 0;
    let skipped = 0;
    for (const item of items) {
      const attachment = await resolveAttachment(item);
      if (attachment) {
        skipped++;
        continue;
      }
      await markUnavailable(
        ctx.project.id,
        item,
        ctx.collections,
        currentDeciderId(),
      );
      marked++;
    }

    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({
        text: getString("progress-batch-unavailable-done", {
          args: { marked, skipped },
        }),
        type: "success",
        progress: 100,
      })
      .show();
  }

  // Matches parseCodebookCsv's expected header/columns exactly (see
  // codebookService.ts): name,type,values,multiple,required,notes,
  // extraction_hint. `values` is only meaningful for categorical rows.
  private static readonly CODEBOOK_TEMPLATE_CSV = [
    "name,type,values,multiple,required,notes,extraction_hint",
    "study_design,categorical,RCT|Cohort|Case-control|Cross-sectional,0,1,Design as reported by the authors,Look in the Methods section for the study design description",
    "sample_size,numeric,,0,1,Final analyzed sample size (not enrolled N),Report the number of participants actually analyzed",
    "intervention_type,categorical,Drug|Behavioral|Surgical|Device|Other,0,0,Leave blank if not applicable,Only fill in if clearly stated in the Methods",
    "outcomes,text,,1,1,,Extract every reported outcome measure as a separate value",
    "country,text,,0,0,,Country or countries where the study was conducted",
    "",
  ].join("\n");

  static async codebookImportDialog() {
    const projects = await listProjects();
    if (projects.length === 0) {
      ztoolkit.getGlobal("alert")(getString("error-no-projects"));
      return;
    }

    const dialogData: { [key: string]: any } = {
      projectId: String(projects[0].id),
      filePath: "",
    };

    const dialog = new ztoolkit.Dialog(4, 2)
      .addCell(0, 0, {
        tag: "h1",
        properties: { innerHTML: getString("dialog-codebook-import-title") },
      })
      .addCell(1, 0, {
        tag: "label",
        namespace: "html",
        properties: {
          innerHTML: getString("dialog-codebook-import-project-label"),
        },
      })
      .addCell(
        1,
        1,
        {
          tag: "select",
          namespace: "html",
          attributes: { "data-bind": "projectId", "data-prop": "value" },
          children: projects.map((p) => ({
            tag: "option",
            namespace: "html",
            properties: { value: String(p.id), innerHTML: escapeHtml(p.name) },
          })),
        },
        false,
      )
      .addCell(2, 0, {
        tag: "label",
        namespace: "html",
        properties: {
          innerHTML: getString("dialog-codebook-import-file-label"),
        },
      })
      .addCell(
        2,
        1,
        {
          tag: "label",
          namespace: "html",
          id: "evidence-codebook-file-display",
          properties: {
            innerHTML: getString("dialog-codebook-import-file-none"),
          },
        },
        false,
      )
      .addCell(
        3,
        0,
        {
          tag: "button",
          namespace: "html",
          attributes: { type: "button" },
          properties: {
            innerHTML: getString("dialog-codebook-import-template-button"),
          },
          listeners: [
            {
              type: "click",
              listener: async () => {
                const path = await new ztoolkit.FilePicker(
                  getString("dialog-codebook-import-template-button"),
                  "save",
                  [["CSV (*.csv)", "*.csv"]],
                  "codebook-template.csv",
                ).open();
                if (!path || typeof path !== "string") return;
                Zotero.File.putContents(
                  Zotero.File.pathToFile(path),
                  EvidenceCommands.CODEBOOK_TEMPLATE_CSV,
                );
                new ztoolkit.ProgressWindow(addon.data.config.addonName)
                  .createLine({
                    text: getString("progress-export-done"),
                    type: "success",
                    progress: 100,
                  })
                  .show();
              },
            },
          ],
        },
        false,
      )
      .addCell(
        3,
        1,
        {
          tag: "button",
          namespace: "html",
          attributes: { type: "button" },
          properties: {
            innerHTML: getString("dialog-codebook-import-file-button"),
          },
          listeners: [
            {
              type: "click",
              listener: async () => {
                const path = await new ztoolkit.FilePicker(
                  getString("dialog-codebook-import-file-button"),
                  "open",
                  [["CSV (*.csv)", "*.csv"]],
                ).open();
                if (path && typeof path === "string") {
                  dialogData.filePath = path;
                  const displayEl = dialog.window?.document.getElementById(
                    "evidence-codebook-file-display",
                  );
                  if (displayEl) displayEl.textContent = path;
                }
              },
            },
          ],
        },
        false,
      )
      .addButton(getString("dialog-confirm"), "confirm")
      .addButton(getString("dialog-cancel"), "cancel")
      .setDialogData(dialogData);
    EvidenceCommands.openSizedDialog(
      dialog,
      getString("dialog-codebook-import-title"),
      560,
    );

    await dialogData.unloadLock.promise;
    if (dialogData._lastButtonId !== "confirm") return;
    if (!dialogData.filePath) {
      ztoolkit.getGlobal("alert")(getString("error-no-file-selected"));
      return;
    }

    const csvText = await Zotero.File.getContentsAsync(
      dialogData.filePath as string,
    );
    const variables = parseCodebookCsv(String(csvText));
    if (variables.length === 0) {
      ztoolkit.getGlobal("alert")(getString("error-codebook-empty-csv"));
      return;
    }

    await saveCodebook(Number(dialogData.projectId), variables);
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({
        text: getString("progress-codebook-imported", {
          args: { count: variables.length },
        }),
        type: "success",
        progress: 100,
      })
      .show();
  }

  static async codebookAddVariableDialog() {
    const projects = await listProjects();
    if (projects.length === 0) {
      ztoolkit.getGlobal("alert")(getString("error-no-projects"));
      return;
    }

    const dialogData: { [key: string]: any } = {
      projectId: String(projects[0].id),
      name: "",
      type: "text",
      values: "",
      multiple: false,
      required: false,
      notes: "",
      hint: "",
    };

    const dialog = new ztoolkit.Dialog(9, 2)
      .addCell(0, 0, {
        tag: "h1",
        properties: {
          innerHTML: getString("dialog-codebook-variable-title"),
        },
      })
      .addCell(1, 0, {
        tag: "label",
        namespace: "html",
        properties: { innerHTML: getString("dialog-import-project-label") },
      })
      .addCell(
        1,
        1,
        {
          tag: "select",
          namespace: "html",
          attributes: { "data-bind": "projectId", "data-prop": "value" },
          children: projects.map((p) => ({
            tag: "option",
            namespace: "html",
            properties: { value: String(p.id), innerHTML: escapeHtml(p.name) },
          })),
        },
        false,
      )
      .addCell(2, 0, {
        tag: "label",
        namespace: "html",
        properties: {
          innerHTML: getString("dialog-codebook-variable-name-label"),
        },
      })
      .addCell(
        2,
        1,
        {
          tag: "textarea",
          namespace: "html",
          attributes: {
            "data-bind": "name",
            "data-prop": "value",
            rows: "2",
            cols: "40",
          },
        },
        false,
      )
      .addCell(3, 0, {
        tag: "label",
        namespace: "html",
        properties: {
          innerHTML: getString("dialog-codebook-variable-type-label"),
        },
      })
      .addCell(
        3,
        1,
        {
          tag: "select",
          namespace: "html",
          attributes: { "data-bind": "type", "data-prop": "value" },
          children: ["text", "categorical", "numeric"].map((t) => ({
            tag: "option",
            namespace: "html",
            properties: { value: t, innerHTML: t },
          })),
        },
        false,
      )
      .addCell(4, 0, {
        tag: "label",
        namespace: "html",
        properties: {
          innerHTML: getString("dialog-codebook-variable-values-label"),
        },
      })
      .addCell(
        4,
        1,
        {
          tag: "textarea",
          namespace: "html",
          attributes: {
            "data-bind": "values",
            "data-prop": "value",
            rows: "2",
            cols: "40",
          },
        },
        false,
      )
      .addCell(
        5,
        0,
        {
          tag: "label",
          namespace: "html",
          properties: {
            innerHTML: getString("dialog-codebook-variable-multiple-label"),
          },
        },
        false,
      )
      .addCell(
        5,
        1,
        {
          tag: "input",
          namespace: "html",
          attributes: {
            "data-bind": "multiple",
            "data-prop": "checked",
            type: "checkbox",
          },
        },
        false,
      )
      .addCell(
        6,
        0,
        {
          tag: "label",
          namespace: "html",
          properties: {
            innerHTML: getString("dialog-codebook-variable-required-label"),
          },
        },
        false,
      )
      .addCell(
        6,
        1,
        {
          tag: "input",
          namespace: "html",
          attributes: {
            "data-bind": "required",
            "data-prop": "checked",
            type: "checkbox",
          },
        },
        false,
      )
      .addCell(7, 0, {
        tag: "label",
        namespace: "html",
        properties: {
          innerHTML: getString("dialog-codebook-variable-notes-label"),
        },
      })
      .addCell(
        7,
        1,
        {
          tag: "textarea",
          namespace: "html",
          attributes: {
            "data-bind": "notes",
            "data-prop": "value",
            rows: "2",
            cols: "40",
          },
        },
        false,
      )
      .addCell(8, 0, {
        tag: "label",
        namespace: "html",
        properties: {
          innerHTML: getString("dialog-codebook-variable-hint-label"),
        },
      })
      .addCell(
        8,
        1,
        {
          tag: "textarea",
          namespace: "html",
          attributes: {
            "data-bind": "hint",
            "data-prop": "value",
            rows: "2",
            cols: "40",
          },
        },
        false,
      )
      .addButton(getString("dialog-confirm"), "confirm")
      .addButton(getString("dialog-cancel"), "cancel")
      .setDialogData(dialogData);
    EvidenceCommands.openSizedDialog(
      dialog,
      getString("dialog-codebook-variable-title"),
      580,
    );

    await dialogData.unloadLock.promise;
    if (dialogData._lastButtonId !== "confirm") return;

    const name = String(dialogData.name || "").trim();
    if (!name) {
      ztoolkit.getGlobal("alert")(
        getString("error-codebook-variable-name-required"),
      );
      return;
    }

    const projectId = Number(dialogData.projectId);
    const existing = await getLatestCodebook(projectId);
    const variables: CodebookVariable[] = existing?.variables
      ? [...existing.variables]
      : [];
    const values = String(dialogData.values || "")
      .split("|")
      .map((v) => v.trim())
      .filter(Boolean);
    variables.push({
      name,
      type: dialogData.type as CodebookVariable["type"],
      values: values.length > 0 ? values : undefined,
      multiple: !!dialogData.multiple,
      required: !!dialogData.required,
      notes: String(dialogData.notes || "").trim() || undefined,
      extractionHint: String(dialogData.hint || "").trim() || undefined,
    });

    await saveCodebook(projectId, variables);
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({
        text: getString("progress-codebook-variable-added"),
        type: "success",
        progress: 100,
      })
      .show();
  }

  static async codebookViewDialog() {
    const projects = await listProjects();
    if (projects.length === 0) {
      ztoolkit.getGlobal("alert")(getString("error-no-projects"));
      return;
    }
    const dialogData: { [key: string]: any } = {
      projectId: String(projects[0].id),
    };

    const renderList = async (container: HTMLElement) => {
      const codebook = await getLatestCodebook(Number(dialogData.projectId));
      container.innerHTML = "";
      if (!codebook || codebook.variables.length === 0) {
        container.textContent = getString("codebook-view-empty");
        return;
      }
      const lines = codebook.variables.map((v) => {
        const flags = [
          v.required ? getString("codebook-view-required") : "",
          v.multiple ? getString("codebook-view-multiple") : "",
        ]
          .filter(Boolean)
          .join(", ");
        const valuesText = v.values?.length ? ` [${v.values.join(", ")}]` : "";
        return `${v.name} (${v.type}${flags ? ", " + flags : ""})${valuesText}`;
      });
      container.textContent = lines.join("\n");
    };

    const dialog = new ztoolkit.Dialog(3, 1)
      .addCell(0, 0, {
        tag: "h1",
        properties: { innerHTML: getString("dialog-codebook-view-title") },
      })
      .addCell(
        1,
        0,
        {
          tag: "select",
          namespace: "html",
          id: "evidence-codebook-view-project",
          attributes: { "data-bind": "projectId", "data-prop": "value" },
          children: projects.map((p) => ({
            tag: "option",
            namespace: "html",
            properties: { value: String(p.id), innerHTML: escapeHtml(p.name) },
          })),
        },
        false,
      )
      .addCell(
        2,
        0,
        {
          tag: "pre",
          namespace: "html",
          id: "evidence-codebook-view-list",
          styles: { whiteSpace: "pre-wrap" },
        },
        false,
      )
      .addButton(getString("dialog-close"), "close")
      .setDialogData(dialogData);
    EvidenceCommands.openSizedDialog(
      dialog,
      getString("dialog-codebook-view-title"),
      620,
    );

    await Zotero.Promise.delay(50);
    const listEl = dialog.window?.document.getElementById(
      "evidence-codebook-view-list",
    );
    if (listEl) await renderList(listEl as HTMLElement);

    const selectEl = dialog.window?.document.getElementById(
      "evidence-codebook-view-project",
    ) as HTMLSelectElement | undefined;
    EvidenceCommands.watchSelectValue(
      dialogData,
      dialog.window,
      selectEl,
      async (value) => {
        dialogData.projectId = value;
        if (listEl) await renderList(listEl as HTMLElement);
      },
    );
  }

  // Renaming isn't offered here -- coding_records references a codebook
  // variable by its raw `variable_name` text (see codingService.ts's
  // resolveCanonicalVariableName), so changing a variable's name would
  // silently orphan every existing coding record for it unless those rows
  // were also migrated. Name stays a read-only identifier; every other
  // field (type/values/multiple/required/notes/extraction hint) is fully
  // editable, matching what codebookAddVariableDialog collects when a
  // variable is first created.
  //
  // The variable picker is a real ztoolkit `tag: "select"` -- the exact
  // same widget and visual styling as the project picker above it -- not
  // a hand-built substitute. The catch: ztoolkit's Dialog builds that
  // widget's popup ONCE from its `children` at construction time (see
  // zotero-plugin-toolkit's replaceElement()), with no supported way to
  // refresh it afterwards. Switching the selected VARIABLE within one
  // project works fine as-is (that project's full, correct option list is
  // already known before the dialog is built), but switching the PROJECT
  // needs a different variable list -- so that case closes this dialog and
  // has the outer loop reopen a fresh one seeded for the new project,
  // rather than trying to mutate the popup in place.
  static async codebookEditVariableDialog() {
    const projects = await listProjects();
    if (projects.length === 0) {
      ztoolkit.getGlobal("alert")(getString("error-no-projects"));
      return;
    }

    let projectId = projects[0].id;

    while (true) {
      const codebook = await getLatestCodebook(projectId);
      const variables = codebook?.variables ?? [];
      const first = variables[0];

      const dialogData: { [key: string]: any } = {
        projectId: String(projectId),
        variableName: first?.name ?? "",
        type: first?.type ?? "text",
        values: first?.values?.join("|") ?? "",
        multiple: !!first?.multiple,
        required: !!first?.required,
        notes: first?.notes ?? "",
        hint: first?.extractionHint ?? "",
      };

      const dialog = new ztoolkit.Dialog(10, 2)
        .addCell(0, 0, {
          tag: "h1",
          properties: {
            innerHTML: getString("dialog-codebook-edit-variable-title"),
          },
        })
        .addCell(1, 0, {
          tag: "label",
          namespace: "html",
          properties: { innerHTML: getString("dialog-import-project-label") },
        })
        .addCell(
          1,
          1,
          {
            tag: "select",
            namespace: "html",
            id: "evidence-codebook-edit-project",
            attributes: { "data-bind": "projectId", "data-prop": "value" },
            children: projects.map((p) => ({
              tag: "option",
              namespace: "html",
              properties: {
                value: String(p.id),
                innerHTML: escapeHtml(p.name),
              },
            })),
          },
          false,
        )
        .addCell(2, 0, {
          tag: "label",
          namespace: "html",
          properties: {
            innerHTML: getString("dialog-codebook-edit-variable-select-label"),
          },
        })
        .addCell(
          2,
          1,
          {
            tag: "select",
            namespace: "html",
            id: "evidence-codebook-edit-variable-select",
            attributes: { "data-bind": "variableName", "data-prop": "value" },
            children: variables.map((v) => ({
              tag: "option",
              namespace: "html",
              properties: { value: v.name, innerHTML: escapeHtml(v.name) },
            })),
          },
          false,
        )
        .addCell(3, 0, {
          tag: "label",
          namespace: "html",
          properties: {
            innerHTML: getString("dialog-codebook-variable-name-label"),
          },
        })
        .addCell(
          3,
          1,
          {
            tag: "span",
            namespace: "html",
            id: "evidence-codebook-edit-name",
            properties: { innerHTML: escapeHtml(first?.name ?? "") },
          },
          false,
        )
        .addCell(4, 0, {
          tag: "label",
          namespace: "html",
          properties: {
            innerHTML: getString("dialog-codebook-variable-type-label"),
          },
        })
        .addCell(
          4,
          1,
          {
            tag: "select",
            namespace: "html",
            id: "evidence-codebook-edit-type",
            attributes: { "data-bind": "type", "data-prop": "value" },
            children: ["text", "categorical", "numeric"].map((t) => ({
              tag: "option",
              namespace: "html",
              properties: { value: t, innerHTML: t },
            })),
          },
          false,
        )
        .addCell(5, 0, {
          tag: "label",
          namespace: "html",
          properties: {
            innerHTML: getString("dialog-codebook-variable-values-label"),
          },
        })
        .addCell(
          5,
          1,
          {
            tag: "textarea",
            namespace: "html",
            id: "evidence-codebook-edit-values",
            attributes: {
              "data-bind": "values",
              "data-prop": "value",
              rows: "2",
              cols: "40",
            },
          },
          false,
        )
        .addCell(
          6,
          0,
          {
            tag: "label",
            namespace: "html",
            properties: {
              innerHTML: getString("dialog-codebook-variable-multiple-label"),
            },
          },
          false,
        )
        .addCell(
          6,
          1,
          {
            tag: "input",
            namespace: "html",
            id: "evidence-codebook-edit-multiple",
            attributes: {
              "data-bind": "multiple",
              "data-prop": "checked",
              type: "checkbox",
            },
          },
          false,
        )
        .addCell(
          7,
          0,
          {
            tag: "label",
            namespace: "html",
            properties: {
              innerHTML: getString("dialog-codebook-variable-required-label"),
            },
          },
          false,
        )
        .addCell(
          7,
          1,
          {
            tag: "input",
            namespace: "html",
            id: "evidence-codebook-edit-required",
            attributes: {
              "data-bind": "required",
              "data-prop": "checked",
              type: "checkbox",
            },
          },
          false,
        )
        .addCell(8, 0, {
          tag: "label",
          namespace: "html",
          properties: {
            innerHTML: getString("dialog-codebook-variable-notes-label"),
          },
        })
        .addCell(
          8,
          1,
          {
            tag: "textarea",
            namespace: "html",
            id: "evidence-codebook-edit-notes",
            attributes: { rows: "4", cols: "40" },
          },
          false,
        )
        .addCell(9, 0, {
          tag: "label",
          namespace: "html",
          properties: {
            innerHTML: getString("dialog-codebook-variable-hint-label"),
          },
        })
        .addCell(
          9,
          1,
          {
            tag: "textarea",
            namespace: "html",
            id: "evidence-codebook-edit-hint",
            attributes: {
              "data-bind": "hint",
              "data-prop": "value",
              rows: "2",
              cols: "40",
            },
          },
          false,
        )
        .addButton(getString("dialog-confirm"), "confirm")
        .addButton(getString("dialog-cancel"), "cancel")
        .setDialogData(dialogData);
      EvidenceCommands.openSizedDialog(
        dialog,
        getString("dialog-codebook-edit-variable-title"),
        620,
      );

      await Zotero.Promise.delay(50);
      const doc = dialog.window?.document;
      const variableSelectEl = doc?.getElementById(
        "evidence-codebook-edit-variable-select",
      ) as HTMLSelectElement | undefined;
      const nameEl = doc?.getElementById("evidence-codebook-edit-name");
      const typeEl = doc?.getElementById("evidence-codebook-edit-type") as
        | HTMLSelectElement
        | undefined;
      const valuesEl = doc?.getElementById("evidence-codebook-edit-values") as
        | HTMLTextAreaElement
        | undefined;
      const multipleEl = doc?.getElementById(
        "evidence-codebook-edit-multiple",
      ) as HTMLInputElement | undefined;
      const requiredEl = doc?.getElementById(
        "evidence-codebook-edit-required",
      ) as HTMLInputElement | undefined;
      // data-bind's own listeners only ever apply a control's INITIAL
      // value from dialogData once, at construction, and only read it back
      // at unload -- switching the selected variable within this project
      // needs these sibling fields' displayed values (and dialogData
      // itself) written by hand as it happens. notes has no data-bind at
      // all (kept as a plain manual-sync field, like before).
      const notesEl = doc?.getElementById("evidence-codebook-edit-notes") as
        | HTMLTextAreaElement
        | undefined;
      const hintEl = doc?.getElementById("evidence-codebook-edit-hint") as
        | HTMLTextAreaElement
        | undefined;

      const populateFields = (v: CodebookVariable | undefined) => {
        dialogData.variableName = v?.name ?? "";
        dialogData.type = v?.type ?? "text";
        dialogData.values = v?.values?.join("|") ?? "";
        dialogData.multiple = !!v?.multiple;
        dialogData.required = !!v?.required;
        dialogData.notes = v?.notes ?? "";
        dialogData.hint = v?.extractionHint ?? "";
        if (nameEl) nameEl.textContent = dialogData.variableName;
        if (typeEl) typeEl.value = dialogData.type;
        if (valuesEl) valuesEl.value = dialogData.values;
        if (multipleEl) multipleEl.checked = dialogData.multiple;
        if (requiredEl) requiredEl.checked = dialogData.required;
        if (notesEl) notesEl.value = dialogData.notes;
        if (hintEl) hintEl.value = dialogData.hint;
      };
      // notesEl has no data-bind, so its initial display needs this same
      // manual write once up front -- everything else here is already
      // correct from data-bind's own construction-time initialization,
      // this is just a harmless, consistent no-op for those.
      populateFields(first);

      // Switching among THIS project's own variables works through
      // ztoolkit's real popup select (see the method-level comment above)
      // -- watchSelectValue polls the underlying <select>'s value, which
      // the popup writes to directly when an item is picked.
      EvidenceCommands.watchSelectValue(
        dialogData,
        dialog.window,
        variableSelectEl,
        (value) => {
          populateFields(variables.find((v) => v.name === value));
        },
      );

      const projectSelectEl = doc?.getElementById(
        "evidence-codebook-edit-project",
      ) as HTMLSelectElement | undefined;
      // Switching the PROJECT needs a different variable list, which the
      // popup can't be refreshed with in place -- close this dialog and
      // let the outer loop reopen a fresh one built for the new project.
      EvidenceCommands.watchSelectValue(
        dialogData,
        dialog.window,
        projectSelectEl,
        (value) => {
          dialogData.__reopenForProjectId = Number(value);
          dialog.window?.close();
        },
      );

      notesEl?.addEventListener("input", (e: Event) => {
        dialogData.notes = (e.target as HTMLTextAreaElement).value;
      });

      await dialogData.unloadLock.promise;

      if (dialogData.__reopenForProjectId != null) {
        projectId = dialogData.__reopenForProjectId;
        continue;
      }
      if (dialogData._lastButtonId !== "confirm") return;

      if (variables.length === 0) {
        ztoolkit.getGlobal("alert")(getString("error-codebook-no-variables"));
        return;
      }

      const values = String(dialogData.values || "")
        .split("|")
        .map((v) => v.trim())
        .filter(Boolean);
      const updatedVariables = variables.map((v) =>
        v.name === dialogData.variableName
          ? {
              ...v,
              type: dialogData.type as CodebookVariable["type"],
              values: values.length > 0 ? values : undefined,
              multiple: !!dialogData.multiple,
              required: !!dialogData.required,
              notes: String(dialogData.notes || "").trim() || undefined,
              extractionHint: String(dialogData.hint || "").trim() || undefined,
            }
          : v,
      );

      try {
        await saveCodebook(projectId, updatedVariables);
        new ztoolkit.ProgressWindow(addon.data.config.addonName)
          .createLine({
            text: getString("progress-codebook-variable-updated"),
            type: "success",
            progress: 100,
          })
          .show();
      } catch (e: any) {
        ztoolkit.log("Save codebook variable failed", e);
        ztoolkit.getGlobal("alert")(e?.message ?? String(e));
      }
      return;
    }
  }

  // Same reopen-on-project-change loop as codebookEditVariableDialog, and
  // for the same reason: the variable picker is a real ztoolkit `select`
  // (so it looks/behaves exactly like every other dropdown in this dialog),
  // and that widget's option popup can only be built once, from static
  // `children`, at construction time -- switching project needs a
  // different variable list, so this closes and reopens rather than trying
  // to refresh the popup in place. Switching the VARIABLE within one
  // project doesn't have that problem (its option list is already known),
  // so that just rebuilds the results table in place via refreshTable().
  static async synthesisDialog() {
    const projects = await listProjects();
    if (projects.length === 0) {
      ztoolkit.getGlobal("alert")(getString("error-no-projects"));
      return;
    }

    const HTML_NS = "http://www.w3.org/1999/xhtml";
    let projectId = projects[0].id;

    while (true) {
      const codebook = await getLatestCodebook(projectId);
      const variables = codebook?.variables ?? [];
      const first = variables[0];

      const dialogData: { [key: string]: any } = {
        projectId: String(projectId),
        variableName: first?.name ?? "",
      };

      const dialog = new ztoolkit.Dialog(6, 2)
        .addCell(0, 0, {
          tag: "h1",
          properties: { innerHTML: getString("dialog-synthesis-title") },
        })
        .addCell(1, 0, {
          tag: "label",
          namespace: "html",
          properties: { innerHTML: getString("dialog-import-project-label") },
        })
        .addCell(
          1,
          1,
          {
            tag: "select",
            namespace: "html",
            id: "evidence-synthesis-project",
            attributes: { "data-bind": "projectId", "data-prop": "value" },
            children: projects.map((p) => ({
              tag: "option",
              namespace: "html",
              properties: {
                value: String(p.id),
                innerHTML: escapeHtml(p.name),
              },
            })),
          },
          false,
        )
        .addCell(2, 0, {
          tag: "label",
          namespace: "html",
          properties: {
            innerHTML: getString("dialog-codebook-edit-variable-select-label"),
          },
        })
        .addCell(
          2,
          1,
          {
            tag: "select",
            namespace: "html",
            id: "evidence-synthesis-variable",
            attributes: { "data-bind": "variableName", "data-prop": "value" },
            children: variables.map((v) => ({
              tag: "option",
              namespace: "html",
              properties: { value: v.name, innerHTML: escapeHtml(v.name) },
            })),
          },
          false,
        )
        .addCell(3, 0, {
          tag: "div",
          namespace: "html",
          id: "evidence-synthesis-table-container",
          styles: { maxHeight: "440px", overflow: "auto", marginTop: "6px" },
        })
        .addCell(
          4,
          0,
          {
            tag: "button",
            namespace: "html",
            id: "evidence-synthesis-run",
            attributes: { type: "button" },
            properties: { innerHTML: getString("synthesis-run-button") },
          },
          false,
        )
        .addCell(
          4,
          1,
          {
            tag: "span",
            namespace: "html",
            id: "evidence-synthesis-status",
          },
          false,
        )
        .addButton(getString("dialog-close"), "close")
        .setDialogData(dialogData);
      EvidenceCommands.openSizedDialog(
        dialog,
        getString("dialog-synthesis-title"),
        900,
      );

      await Zotero.Promise.delay(50);
      const doc = dialog.window?.document;
      const variableSelectEl = doc?.getElementById(
        "evidence-synthesis-variable",
      ) as HTMLSelectElement | undefined;
      const tableContainer = doc?.getElementById(
        "evidence-synthesis-table-container",
      );
      const runBtn = doc?.getElementById("evidence-synthesis-run") as
        | HTMLButtonElement
        | undefined;
      const statusEl = doc?.getElementById("evidence-synthesis-status");

      // History here matters -- three data points across this feature's
      // debugging: (A) table-layout:fixed + <colgroup>/<col> + position:
      // sticky = Zotero crashed outright on open; (B) none of the three,
      // per-element inline styles, char-truncated text, plain auto table
      // layout = confirmed stable; (C) dropped colgroup/sticky but brought
      // table-layout:fixed BACK (via a shared injected <style> instead) =
      // crashed again. table-layout:fixed is the one thing present in both
      // crashing attempts and absent from the only stable one, so it and
      // the shared <style>/CSS-class approach are BOTH out for good here --
      // this is back to (B)'s exact technique (per-element cssText, no
      // classes, no injected stylesheet, no forced layout), with only the
      // VISUAL VALUES improved (header tint, single-line via inline
      // white-space:nowrap) on top of that proven-safe foundation. No
      // text-overflow:ellipsis either -- quotePreview already appends its
      // own "…" at the string level when it truncates, so there's no need
      // for the CSS version of the same thing.
      const MAX_DISPLAY_ROWS = 150;
      const renderTable = (rows: SynthesisRow[]) => {
        if (!tableContainer) return;
        tableContainer.innerHTML = "";
        if (rows.length === 0) {
          tableContainer.appendChild(
            doc!.createElementNS(HTML_NS, "p") as HTMLElement,
          ).textContent = getString("synthesis-no-records");
          return;
        }
        const shown = rows.slice(0, MAX_DISPLAY_ROWS);
        const table = doc!.createElementNS(
          HTML_NS,
          "table",
        ) as HTMLTableElement;
        table.style.cssText = "width:100%;border-collapse:collapse;";
        const headRow = doc!.createElementNS(HTML_NS, "tr");
        for (const label of [
          getString("synthesis-col-source"),
          getString("synthesis-col-name"),
          getString("synthesis-col-value"),
          getString("synthesis-col-quote"),
          getString("synthesis-col-theme"),
        ]) {
          const th = doc!.createElementNS(HTML_NS, "th") as HTMLElement;
          th.textContent = label;
          th.style.cssText =
            "text-align:left;white-space:nowrap;font-weight:600;font-size:0.85em;color:#666;background:#f2f2f2;border-bottom:1px solid #ccc;padding:5px 8px;";
          headRow.appendChild(th);
        }
        table.appendChild(headRow);
        for (const row of shown) {
          const tr = doc!.createElementNS(HTML_NS, "tr");
          const cells: [string, number][] = [
            [row.itemTitle, 40],
            [row.variableName, 22],
            [row.variableValue, 22],
            [row.quote || "", 80],
            [row.theme || "", 36],
          ];
          for (const [text, max] of cells) {
            const td = doc!.createElementNS(HTML_NS, "td") as HTMLElement;
            td.textContent = quotePreview(text, max);
            if (text) td.title = text;
            td.style.cssText =
              "white-space:nowrap;overflow:hidden;border-bottom:1px solid #eee;padding:5px 8px;";
            tr.appendChild(td);
          }
          table.appendChild(tr);
        }
        tableContainer.appendChild(table);
        if (rows.length > shown.length) {
          const note = doc!.createElementNS(HTML_NS, "p") as HTMLElement;
          note.style.cssText = "color:#888;font-size:0.85em;margin-top:4px;";
          note.textContent = getString("synthesis-truncated", {
            args: { shown: shown.length, total: rows.length },
          });
          tableContainer.appendChild(note);
        }
      };

      const refreshTable = async () => {
        try {
          if (!dialogData.variableName) {
            renderTable([]);
            return;
          }
          const rows = await getSynthesisRows(
            Number(dialogData.projectId),
            dialogData.variableName,
          );
          renderTable(rows);
        } catch (e: any) {
          // Surface a diagnosable message instead of leaving the table
          // area stuck or silently empty if rendering/fetching fails.
          ztoolkit.log("Synthesis table render failed", e);
          if (tableContainer) {
            tableContainer.textContent = `${getString("synthesis-error")} ${e?.message ?? e}`;
          }
        }
      };

      await refreshTable();

      const projectSelectEl = doc?.getElementById(
        "evidence-synthesis-project",
      ) as HTMLSelectElement | undefined;
      EvidenceCommands.watchSelectValue(
        dialogData,
        dialog.window,
        projectSelectEl,
        (value) => {
          dialogData.__reopenForProjectId = Number(value);
          dialog.window?.close();
        },
      );

      EvidenceCommands.watchSelectValue(
        dialogData,
        dialog.window,
        variableSelectEl,
        async (value) => {
          dialogData.variableName = value;
          await refreshTable();
        },
      );

      runBtn?.addEventListener("click", async () => {
        if (!dialogData.variableName) return;
        runBtn.setAttribute("disabled", "true");
        if (statusEl) statusEl.textContent = getString("synthesis-loading");
        try {
          const rows = await runSynthesis(
            Number(dialogData.projectId),
            dialogData.variableName,
          );
          renderTable(rows);
          if (statusEl) statusEl.textContent = getString("synthesis-done");
        } catch (e: any) {
          if (statusEl) statusEl.textContent = getString("synthesis-error");
          ztoolkit.getGlobal("alert")(
            `${getString("synthesis-error")}\n${e?.message ?? e}`,
          );
        } finally {
          runBtn.removeAttribute("disabled");
        }
      });

      await dialogData.unloadLock.promise;

      if (dialogData.__reopenForProjectId != null) {
        projectId = dialogData.__reopenForProjectId;
        continue;
      }
      return;
    }
  }

  private static consistencyDecisionLabel(raw: string): string {
    const keys: { [k: string]: FluentMessageId } = {
      include: "screen-queue-decision-include",
      exclude: "screen-queue-decision-exclude",
      unclear: "screen-queue-decision-unclear",
      unavailable: "screen-queue-decision-unavailable",
    };
    const key = keys[raw];
    return key ? getString(key) : raw;
  }

  private static consistencyKappaLevelLabel(kappa: number): string {
    const levels: [number, FluentMessageId][] = [
      [0.8, "consistency-kappa-level-almost-perfect"],
      [0.6, "consistency-kappa-level-substantial"],
      [0.4, "consistency-kappa-level-moderate"],
      [0.2, "consistency-kappa-level-fair"],
      [0, "consistency-kappa-level-slight"],
    ];
    for (const [threshold, key] of levels) {
      if (kappa >= threshold) return getString(key);
    }
    return getString("consistency-kappa-level-poor");
  }

  static async consistencyDialog() {
    const projects = await listProjects();
    if (projects.length === 0) {
      ztoolkit.getGlobal("alert")(getString("error-no-projects"));
      return;
    }

    const HTML_NS = "http://www.w3.org/1999/xhtml";
    let projectId = projects[0].id;
    const MAX_DISAGREEMENT_ROWS = 150;

    while (true) {
      const dialogData: { [key: string]: any } = {
        projectId: String(projectId),
        stage: "ta_screening",
      };

      const dialog = new ztoolkit.Dialog(6, 2)
        .addCell(0, 0, {
          tag: "h1",
          properties: { innerHTML: getString("dialog-consistency-title") },
        })
        .addCell(1, 0, {
          tag: "label",
          namespace: "html",
          properties: { innerHTML: getString("dialog-import-project-label") },
        })
        .addCell(
          1,
          1,
          {
            tag: "select",
            namespace: "html",
            id: "evidence-consistency-project",
            attributes: { "data-bind": "projectId", "data-prop": "value" },
            children: projects.map((p) => ({
              tag: "option",
              namespace: "html",
              properties: {
                value: String(p.id),
                innerHTML: escapeHtml(p.name),
              },
            })),
          },
          false,
        )
        .addCell(2, 0, {
          tag: "label",
          namespace: "html",
          properties: {
            innerHTML: getString("dialog-consistency-stage-label"),
          },
        })
        .addCell(
          2,
          1,
          {
            tag: "select",
            namespace: "html",
            id: "evidence-consistency-stage",
            attributes: { "data-bind": "stage", "data-prop": "value" },
            children: [
              {
                tag: "option",
                namespace: "html",
                properties: {
                  value: "ta_screening",
                  innerHTML: escapeHtml(getString("consistency-stage-ta")),
                },
              },
              {
                tag: "option",
                namespace: "html",
                properties: {
                  value: "ft_screening",
                  innerHTML: escapeHtml(getString("consistency-stage-ft")),
                },
              },
            ],
          },
          false,
        )
        .addCell(3, 0, {
          tag: "div",
          namespace: "html",
          id: "evidence-consistency-results",
          styles: { maxHeight: "440px", overflow: "auto", marginTop: "6px" },
        })
        .addCell(
          4,
          0,
          {
            tag: "button",
            namespace: "html",
            id: "evidence-consistency-run",
            attributes: { type: "button" },
            properties: { innerHTML: getString("consistency-run-button") },
          },
          false,
        )
        .addCell(
          4,
          1,
          {
            tag: "span",
            namespace: "html",
            id: "evidence-consistency-status",
          },
          false,
        )
        .addButton(getString("dialog-close"), "close")
        .setDialogData(dialogData);
      EvidenceCommands.openSizedDialog(
        dialog,
        getString("dialog-consistency-title"),
        720,
      );

      await Zotero.Promise.delay(50);
      const doc = dialog.window?.document;
      const stageSelectEl = doc?.getElementById(
        "evidence-consistency-stage",
      ) as HTMLSelectElement | undefined;
      const resultsContainer = doc?.getElementById(
        "evidence-consistency-results",
      );
      const runBtn = doc?.getElementById("evidence-consistency-run") as
        | HTMLButtonElement
        | undefined;
      const statusEl = doc?.getElementById("evidence-consistency-status");

      const buildTable = (
        headers: string[],
        rowsData: [string, number][][],
      ) => {
        const table = doc!.createElementNS(
          HTML_NS,
          "table",
        ) as HTMLTableElement;
        table.style.cssText =
          "width:100%;border-collapse:collapse;margin-bottom:10px;";
        const headRow = doc!.createElementNS(HTML_NS, "tr");
        for (const label of headers) {
          const th = doc!.createElementNS(HTML_NS, "th") as HTMLElement;
          th.textContent = label;
          th.style.cssText =
            "text-align:left;white-space:nowrap;font-weight:600;font-size:0.85em;color:#666;background:#f2f2f2;border-bottom:1px solid #ccc;padding:5px 8px;";
          headRow.appendChild(th);
        }
        table.appendChild(headRow);
        for (const cells of rowsData) {
          const tr = doc!.createElementNS(HTML_NS, "tr");
          for (const [text, max] of cells) {
            const td = doc!.createElementNS(HTML_NS, "td") as HTMLElement;
            td.textContent = quotePreview(text, max);
            if (text) td.title = text;
            td.style.cssText =
              "white-space:nowrap;overflow:hidden;border-bottom:1px solid #eee;padding:5px 8px;";
            tr.appendChild(td);
          }
          table.appendChild(tr);
        }
        return table;
      };

      // Renders one stats block (summary + per-category table + a
      // disagreements table) into `container` -- shared by the overall
      // figures and by each per-model breakdown below them, so a heading is
      // the only thing that varies between calls.
      const renderStatsBlock = (
        container: Element,
        stats: ScreeningConsistencyStats,
        heading?: string,
      ) => {
        if (heading) {
          const h2 = doc!.createElementNS(HTML_NS, "h2") as HTMLElement;
          h2.textContent = heading;
          h2.style.cssText =
            "font-size:1em;margin:10px 0 4px;border-top:1px solid #ddd;padding-top:8px;";
          container.appendChild(h2);
        }

        const summary = doc!.createElementNS(HTML_NS, "div") as HTMLElement;
        summary.style.cssText = "margin-bottom:8px;";
        const kappaValueText =
          stats.kappa === null
            ? getString("consistency-kappa-na")
            : `${stats.kappa.toFixed(2)} (${EvidenceCommands.consistencyKappaLevelLabel(stats.kappa)})`;
        for (const line of [
          getString("consistency-summary-n", { args: { n: stats.n } }),
          getString("consistency-summary-agreement", {
            args: {
              pct: ((stats.observedAgreement ?? 0) * 100).toFixed(1),
            },
          }),
          `${getString("consistency-summary-kappa-label")}: ${kappaValueText}`,
        ]) {
          const p = doc!.createElementNS(HTML_NS, "p") as HTMLElement;
          p.style.cssText = "margin:2px 0;";
          p.textContent = line;
          summary.appendChild(p);
        }
        container.appendChild(summary);

        container.appendChild(
          buildTable(
            [
              getString("consistency-col-category"),
              getString("consistency-col-agreement"),
              getString("consistency-col-kappa"),
            ],
            stats.byCategory.map((c) => [
              [EvidenceCommands.consistencyDecisionLabel(c.category), 24],
              [`${(c.observedAgreement * 100).toFixed(1)}%`, 12],
              [c.kappa === null ? "—" : c.kappa.toFixed(2), 8],
            ]),
          ),
        );

        if (stats.disagreements.length > 0) {
          const h3 = doc!.createElementNS(HTML_NS, "h3") as HTMLElement;
          h3.textContent = getString("consistency-disagreements-title");
          h3.style.cssText = "font-size:0.95em;margin:6px 0 4px;";
          container.appendChild(h3);
          const shown = stats.disagreements.slice(0, MAX_DISAGREEMENT_ROWS);
          container.appendChild(
            buildTable(
              [
                getString("consistency-col-title"),
                getString("consistency-col-ai"),
                getString("consistency-col-human"),
              ],
              shown.map((d) => [
                [d.title, 50],
                [EvidenceCommands.consistencyDecisionLabel(d.aiDecision), 16],
                [
                  EvidenceCommands.consistencyDecisionLabel(d.humanDecision),
                  16,
                ],
              ]),
            ),
          );
          if (stats.disagreements.length > shown.length) {
            const note = doc!.createElementNS(HTML_NS, "p") as HTMLElement;
            note.style.cssText = "color:#888;font-size:0.85em;";
            note.textContent = getString("synthesis-truncated", {
              args: {
                shown: shown.length,
                total: stats.disagreements.length,
              },
            });
            container.appendChild(note);
          }
        }
      };

      const renderResults = (result: ScreeningConsistencyResult) => {
        if (!resultsContainer) return;
        resultsContainer.innerHTML = "";
        if (result.n === 0) {
          resultsContainer.appendChild(
            doc!.createElementNS(HTML_NS, "p") as HTMLElement,
          ).textContent = getString("consistency-no-records");
          return;
        }

        // Only worth splitting out a "by model" section once there's more
        // than one distinct model to compare -- with a single model it
        // would just repeat the overall numbers a second time.
        const showByModel = result.byModel.length > 1;
        renderStatsBlock(
          resultsContainer,
          result,
          showByModel ? getString("consistency-overall-heading") : undefined,
        );

        if (showByModel) {
          const h2 = doc!.createElementNS(HTML_NS, "h2") as HTMLElement;
          h2.textContent = getString("consistency-by-model-title");
          h2.style.cssText =
            "font-size:1.05em;margin:14px 0 0;border-top:2px solid #ccc;padding-top:10px;";
          resultsContainer.appendChild(h2);
          for (const model of result.byModel) {
            renderStatsBlock(
              resultsContainer,
              model,
              model.aiModel ?? getString("consistency-model-unknown"),
            );
          }
        }
      };

      const refresh = async () => {
        runBtn?.setAttribute("disabled", "true");
        if (statusEl) statusEl.textContent = getString("consistency-loading");
        try {
          const result = await getScreeningConsistency(
            Number(dialogData.projectId),
            dialogData.stage as ScreeningConsistencyStage,
          );
          renderResults(result);
          if (statusEl) statusEl.textContent = "";
        } catch (e: any) {
          if (statusEl) statusEl.textContent = getString("consistency-error");
          ztoolkit.getGlobal("alert")(
            `${getString("consistency-error")}\n${e?.message ?? e}`,
          );
        } finally {
          runBtn?.removeAttribute("disabled");
        }
      };

      await refresh();

      const projectSelectEl = doc?.getElementById(
        "evidence-consistency-project",
      ) as HTMLSelectElement | undefined;
      EvidenceCommands.watchSelectValue(
        dialogData,
        dialog.window,
        projectSelectEl,
        (value) => {
          dialogData.__reopenForProjectId = Number(value);
          dialog.window?.close();
        },
      );

      EvidenceCommands.watchSelectValue(
        dialogData,
        dialog.window,
        stageSelectEl,
        async (value) => {
          dialogData.stage = value;
          await refresh();
        },
      );

      runBtn?.addEventListener("click", () => void refresh());

      await dialogData.unloadLock.promise;

      if (dialogData.__reopenForProjectId != null) {
        projectId = dialogData.__reopenForProjectId;
        continue;
      }
      return;
    }
  }

  static async humanConsistencyDialog() {
    const projects = await listProjects();
    if (projects.length === 0) {
      ztoolkit.getGlobal("alert")(getString("error-no-projects"));
      return;
    }

    const HTML_NS = "http://www.w3.org/1999/xhtml";
    let projectId = projects[0].id;

    while (true) {
      const dialogData: { [key: string]: any } = {
        projectId: String(projectId),
        stage: "ta_screening",
      };

      const dialog = new ztoolkit.Dialog(5, 2)
        .addCell(0, 0, {
          tag: "h1",
          properties: {
            innerHTML: getString("dialog-human-consistency-title"),
          },
        })
        .addCell(1, 0, {
          tag: "label",
          namespace: "html",
          properties: { innerHTML: getString("dialog-import-project-label") },
        })
        .addCell(
          1,
          1,
          {
            tag: "select",
            namespace: "html",
            id: "evidence-human-consistency-project",
            attributes: { "data-bind": "projectId", "data-prop": "value" },
            children: projects.map((p) => ({
              tag: "option",
              namespace: "html",
              properties: {
                value: String(p.id),
                innerHTML: escapeHtml(p.name),
              },
            })),
          },
          false,
        )
        .addCell(2, 0, {
          tag: "label",
          namespace: "html",
          properties: {
            innerHTML: getString("dialog-consistency-stage-label"),
          },
        })
        .addCell(
          2,
          1,
          {
            tag: "select",
            namespace: "html",
            id: "evidence-human-consistency-stage",
            attributes: { "data-bind": "stage", "data-prop": "value" },
            children: [
              {
                tag: "option",
                namespace: "html",
                properties: {
                  value: "ta_screening",
                  innerHTML: escapeHtml(getString("consistency-stage-ta")),
                },
              },
              {
                tag: "option",
                namespace: "html",
                properties: {
                  value: "ft_screening",
                  innerHTML: escapeHtml(getString("consistency-stage-ft")),
                },
              },
            ],
          },
          false,
        )
        .addCell(3, 0, {
          tag: "div",
          namespace: "html",
          id: "evidence-human-consistency-content",
          styles: { maxHeight: "460px", overflow: "auto", marginTop: "6px" },
        })
        .addCell(
          4,
          0,
          {
            tag: "span",
            namespace: "html",
            id: "evidence-human-consistency-status",
          },
          false,
        )
        .addButton(getString("dialog-close"), "close")
        .setDialogData(dialogData);
      EvidenceCommands.openSizedDialog(
        dialog,
        getString("dialog-human-consistency-title"),
        820,
      );

      await Zotero.Promise.delay(50);
      const doc = dialog.window?.document;
      const stageSelectEl = doc?.getElementById(
        "evidence-human-consistency-stage",
      ) as HTMLSelectElement | undefined;
      const contentEl = doc?.getElementById(
        "evidence-human-consistency-content",
      );
      const statusEl = doc?.getElementById("evidence-human-consistency-status");

      const setStatus = (text: string) => {
        if (statusEl) statusEl.textContent = text;
      };
      const setError = (e: any) => {
        setStatus(
          `${getString("human-consistency-error")}: ${e?.message ?? e}`,
        );
      };

      const currentProjectName = () =>
        projects.find((p) => p.id === Number(dialogData.projectId))?.name ?? "";

      const chooseArchiveSavePath = async (
        suffix: string,
      ): Promise<string | null> => {
        const path = await new ztoolkit.FilePicker(
          getString("human-consistency-archive-save-title"),
          "save",
          [["Zip Archive (*.zip)", "*.zip"]],
          `${currentProjectName()}-${suffix}.zip`,
        ).open();
        return path && typeof path === "string" ? path : null;
      };

      const renderStartForm = () => {
        if (!contentEl) return;
        const p = doc!.createElementNS(HTML_NS, "p") as HTMLElement;
        p.textContent = getString("human-consistency-intro");
        contentEl.appendChild(p);

        const row = doc!.createElementNS(HTML_NS, "div") as HTMLElement;
        row.style.cssText = "margin:6px 0;";
        const label = doc!.createElementNS(HTML_NS, "label") as HTMLElement;
        label.textContent = getString("human-consistency-percent-label");
        row.appendChild(label);
        const percentInput = doc!.createElementNS(
          HTML_NS,
          "input",
        ) as HTMLInputElement;
        percentInput.type = "number";
        percentInput.min = "1";
        percentInput.max = "100";
        percentInput.value = "20";
        percentInput.style.cssText = "width:60px;margin-left:8px;";
        row.appendChild(percentInput);
        contentEl.appendChild(row);

        const startBtn = doc!.createElementNS(
          HTML_NS,
          "button",
        ) as HTMLButtonElement;
        startBtn.setAttribute("type", "button");
        startBtn.textContent = getString(
          "human-consistency-start-pilot-button",
        );
        contentEl.appendChild(startBtn);

        startBtn.addEventListener("click", async () => {
          const zipPath = await chooseArchiveSavePath("pilot-sample");
          if (!zipPath) return;
          startBtn.setAttribute("disabled", "true");
          setStatus(getString("consistency-loading"));
          try {
            await startPilotRound(
              Number(dialogData.projectId),
              dialogData.stage as ScreeningConsistencyStage,
              Number(percentInput.value) || 20,
              zipPath,
            );
            setStatus("");
            await renderState();
          } catch (e: any) {
            setError(e);
          } finally {
            startBtn.removeAttribute("disabled");
          }
        });
      };

      const renderCollectForm = (round: ConsistencyRound) => {
        if (!contentEl) return;
        const p = doc!.createElementNS(HTML_NS, "p") as HTMLElement;
        p.textContent = getString("human-consistency-waiting-note", {
          args: { n: round.itemKeys.length },
        });
        contentEl.appendChild(p);

        const makeImportRow = (which: "a" | "b", collected: string | null) => {
          const row = doc!.createElementNS(HTML_NS, "div") as HTMLElement;
          row.style.cssText = "margin:6px 0;";
          const btn = doc!.createElementNS(
            HTML_NS,
            "button",
          ) as HTMLButtonElement;
          btn.setAttribute("type", "button");
          btn.textContent = collected
            ? getString(
                which === "a"
                  ? "human-consistency-reviewer-a-done"
                  : "human-consistency-reviewer-b-done",
              )
            : getString(
                which === "a"
                  ? "human-consistency-import-a-button"
                  : "human-consistency-import-b-button",
              );
          if (collected) btn.setAttribute("disabled", "true");
          row.appendChild(btn);
          btn.addEventListener("click", async () => {
            const path = await new ztoolkit.FilePicker(
              getString("human-consistency-import-csv-title"),
              "open",
              [["CSV (*.csv)", "*.csv"]],
            ).open();
            if (!path || typeof path !== "string") return;
            setStatus(getString("consistency-loading"));
            try {
              await recordCollectedCsv(round.id, which, path);
              setStatus("");
              await renderState();
            } catch (e: any) {
              setError(e);
            }
          });
          return row;
        };
        contentEl.appendChild(makeImportRow("a", round.reviewerACsvPath));
        contentEl.appendChild(makeImportRow("b", round.reviewerBCsvPath));
      };

      const buildStatsTable = (
        headers: string[],
        rowsData: [string, number][][],
      ) => {
        const table = doc!.createElementNS(
          HTML_NS,
          "table",
        ) as HTMLTableElement;
        table.style.cssText =
          "width:100%;border-collapse:collapse;margin:8px 0;";
        const headRow = doc!.createElementNS(HTML_NS, "tr");
        for (const label of headers) {
          const th = doc!.createElementNS(HTML_NS, "th") as HTMLElement;
          th.textContent = label;
          th.style.cssText =
            "text-align:left;white-space:nowrap;font-weight:600;font-size:0.85em;color:#666;background:#f2f2f2;border-bottom:1px solid #ccc;padding:5px 8px;";
          headRow.appendChild(th);
        }
        table.appendChild(headRow);
        for (const cells of rowsData) {
          const tr = doc!.createElementNS(HTML_NS, "tr");
          for (const [text, max] of cells) {
            const td = doc!.createElementNS(HTML_NS, "td") as HTMLElement;
            td.textContent = quotePreview(text, max);
            if (text) td.title = text;
            td.style.cssText =
              "white-space:nowrap;overflow:hidden;border-bottom:1px solid #eee;padding:5px 8px;";
            tr.appendChild(td);
          }
          table.appendChild(tr);
        }
        return table;
      };

      const renderReconcileForm = async (round: ConsistencyRound) => {
        if (!contentEl) return;
        setStatus(getString("consistency-loading"));
        let result: HumanConsistencyResult;
        try {
          result = await computeRoundConsistency(round);
        } catch (e: any) {
          setError(e);
          return;
        }
        setStatus("");

        const summary = doc!.createElementNS(HTML_NS, "div") as HTMLElement;
        const kappaText =
          result.kappa === null
            ? getString("consistency-kappa-na")
            : `${result.kappa.toFixed(2)} (${EvidenceCommands.consistencyKappaLevelLabel(result.kappa)})`;
        for (const line of [
          `${getString("human-consistency-reviewers-label")}: ${result.reviewerA || "?"} / ${result.reviewerB || "?"}`,
          getString("consistency-summary-n", { args: { n: result.n } }),
          getString("consistency-summary-agreement", {
            args: { pct: ((result.observedAgreement ?? 0) * 100).toFixed(1) },
          }),
          `${getString("consistency-summary-kappa-label")}: ${kappaText}`,
        ]) {
          const p = doc!.createElementNS(HTML_NS, "p") as HTMLElement;
          p.style.cssText = "margin:2px 0;";
          p.textContent = line;
          summary.appendChild(p);
        }
        contentEl.appendChild(summary);

        contentEl.appendChild(
          buildStatsTable(
            [
              getString("consistency-col-category"),
              getString("consistency-col-agreement"),
              getString("consistency-col-kappa"),
            ],
            result.byCategory.map((c) => [
              [EvidenceCommands.consistencyDecisionLabel(c.category), 24],
              [`${(c.observedAgreement * 100).toFixed(1)}%`, 12],
              [c.kappa === null ? "—" : c.kappa.toFixed(2), 8],
            ]),
          ),
        );

        const table = doc!.createElementNS(
          HTML_NS,
          "table",
        ) as HTMLTableElement;
        table.style.cssText =
          "width:100%;border-collapse:collapse;margin-top:6px;";
        const headRow = doc!.createElementNS(HTML_NS, "tr");
        for (const label of [
          getString("consistency-col-title"),
          getString("human-consistency-col-a"),
          getString("human-consistency-col-b"),
          getString("human-consistency-col-final"),
        ]) {
          const th = doc!.createElementNS(HTML_NS, "th") as HTMLElement;
          th.textContent = label;
          th.style.cssText =
            "text-align:left;white-space:nowrap;font-weight:600;font-size:0.85em;color:#666;background:#f2f2f2;border-bottom:1px solid #ccc;padding:5px 8px;";
          headRow.appendChild(th);
        }
        table.appendChild(headRow);

        const decisionOptions =
          round.stage === "ta_screening"
            ? ["include", "exclude", "unclear"]
            : ["include", "exclude", "unavailable"];
        const selectByItemKey = new Map<string, HTMLSelectElement>();

        for (const it of result.items) {
          const tr = doc!.createElementNS(HTML_NS, "tr");
          const disagree =
            it.aDecision !== null &&
            it.bDecision !== null &&
            it.aDecision !== it.bDecision;
          if (disagree) tr.setAttribute("style", "background:#fff4e5;");

          const titleTd = doc!.createElementNS(HTML_NS, "td") as HTMLElement;
          titleTd.textContent = quotePreview(it.title, 46);
          if (it.title) titleTd.title = it.title;
          titleTd.style.cssText =
            "white-space:nowrap;overflow:hidden;max-width:260px;border-bottom:1px solid #eee;padding:5px 8px;";
          tr.appendChild(titleTd);

          for (const val of [it.aDecision, it.bDecision]) {
            const td = doc!.createElementNS(HTML_NS, "td") as HTMLElement;
            td.textContent = val
              ? EvidenceCommands.consistencyDecisionLabel(val)
              : "—";
            td.style.cssText =
              "white-space:nowrap;border-bottom:1px solid #eee;padding:5px 8px;";
            tr.appendChild(td);
          }

          const finalTd = doc!.createElementNS(HTML_NS, "td") as HTMLElement;
          const select = doc!.createElementNS(
            HTML_NS,
            "select",
          ) as HTMLSelectElement;
          const blankOpt = doc!.createElementNS(
            HTML_NS,
            "option",
          ) as HTMLOptionElement;
          blankOpt.value = "";
          blankOpt.textContent = getString("human-consistency-final-unset");
          select.appendChild(blankOpt);
          for (const opt of decisionOptions) {
            const o = doc!.createElementNS(
              HTML_NS,
              "option",
            ) as HTMLOptionElement;
            o.value = opt;
            o.textContent = EvidenceCommands.consistencyDecisionLabel(opt);
            select.appendChild(o);
          }
          // Agreed items default to that agreed value; disagreements are
          // left blank so the coordinator has to make an explicit call.
          if (!disagree && it.aDecision) select.value = it.aDecision;
          finalTd.appendChild(select);
          finalTd.style.cssText =
            "border-bottom:1px solid #eee;padding:5px 8px;";
          tr.appendChild(finalTd);
          table.appendChild(tr);

          selectByItemKey.set(it.itemKey, select);
        }
        contentEl.appendChild(table);

        const applyBtn = doc!.createElementNS(
          HTML_NS,
          "button",
        ) as HTMLButtonElement;
        applyBtn.setAttribute("type", "button");
        applyBtn.textContent = getString("human-consistency-apply-button");
        applyBtn.style.cssText = "display:block;margin-top:10px;";
        contentEl.appendChild(applyBtn);

        applyBtn.addEventListener("click", async () => {
          const resolutions: ConsistencyResolution[] = [];
          for (const [itemKey, select] of selectByItemKey) {
            if (select.value)
              resolutions.push({ itemKey, decision: select.value });
          }
          applyBtn.setAttribute("disabled", "true");
          setStatus(getString("consistency-loading"));
          try {
            await applyReconciliation(round, resolutions);
            setStatus("");
            await renderState();
          } catch (e: any) {
            setError(e);
          } finally {
            applyBtn.removeAttribute("disabled");
          }
        });
      };

      const renderPilotDoneForm = () => {
        if (!contentEl) return;
        const p = doc!.createElementNS(HTML_NS, "p") as HTMLElement;
        p.textContent = getString("human-consistency-pilot-done-note");
        contentEl.appendChild(p);

        const btn = doc!.createElementNS(
          HTML_NS,
          "button",
        ) as HTMLButtonElement;
        btn.setAttribute("type", "button");
        btn.textContent = getString("human-consistency-start-full-button");
        contentEl.appendChild(btn);

        btn.addEventListener("click", async () => {
          const zipPath = await chooseArchiveSavePath("full-round");
          if (!zipPath) return;
          btn.setAttribute("disabled", "true");
          setStatus(getString("consistency-loading"));
          try {
            await startFullRound(
              Number(dialogData.projectId),
              dialogData.stage as ScreeningConsistencyStage,
              zipPath,
            );
            setStatus("");
            await renderState();
          } catch (e: any) {
            setError(e);
          } finally {
            btn.removeAttribute("disabled");
          }
        });
      };

      const renderFullDoneForm = () => {
        if (!contentEl) return;
        const p = doc!.createElementNS(HTML_NS, "p") as HTMLElement;
        p.textContent = getString("human-consistency-full-done-note");
        contentEl.appendChild(p);
        renderStartForm();
      };

      const renderState = async () => {
        if (!contentEl) return;
        contentEl.innerHTML = "";
        setStatus("");
        const round = await getActiveRound(
          Number(dialogData.projectId),
          dialogData.stage as ScreeningConsistencyStage,
        );
        if (!round) {
          renderStartForm();
        } else if (round.status === "sampled") {
          renderCollectForm(round);
        } else if (round.status === "collected") {
          await renderReconcileForm(round);
        } else if (round.phase === "pilot") {
          renderPilotDoneForm();
        } else {
          renderFullDoneForm();
        }
      };

      await renderState();

      const projectSelectEl = doc?.getElementById(
        "evidence-human-consistency-project",
      ) as HTMLSelectElement | undefined;
      EvidenceCommands.watchSelectValue(
        dialogData,
        dialog.window,
        projectSelectEl,
        (value) => {
          dialogData.__reopenForProjectId = Number(value);
          dialog.window?.close();
        },
      );

      EvidenceCommands.watchSelectValue(
        dialogData,
        dialog.window,
        stageSelectEl,
        async (value) => {
          dialogData.stage = value;
          await renderState();
        },
      );

      await dialogData.unloadLock.promise;

      if (dialogData.__reopenForProjectId != null) {
        projectId = dialogData.__reopenForProjectId;
        continue;
      }
      return;
    }
  }

  private static async pickProjectForExport(
    titleKey: FluentMessageId,
  ): Promise<EvidenceProject | null> {
    const projects = await listProjects();
    if (projects.length === 0) {
      ztoolkit.getGlobal("alert")(getString("error-no-projects"));
      return null;
    }

    const dialogData: { [key: string]: any } = {
      projectId: String(projects[0].id),
    };
    const dialog = new ztoolkit.Dialog(2, 2)
      .addCell(0, 0, {
        tag: "h1",
        properties: { innerHTML: getString(titleKey) },
      })
      .addCell(1, 0, {
        tag: "label",
        namespace: "html",
        properties: { innerHTML: getString("dialog-import-project-label") },
      })
      .addCell(
        1,
        1,
        {
          tag: "select",
          namespace: "html",
          attributes: { "data-bind": "projectId", "data-prop": "value" },
          children: projects.map((p) => ({
            tag: "option",
            namespace: "html",
            properties: { value: String(p.id), innerHTML: escapeHtml(p.name) },
          })),
        },
        false,
      )
      .addButton(getString("dialog-confirm"), "confirm")
      .addButton(getString("dialog-cancel"), "cancel")
      .setDialogData(dialogData);
    EvidenceCommands.openSizedDialog(dialog, getString(titleKey), 460);

    await dialogData.unloadLock.promise;
    if (dialogData._lastButtonId !== "confirm") return null;
    return projects.find((p) => p.id === Number(dialogData.projectId)) ?? null;
  }

  private static readableTimestamp(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  }

  private static async saveExportFile(
    suggestedName: string,
    content: string,
  ): Promise<void> {
    // Stamp who exported this and when, right before the extension --
    // exports get shared/emailed around, so the filename itself should say
    // who pulled it and when without needing to open the file.
    const dotIndex = suggestedName.lastIndexOf(".");
    const base =
      dotIndex === -1 ? suggestedName : suggestedName.slice(0, dotIndex);
    const ext = dotIndex === -1 ? "" : suggestedName.slice(dotIndex);
    const stampedName = `${base}-${currentDeciderId()}-${EvidenceCommands.readableTimestamp()}${ext}`;

    const path = await new ztoolkit.FilePicker(
      getString("export-choose-destination"),
      "save",
      [["CSV (*.csv)", "*.csv"]],
      stampedName,
    ).open();
    if (!path || typeof path !== "string") return;

    Zotero.File.putContents(Zotero.File.pathToFile(path), content);
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({
        text: getString("progress-export-done"),
        type: "success",
        progress: 100,
      })
      .show();
  }

  static async exportPrismaDialog() {
    const project = await EvidenceCommands.pickProjectForExport(
      "dialog-export-prisma-title",
    );
    if (!project) return;

    const data = await computePrismaData(project.id);
    if (data.identification.totalRecords === 0) {
      ztoolkit.getGlobal("alert")(getString("error-export-no-data"));
      return;
    }
    await EvidenceCommands.saveExportFile(
      `${project.name}-prisma.csv`,
      formatPrismaCsv(data),
    );
  }

  static async exportScreeningLogDialog() {
    const project = await EvidenceCommands.pickProjectForExport(
      "dialog-export-screening-log-title",
    );
    if (!project) return;

    const csv = await exportScreeningLog(project.id);
    if (csv.split("\n").length <= 1) {
      ztoolkit.getGlobal("alert")(getString("error-export-no-data"));
      return;
    }
    await EvidenceCommands.saveExportFile(
      `${project.name}-screening-log.csv`,
      csv,
    );
  }

  static async exportCodingDataDialog() {
    const project = await EvidenceCommands.pickProjectForExport(
      "dialog-export-coding-title",
    );
    if (!project) return;

    const csv = await exportCodingData(project.id);
    if (csv.split("\n").length <= 1) {
      ztoolkit.getGlobal("alert")(getString("error-export-no-data"));
      return;
    }
    await EvidenceCommands.saveExportFile(
      `${project.name}-coding-data.csv`,
      csv,
    );
  }

  static async exportSynthesisDataDialog() {
    const project = await EvidenceCommands.pickProjectForExport(
      "dialog-export-synthesis-title",
    );
    if (!project) return;

    const csv = await exportSynthesisData(project.id);
    if (csv.split("\n").length <= 1) {
      ztoolkit.getGlobal("alert")(getString("error-export-no-data"));
      return;
    }
    await EvidenceCommands.saveExportFile(
      `${project.name}-synthesis-data.csv`,
      csv,
    );
  }
}
