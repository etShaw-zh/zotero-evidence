import { config } from "../../../package.json";
import { getLocaleID, getString } from "../../utils/locale";
import { getLatestCodebook } from "../coding/codebookService";
import { computeCodingStats } from "../coding/codingService";
import { computePrismaData } from "../export/screeningExport";
import {
  ProjectPaneContext,
  refreshProjectPaneContextCache,
} from "../project/projectContext";
import { getLatestCriteria } from "../screening/criteriaService";
import { EvidenceCommands } from "./commands";
import {
  el,
  escapeHtml,
  refreshLibraryNativeSectionsHidden,
  renderPaneError,
  resolveContextSync,
  setNativeSectionsHidden,
  shouldHideNativeSections,
} from "./paneHelpers";

const PANE_ID = "zotero-evidence-project-overview";

interface StageWarning {
  text: string;
  buttonLabel: string;
  onClick: () => void | Promise<void>;
}

interface StageRowOptions {
  title: string;
  statLines: string[];
  warning?: StageWarning | null;
  buttonLabel: string;
  onNavigate: () => void;
}

/**
 * Project-scoped header: just the project's own name -- unlike
 * renderCardHeader (title/authors/abstract), this pane has nothing to do
 * with whichever item happens to be selected in Sources/root, so it
 * doesn't reuse that per-item helper. No separate "Project Overview" label
 * here: the collapsible-section's own header (header.l10nID in
 * registerProjectOverviewPane below) already shows that, so repeating it in
 * the body would just be the same word twice.
 */
function renderOverviewHeader(
  body: HTMLDivElement,
  doc: Document,
  ctx: ProjectPaneContext,
): HTMLElement {
  body.innerHTML = "";
  body.classList.add("zotero-evidence-card");

  body.appendChild(
    el(doc, "h2", {
      properties: { innerHTML: escapeHtml(ctx.project.name) },
    }),
  );

  const contentArea = el(doc, "div", {
    classList: ["zotero-evidence-judgment-area"],
  }) as HTMLElement;
  body.appendChild(contentArea);
  return contentArea;
}

/** One stage row -- shared shape for all 5 rows below. */
function renderStageRow(doc: Document, opts: StageRowOptions): HTMLElement {
  const section = el(doc, "div", {
    classList: ["zotero-evidence-section"],
  }) as HTMLElement;

  section.appendChild(
    el(doc, "h3", { properties: { innerHTML: escapeHtml(opts.title) } }),
  );

  for (const line of opts.statLines) {
    section.appendChild(
      el(doc, "p", {
        classList: ["zotero-evidence-attachment-status"],
        properties: { innerHTML: escapeHtml(line) },
      }),
    );
  }

  if (opts.warning) {
    const warning = opts.warning;
    section.appendChild(
      el(doc, "div", {
        classList: ["zotero-evidence-overview-warning"],
        children: [
          {
            tag: "span",
            namespace: "html",
            properties: { innerHTML: escapeHtml(warning.text) },
          },
        ],
      }),
    );
    const warningRow = section.lastElementChild as HTMLElement;
    warningRow.appendChild(
      el(doc, "button", {
        attributes: { type: "button" },
        properties: { innerHTML: escapeHtml(warning.buttonLabel) },
        listeners: [{ type: "click", listener: () => void warning.onClick() }],
      }),
    );
  }

  const footer = el(doc, "div", {
    classList: ["zotero-evidence-overview-footer"],
  }) as HTMLElement;
  footer.appendChild(
    el(doc, "button", {
      attributes: { type: "button" },
      properties: { innerHTML: escapeHtml(opts.buttonLabel) },
      listeners: [{ type: "click", listener: () => void opts.onNavigate() }],
    }),
  );
  section.appendChild(footer);

  return section;
}

/**
 * Switches the library window's selected Collection -- collectionsView is
 * typed as `CollectionTree | false` and selectCollection() isn't in the
 * zotero-types package at all (an actual gap, not a typo -- confirmed
 * against Zotero's own chrome://zotero/content/collectionTree.js), same as
 * every other not-fully-typed Zotero-internal call already cast `as any`
 * elsewhere in this codebase (e.g. archiveImportService.ts). By the time
 * this runs, collectionsView is guaranteed real: this pane only renders
 * once an item is already selected inside one of the project's own
 * Collections, which means the collections tree is already loaded. This is
 * also the exact method test/taQueuePane.test.ts (and its FT/Coding
 * siblings) already drive from outside the plugin to switch collections.
 */
function goToCollection(collectionId: number): void {
  const ZoteroPaneGlobal = ztoolkit.getGlobal("ZoteroPane");
  (ZoteroPaneGlobal.collectionsView as any).selectCollection(collectionId);
}

/**
 * Assembles all 5 stage rows from data every one of these already computes
 * elsewhere -- computePrismaData/computeCodingStats are the exact same
 * calls EvidenceCommands.progressDialog() makes for its all-projects table,
 * and getLatestCriteria/getLatestCodebook are the same "is this stage even
 * configured yet" checks the TA-Queue/FT-Queue/Coding panes already use.
 * No new aggregate queries.
 */
async function renderOverviewArea(
  container: HTMLElement,
  doc: Document,
  ctx: ProjectPaneContext,
): Promise<void> {
  container.innerHTML = "";

  const [prisma, coding, taCriteria, ftCriteria, codebook] = await Promise.all([
    computePrismaData(ctx.project.id),
    computeCodingStats(ctx.project.id),
    getLatestCriteria(ctx.project.id, "ta"),
    getLatestCriteria(ctx.project.id, "ft"),
    getLatestCodebook(ctx.project.id),
  ]);

  const rerender = () => renderOverviewArea(container, doc, ctx);

  container.appendChild(
    renderStageRow(doc, {
      title: getString("overview-stage-sources-title"),
      statLines: [
        getString("overview-sources-unique", {
          args: { count: prisma.identification.uniqueRecords },
        }),
        getString("overview-sources-breakdown", {
          args: {
            total: prisma.identification.totalRecords,
            duplicates: prisma.identification.duplicatesRemoved,
          },
        }),
      ],
      buttonLabel: getString("overview-button-enter"),
      onNavigate: () => goToCollection(ctx.collections.sourcesId),
    }),
  );

  container.appendChild(
    renderStageRow(doc, {
      title: getString("overview-stage-ta-title"),
      statLines: [
        getString("overview-ta-pending", {
          args: { count: prisma.screening.pending },
        }),
        getString("overview-ta-breakdown", {
          args: {
            include: prisma.screening.includedToFt,
            exclude: prisma.screening.excluded,
            unclear: prisma.screening.unclearToFt,
          },
        }),
      ],
      warning: taCriteria
        ? null
        : {
            text: getString("overview-warning-no-criteria"),
            buttonLabel: getString("overview-warning-set-criteria-button"),
            onClick: async () => {
              await EvidenceCommands.criteriaDialog();
              await rerender();
            },
          },
      buttonLabel: getString("overview-button-enter"),
      onNavigate: () => goToCollection(ctx.collections.taQueueId),
    }),
  );

  container.appendChild(
    renderStageRow(doc, {
      title: getString("overview-stage-ft-title"),
      statLines: [
        getString("overview-ft-retrieval", {
          args: {
            sought: prisma.retrieval.soughtForRetrieval,
            notRetrieved: prisma.retrieval.notRetrieved,
          },
        }),
        getString("overview-ft-eligibility", {
          args: {
            assessed: prisma.eligibility.assessedForEligibility,
            pending: prisma.eligibility.pending,
            excluded: prisma.eligibility.excluded,
          },
        }),
      ],
      warning: ftCriteria
        ? null
        : {
            text: getString("overview-warning-no-criteria"),
            buttonLabel: getString("overview-warning-set-criteria-button"),
            onClick: async () => {
              await EvidenceCommands.criteriaDialog();
              await rerender();
            },
          },
      buttonLabel: getString("overview-button-enter"),
      onNavigate: () => goToCollection(ctx.collections.ftQueueId),
    }),
  );

  container.appendChild(
    renderStageRow(doc, {
      title: getString("overview-stage-final-title"),
      statLines: [
        getString("overview-final-count", {
          args: { count: prisma.included.finalStudies },
        }),
      ],
      buttonLabel: getString("overview-button-view"),
      onNavigate: () => goToCollection(ctx.collections.ftIncludeId),
    }),
  );

  container.appendChild(
    renderStageRow(doc, {
      title: getString("overview-stage-coding-title"),
      statLines: [
        getString("overview-coding-progress", {
          args: {
            confirmed: coding.itemsWithConfirmedEvidence,
            total: coding.totalInCoding,
          },
        }),
      ],
      warning:
        !codebook || codebook.variables.length === 0
          ? {
              text: getString("overview-warning-no-codebook"),
              buttonLabel: getString("overview-warning-import-codebook-button"),
              onClick: async () => {
                await EvidenceCommands.codebookImportDialog();
                await rerender();
              },
            }
          : null,
      buttonLabel: getString("overview-button-enter"),
      onNavigate: () => goToCollection(ctx.collections.codingId),
    }),
  );
}

export function registerProjectOverviewPane() {
  Zotero.ItemPaneManager.registerSection({
    paneID: PANE_ID,
    pluginID: config.addonID,
    // No "compass"/dashboard icon exists in Zotero's built-in icon set --
    // list-number.svg is the closest literal match for this pane's actual
    // content (a numbered list of pipeline stages), distinct from TA's
    // scan (magnifier.svg), FT's document read (page.svg), and Coding's
    // tagging (tag.svg).
    header: {
      l10nID: getLocaleID("overview-head-text"),
      icon: "chrome://zotero/skin/16/universal/list-number.svg",
    },
    sidenav: {
      l10nID: getLocaleID("overview-sidenav-tooltip"),
      icon: "chrome://zotero/skin/16/universal/list-number.svg",
    },
    onItemChange: ({ item, doc, body, setEnabled, tabType }) => {
      const ctx = tabType === "library" ? resolveContextSync(item) : null;
      setEnabled(!!ctx && ctx.role === "other");
      // Deliberately NOT derived from `ctx` above -- that's gated by
      // tabType for this section's OWN relevance (role "other" never
      // applies in the reader), but native-hide must be computed the same
      // way regardless of which section or tabType is asking. This
      // section used to skip the call entirely for tabType "reader" to
      // avoid clobbering Coding's decision there (registration order made
      // it the last to run) -- shouldHideNativeSections replaces that
      // order-dependent workaround: every section computing the identical
      // value means order stops mattering at all.
      setNativeSectionsHidden(doc, body, shouldHideNativeSections(item));
      void refreshProjectPaneContextCache();
    },
    onDestroy: ({ doc }) => {
      refreshLibraryNativeSectionsHidden(doc);
    },
    // Required for registerSection to actually succeed -- see
    // taQueuePane.ts for the empirically-confirmed reason.
    onRender: () => {},
    onAsyncRender: async ({ body, doc, item }) => {
      const ctx = resolveContextSync(item);
      if (!ctx || ctx.role !== "other") return;
      const contentArea = renderOverviewHeader(body, doc, ctx);
      try {
        await renderOverviewArea(contentArea, doc, ctx);
      } catch (e) {
        ztoolkit.log("Project Overview pane render failed", item.key, e);
        renderPaneError(doc, contentArea, e);
      }
    },
  });
}
