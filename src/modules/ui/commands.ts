import { FluentMessageId } from "../../../typings/i10n";
import { getPref } from "../../utils/prefs";
import { getString } from "../../utils/locale";
import { runWithConcurrency } from "../../utils/concurrency";
import {
  getActiveProvider,
  setActiveProviderId,
  upsertProvider,
} from "../ai/providerConfig";
import {
  CodebookVariable,
  getLatestCodebook,
  parseCodebookCsv,
  saveCodebook,
  setCodebookLocked,
} from "../coding/codebookService";
import {
  completePilotRound,
  ConsistencySummaryRow,
  getActivePilotRound,
  startPilotRound,
} from "../coding/pilotService";
import { exportCodingData } from "../export/codingExport";
import {
  computePrismaData,
  exportScreeningLog,
  formatPrismaCsv,
} from "../export/screeningExport";
import { importLiteratureFile } from "../import/importService";
import { escapeHtml } from "./paneHelpers";
import {
  resolveProjectCollections,
  SOURCE_DATABASE_LABELS,
  SourceDatabaseLabel,
} from "../project/collectionStructure";
import {
  findProjectPaneContext,
  getRootCollectionId,
  refreshProjectPaneContextCache,
} from "../project/projectContext";
import {
  createProject,
  EvidenceProject,
  listProjects,
} from "../project/projectManager";
import { saveCriteria, ScreeningStage } from "../screening/criteriaService";
import {
  confirmDecision,
  getScreeningState,
  runAIJudgment,
} from "../screening/taScreeningService";

export class EvidenceCommands {
  static registerMenus() {
    ztoolkit.Menu.register("menuFile", { tag: "menuseparator" });
    ztoolkit.Menu.register("menuFile", {
      tag: "menuitem",
      id: "zotero-evidence-new-project",
      label: getString("menu-new-project"),
      commandListener: () => addon.hooks.onDialogEvents("evidenceNewProject"),
    });
    ztoolkit.Menu.register("menuFile", {
      tag: "menuitem",
      id: "zotero-evidence-import",
      label: getString("menu-import"),
      commandListener: () => addon.hooks.onDialogEvents("evidenceImport"),
    });
    ztoolkit.Menu.register("menuFile", {
      tag: "menuitem",
      id: "zotero-evidence-criteria",
      label: getString("menu-criteria"),
      commandListener: () => addon.hooks.onDialogEvents("evidenceCriteria"),
    });
    ztoolkit.Menu.register("menuFile", {
      tag: "menuitem",
      id: "zotero-evidence-ft-criteria",
      label: getString("menu-ft-criteria"),
      commandListener: () => addon.hooks.onDialogEvents("evidenceFtCriteria"),
    });
    ztoolkit.Menu.register("menuFile", {
      tag: "menuitem",
      id: "zotero-evidence-ai-provider",
      label: getString("menu-ai-provider"),
      commandListener: () => addon.hooks.onDialogEvents("evidenceAIProvider"),
    });
    ztoolkit.Menu.register("menuFile", {
      tag: "menuitem",
      id: "zotero-evidence-progress",
      label: getString("menu-progress"),
      commandListener: () => addon.hooks.onDialogEvents("evidenceProgress"),
    });
    ztoolkit.Menu.register("menuFile", {
      tag: "menuitem",
      id: "zotero-evidence-codebook-import",
      label: getString("menu-codebook-import"),
      commandListener: () =>
        addon.hooks.onDialogEvents("evidenceCodebookImport"),
    });
    ztoolkit.Menu.register("menuFile", {
      tag: "menuitem",
      id: "zotero-evidence-codebook-add-variable",
      label: getString("menu-codebook-add-variable"),
      commandListener: () =>
        addon.hooks.onDialogEvents("evidenceCodebookAddVariable"),
    });
    ztoolkit.Menu.register("menuFile", {
      tag: "menuitem",
      id: "zotero-evidence-codebook-view",
      label: getString("menu-codebook-view"),
      commandListener: () => addon.hooks.onDialogEvents("evidenceCodebookView"),
    });
    ztoolkit.Menu.register("menuFile", {
      tag: "menuitem",
      id: "zotero-evidence-codebook-lock",
      label: getString("menu-codebook-lock"),
      commandListener: () => addon.hooks.onDialogEvents("evidenceCodebookLock"),
    });
    ztoolkit.Menu.register("menuFile", {
      tag: "menuitem",
      id: "zotero-evidence-codebook-edit-notes",
      label: getString("menu-codebook-edit-notes"),
      commandListener: () =>
        addon.hooks.onDialogEvents("evidenceCodebookEditNotes"),
    });
    ztoolkit.Menu.register("menuFile", {
      tag: "menuitem",
      id: "zotero-evidence-pilot-start",
      label: getString("menu-pilot-start"),
      commandListener: () => addon.hooks.onDialogEvents("evidencePilotStart"),
    });
    ztoolkit.Menu.register("menuFile", {
      tag: "menuitem",
      id: "zotero-evidence-pilot-complete",
      label: getString("menu-pilot-complete"),
      commandListener: () =>
        addon.hooks.onDialogEvents("evidencePilotComplete"),
    });
    ztoolkit.Menu.register("menuFile", { tag: "menuseparator" });
    ztoolkit.Menu.register("menuFile", {
      tag: "menuitem",
      id: "zotero-evidence-export-prisma",
      label: getString("menu-export-prisma"),
      commandListener: () => addon.hooks.onDialogEvents("evidenceExportPrisma"),
    });
    ztoolkit.Menu.register("menuFile", {
      tag: "menuitem",
      id: "zotero-evidence-export-screening-log",
      label: getString("menu-export-screening-log"),
      commandListener: () =>
        addon.hooks.onDialogEvents("evidenceExportScreeningLog"),
    });
    ztoolkit.Menu.register("menuFile", {
      tag: "menuitem",
      id: "zotero-evidence-export-coding",
      label: getString("menu-export-coding"),
      commandListener: () => addon.hooks.onDialogEvents("evidenceExportCoding"),
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
  }

  static async newProjectDialog() {
    const dialogData: { [key: string]: any } = { projectName: "" };
    new ztoolkit.Dialog(3, 1)
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
      )
      .addButton(getString("dialog-confirm"), "confirm")
      .addButton(getString("dialog-cancel"), "cancel")
      .setDialogData(dialogData)
      .open(getString("dialog-new-project-title"));

    await dialogData.unloadLock.promise;
    if (dialogData._lastButtonId !== "confirm") return;

    const name = String(dialogData.projectName || "").trim();
    if (!name) {
      ztoolkit.getGlobal("alert")(getString("error-project-name-required"));
      return;
    }

    const project = await createProject(name);
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

  static async importDialog() {
    const projects = await listProjects();
    if (projects.length === 0) {
      ztoolkit.getGlobal("alert")(getString("error-no-projects"));
      return;
    }

    const dialogData: { [key: string]: any } = {
      projectId: String(projects[0].id),
      sourceLabel: SOURCE_DATABASE_LABELS[0] as string,
      filePath: "",
    };

    const dialog = new ztoolkit.Dialog(5, 2)
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
          tag: "select",
          namespace: "html",
          id: "evidence-import-source",
          attributes: { "data-bind": "sourceLabel", "data-prop": "value" },
          children: SOURCE_DATABASE_LABELS.map((label) => ({
            tag: "option",
            namespace: "html",
            properties: { value: label, innerHTML: label },
          })),
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
      .addButton(getString("dialog-confirm"), "confirm")
      .addButton(getString("dialog-cancel"), "cancel")
      .setDialogData(dialogData)
      .open(getString("dialog-import-title"));

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
      Zotero.Libraries.userLibraryID,
      project.collectionKey,
    );
    if (!rootCollection) {
      ztoolkit.getGlobal("alert")(getString("error-import-failed"));
      return;
    }

    try {
      const result = await importLiteratureFile(
        project.id,
        (rootCollection as Zotero.Collection).id,
        dialogData.sourceLabel as SourceDatabaseLabel,
        dialogData.filePath as string,
      );
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
      ztoolkit.getGlobal("alert")(
        `${getString("error-import-failed")}\n${e?.message ?? e}`,
      );
    }
  }

  static async criteriaDialog(stage: ScreeningStage = "ta") {
    const projects = await listProjects();
    if (projects.length === 0) {
      ztoolkit.getGlobal("alert")(getString("error-no-projects"));
      return;
    }

    const titleKey =
      stage === "ft" ? "dialog-ft-criteria-title" : "dialog-criteria-title";

    const dialogData: { [key: string]: any } = {
      projectId: String(projects[0].id),
      researchQuestion: "",
      inclusionCriteria: "",
      exclusionCriteria: "",
    };

    new ztoolkit.Dialog(5, 2)
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
          tag: "input",
          namespace: "html",
          attributes: {
            "data-bind": "researchQuestion",
            "data-prop": "value",
            type: "text",
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
      .setDialogData(dialogData)
      .open(getString(titleKey));

    await dialogData.unloadLock.promise;
    if (dialogData._lastButtonId !== "confirm") return;

    const toLines = (s: string) =>
      String(s || "")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

    await saveCriteria(Number(dialogData.projectId), stage, {
      researchQuestion: String(dialogData.researchQuestion || "").trim(),
      inclusionCriteria: toLines(dialogData.inclusionCriteria),
      exclusionCriteria: toLines(dialogData.exclusionCriteria),
    });

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

    new ztoolkit.Dialog(5, 2)
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
      .setDialogData(dialogData)
      .open(getString("dialog-ai-provider-title"));

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

    const rows = projects
      .map((p) => {
        const rootId = getRootCollectionId(p);
        if (rootId === null) return null;
        const collections = resolveProjectCollections(rootId);
        return {
          name: p.name,
          pending: countItems(collections.screenQueueId),
          include: countItems(collections.taIncludeId),
          exclude: countItems(collections.taExcludeId),
          unclear: countItems(collections.taUnclearId),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    const dialog = new ztoolkit.Dialog(rows.length + 2, 5).addCell(0, 0, {
      tag: "h1",
      properties: { innerHTML: getString("dialog-progress-title") },
    });
    const headers = [
      getString("dialog-progress-col-project"),
      getString("dialog-progress-col-pending"),
      getString("dialog-progress-col-include"),
      getString("dialog-progress-col-exclude"),
      getString("dialog-progress-col-unclear"),
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
      const values = [r.name, r.pending, r.include, r.exclude, r.unclear];
      values.forEach((v, col) =>
        dialog.addCell(row, col, {
          tag: "span",
          namespace: "html",
          properties: { innerHTML: escapeHtml(String(v)) },
        }),
      );
    });
    dialog
      .addButton(getString("dialog-close"), "close")
      .open(getString("dialog-progress-title"));
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
          "user",
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
      .setDialogData(dialogData)
      .open(getString("dialog-codebook-import-title"));

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

    new ztoolkit.Dialog(9, 2)
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
          tag: "input",
          namespace: "html",
          attributes: {
            "data-bind": "values",
            "data-prop": "value",
            type: "text",
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
          tag: "input",
          namespace: "html",
          attributes: {
            "data-bind": "notes",
            "data-prop": "value",
            type: "text",
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
          tag: "input",
          namespace: "html",
          attributes: {
            "data-bind": "hint",
            "data-prop": "value",
            type: "text",
          },
        },
        false,
      )
      .addButton(getString("dialog-confirm"), "confirm")
      .addButton(getString("dialog-cancel"), "cancel")
      .setDialogData(dialogData)
      .open(getString("dialog-codebook-variable-title"));

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
      .setDialogData(dialogData)
      .open(getString("dialog-codebook-view-title"));

    await Zotero.Promise.delay(50);
    const listEl = dialog.window?.document.getElementById(
      "evidence-codebook-view-list",
    );
    if (listEl) await renderList(listEl as HTMLElement);

    const selectEl = dialog.window?.document.getElementById(
      "evidence-codebook-view-project",
    );
    selectEl?.addEventListener("change", async (e: Event) => {
      dialogData.projectId = (e.target as HTMLSelectElement).value;
      if (listEl) await renderList(listEl as HTMLElement);
    });
  }

  static async pilotStartDialog() {
    const projects = await listProjects();
    if (projects.length === 0) {
      ztoolkit.getGlobal("alert")(getString("error-no-projects"));
      return;
    }

    const dialogData: { [key: string]: any } = {
      projectId: String(projects[0].id),
      sampleSize: "20",
    };

    new ztoolkit.Dialog(3, 2)
      .addCell(0, 0, {
        tag: "h1",
        properties: { innerHTML: getString("dialog-pilot-start-title") },
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
          innerHTML: getString("dialog-pilot-sample-size-label"),
        },
      })
      .addCell(
        2,
        1,
        {
          tag: "input",
          namespace: "html",
          attributes: {
            "data-bind": "sampleSize",
            "data-prop": "value",
            type: "number",
            min: "1",
          },
        },
        false,
      )
      .addButton(getString("dialog-confirm"), "confirm")
      .addButton(getString("dialog-cancel"), "cancel")
      .setDialogData(dialogData)
      .open(getString("dialog-pilot-start-title"));

    await dialogData.unloadLock.promise;
    if (dialogData._lastButtonId !== "confirm") return;

    const sampleSize = Number(dialogData.sampleSize);
    if (!Number.isFinite(sampleSize) || sampleSize <= 0) {
      ztoolkit.getGlobal("alert")(getString("error-pilot-sample-size-invalid"));
      return;
    }

    try {
      const round = await startPilotRound(
        Number(dialogData.projectId),
        Math.floor(sampleSize),
      );
      new ztoolkit.ProgressWindow(addon.data.config.addonName)
        .createLine({
          text: getString("progress-pilot-started", {
            args: {
              round: round.roundNumber,
              count: round.sampleItemKeys.length,
            },
          }),
          type: "success",
          progress: 100,
        })
        .show();
    } catch (e: any) {
      ztoolkit.log("Start pilot round failed", e);
      ztoolkit.getGlobal("alert")(e?.message ?? String(e));
    }
  }

  private static showPilotSummaryDialog(summary: ConsistencySummaryRow[]) {
    const metricLabel = (metric: string) =>
      metric === "weighted_cohen_kappa"
        ? getString("pilot-metric-weighted_cohen_kappa")
        : getString("pilot-metric-cohen_kappa");

    if (summary.length === 0) {
      new ztoolkit.Dialog(2, 1)
        .addCell(0, 0, {
          tag: "h1",
          properties: { innerHTML: getString("dialog-pilot-complete-title") },
        })
        .addCell(1, 0, {
          tag: "p",
          namespace: "html",
          properties: { innerHTML: getString("pilot-complete-no-data") },
        })
        .addButton(getString("dialog-close"), "close")
        .open(getString("dialog-pilot-complete-title"));
      return;
    }

    const dialog = new ztoolkit.Dialog(summary.length + 2, 4).addCell(0, 0, {
      tag: "h1",
      properties: { innerHTML: getString("dialog-pilot-complete-title") },
    });
    const headers = [
      getString("pilot-complete-col-variable"),
      getString("pilot-complete-col-metric"),
      getString("pilot-complete-col-kappa"),
      getString("pilot-complete-col-n"),
    ];
    headers.forEach((h, col) =>
      dialog.addCell(1, col, {
        tag: "strong",
        namespace: "html",
        properties: { innerHTML: h },
      }),
    );
    summary.forEach((s, i) => {
      const row = i + 2;
      const kappaText =
        s.kappaValue === null
          ? getString("pilot-kappa-na")
          : s.kappaValue.toFixed(3);
      const values = [
        s.variableName,
        metricLabel(s.metric),
        kappaText,
        String(s.nItems),
      ];
      values.forEach((v, col) =>
        dialog.addCell(row, col, {
          tag: "span",
          namespace: "html",
          properties: { innerHTML: escapeHtml(v) },
        }),
      );
    });
    dialog
      .addButton(getString("dialog-close"), "close")
      .open(getString("dialog-pilot-complete-title"));
  }

  static async pilotCompleteDialog() {
    const projects = await listProjects();
    if (projects.length === 0) {
      ztoolkit.getGlobal("alert")(getString("error-no-projects"));
      return;
    }

    const dialogData: { [key: string]: any } = {
      projectId: String(projects[0].id),
    };

    const dialog = new ztoolkit.Dialog(3, 1)
      .addCell(0, 0, {
        tag: "h1",
        properties: { innerHTML: getString("dialog-pilot-complete-title") },
      })
      .addCell(
        1,
        0,
        {
          tag: "select",
          namespace: "html",
          id: "evidence-pilot-complete-project",
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
          tag: "p",
          namespace: "html",
          id: "evidence-pilot-complete-status",
        },
        false,
      )
      .addButton(getString("dialog-confirm"), "confirm")
      .addButton(getString("dialog-cancel"), "cancel")
      .setDialogData(dialogData)
      .open(getString("dialog-pilot-complete-title"));

    const renderStatus = async (el: HTMLElement) => {
      const active = await getActivePilotRound(Number(dialogData.projectId));
      el.textContent = active
        ? getString("pilot-active-round-status", {
            args: {
              round: active.roundNumber,
              count: active.sampleItemKeys.length,
            },
          })
        : getString("error-no-active-pilot-round");
    };

    await Zotero.Promise.delay(50);
    const statusEl = dialog.window?.document.getElementById(
      "evidence-pilot-complete-status",
    );
    if (statusEl) await renderStatus(statusEl as HTMLElement);

    const selectEl = dialog.window?.document.getElementById(
      "evidence-pilot-complete-project",
    );
    selectEl?.addEventListener("change", async (e: Event) => {
      dialogData.projectId = (e.target as HTMLSelectElement).value;
      if (statusEl) await renderStatus(statusEl as HTMLElement);
    });

    await dialogData.unloadLock.promise;
    if (dialogData._lastButtonId !== "confirm") return;

    const active = await getActivePilotRound(Number(dialogData.projectId));
    if (!active) {
      ztoolkit.getGlobal("alert")(getString("error-no-active-pilot-round"));
      return;
    }

    const summary = await completePilotRound(active.id);
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({
        text: getString("progress-pilot-completed"),
        type: "success",
        progress: 100,
      })
      .show();
    EvidenceCommands.showPilotSummaryDialog(summary);
  }

  static async codebookLockDialog() {
    const projects = await listProjects();
    if (projects.length === 0) {
      ztoolkit.getGlobal("alert")(getString("error-no-projects"));
      return;
    }

    const dialogData: { [key: string]: any } = {
      projectId: String(projects[0].id),
    };
    let currentCodebookId: number | null = null;

    const renderStatus = async (el: HTMLElement) => {
      const codebook = await getLatestCodebook(Number(dialogData.projectId));
      currentCodebookId = codebook?.id ?? null;
      el.textContent = !codebook
        ? getString("codebook-lock-status-none")
        : codebook.locked
          ? getString("codebook-lock-status-locked")
          : getString("codebook-lock-status-unlocked");
    };

    const dialog = new ztoolkit.Dialog(3, 1)
      .addCell(0, 0, {
        tag: "h1",
        properties: { innerHTML: getString("dialog-codebook-lock-title") },
      })
      .addCell(
        1,
        0,
        {
          tag: "select",
          namespace: "html",
          id: "evidence-codebook-lock-project",
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
          tag: "p",
          namespace: "html",
          id: "evidence-codebook-lock-status",
        },
        false,
      )
      .addButton(getString("codebook-lock-action-lock"), "lock")
      .addButton(getString("codebook-lock-action-unlock"), "unlock")
      .addButton(getString("dialog-cancel"), "cancel")
      .setDialogData(dialogData)
      .open(getString("dialog-codebook-lock-title"));

    await Zotero.Promise.delay(50);
    const statusEl = dialog.window?.document.getElementById(
      "evidence-codebook-lock-status",
    );
    if (statusEl) await renderStatus(statusEl as HTMLElement);

    const selectEl = dialog.window?.document.getElementById(
      "evidence-codebook-lock-project",
    );
    selectEl?.addEventListener("change", async (e: Event) => {
      dialogData.projectId = (e.target as HTMLSelectElement).value;
      if (statusEl) await renderStatus(statusEl as HTMLElement);
    });

    await dialogData.unloadLock.promise;
    const buttonId = dialogData._lastButtonId;
    if (buttonId !== "lock" && buttonId !== "unlock") return;
    if (currentCodebookId === null) {
      ztoolkit.getGlobal("alert")(getString("codebook-lock-status-none"));
      return;
    }

    await setCodebookLocked(currentCodebookId, buttonId === "lock");
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({
        text: getString("progress-codebook-lock-changed"),
        type: "success",
        progress: 100,
      })
      .show();
  }

  static async codebookEditNotesDialog() {
    const projects = await listProjects();
    if (projects.length === 0) {
      ztoolkit.getGlobal("alert")(getString("error-no-projects"));
      return;
    }

    const dialogData: { [key: string]: any } = {
      projectId: String(projects[0].id),
      variableName: "",
      notes: "",
    };
    let currentVariables: CodebookVariable[] = [];

    const dialog = new ztoolkit.Dialog(4, 2)
      .addCell(0, 0, {
        tag: "h1",
        properties: {
          innerHTML: getString("dialog-codebook-edit-notes-title"),
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
          id: "evidence-codebook-notes-project",
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
          innerHTML: getString("dialog-codebook-edit-notes-variable-label"),
        },
      })
      .addCell(
        2,
        1,
        {
          tag: "select",
          namespace: "html",
          id: "evidence-codebook-notes-variable",
        },
        false,
      )
      .addCell(3, 0, {
        tag: "label",
        namespace: "html",
        properties: {
          innerHTML: getString("dialog-codebook-edit-notes-notes-label"),
        },
      })
      .addCell(
        3,
        1,
        {
          tag: "textarea",
          namespace: "html",
          id: "evidence-codebook-notes-textarea",
          attributes: { rows: "4", cols: "40" },
        },
        false,
      )
      .addButton(getString("dialog-confirm"), "confirm")
      .addButton(getString("dialog-cancel"), "cancel")
      .setDialogData(dialogData)
      .open(getString("dialog-codebook-edit-notes-title"));

    await Zotero.Promise.delay(50);
    const variableSelectEl = dialog.window?.document.getElementById(
      "evidence-codebook-notes-variable",
    ) as HTMLSelectElement | undefined;
    const notesEl = dialog.window?.document.getElementById(
      "evidence-codebook-notes-textarea",
    ) as HTMLTextAreaElement | undefined;

    const populateVariables = async () => {
      const codebook = await getLatestCodebook(Number(dialogData.projectId));
      currentVariables = codebook?.variables ?? [];
      if (variableSelectEl) {
        variableSelectEl.innerHTML = "";
        for (const v of currentVariables) {
          const opt = variableSelectEl.ownerDocument!.createElement("option");
          opt.value = v.name;
          opt.textContent = v.name;
          variableSelectEl.appendChild(opt);
        }
      }
      dialogData.variableName = currentVariables[0]?.name ?? "";
      dialogData.notes = currentVariables[0]?.notes ?? "";
      if (notesEl) notesEl.value = dialogData.notes;
    };

    await populateVariables();

    const projectSelectEl = dialog.window?.document.getElementById(
      "evidence-codebook-notes-project",
    );
    projectSelectEl?.addEventListener("change", async (e: Event) => {
      dialogData.projectId = (e.target as HTMLSelectElement).value;
      await populateVariables();
    });

    variableSelectEl?.addEventListener("change", (e: Event) => {
      dialogData.variableName = (e.target as HTMLSelectElement).value;
      const match = currentVariables.find(
        (v) => v.name === dialogData.variableName,
      );
      dialogData.notes = match?.notes ?? "";
      if (notesEl) notesEl.value = dialogData.notes;
    });

    notesEl?.addEventListener("input", (e: Event) => {
      dialogData.notes = (e.target as HTMLTextAreaElement).value;
    });

    await dialogData.unloadLock.promise;
    if (dialogData._lastButtonId !== "confirm") return;

    if (currentVariables.length === 0) {
      ztoolkit.getGlobal("alert")(getString("error-codebook-no-variables"));
      return;
    }

    const updatedVariables = currentVariables.map((v) =>
      v.name === dialogData.variableName
        ? { ...v, notes: String(dialogData.notes || "").trim() || undefined }
        : v,
    );

    try {
      await saveCodebook(Number(dialogData.projectId), updatedVariables);
      new ztoolkit.ProgressWindow(addon.data.config.addonName)
        .createLine({
          text: getString("progress-codebook-notes-saved"),
          type: "success",
          progress: 100,
        })
        .show();
    } catch (e: any) {
      ztoolkit.log("Save codebook notes failed", e);
      ztoolkit.getGlobal("alert")(e?.message ?? String(e));
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
    new ztoolkit.Dialog(2, 2)
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
      .setDialogData(dialogData)
      .open(getString(titleKey));

    await dialogData.unloadLock.promise;
    if (dialogData._lastButtonId !== "confirm") return null;
    return projects.find((p) => p.id === Number(dialogData.projectId)) ?? null;
  }

  private static async saveExportFile(
    suggestedName: string,
    content: string,
  ): Promise<void> {
    const path = await new ztoolkit.FilePicker(
      getString("export-choose-destination"),
      "save",
      [["CSV (*.csv)", "*.csv"]],
      suggestedName,
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
}
