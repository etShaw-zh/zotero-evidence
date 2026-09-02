import { config } from "../../../package.json";
import { getLocaleID, getString } from "../../utils/locale";
import { getConsistencyItemResult } from "../consistency/consistencyItemResultsService";
import { refreshProjectPaneContextCache } from "../project/projectContext";
import { ProjectPaneContext } from "../project/projectContext";
import { getLatestCriteria } from "../screening/criteriaService";
import {
  confirmDecision,
  getScreeningState,
  runAIJudgment,
  ScreeningState,
  TADecision,
  undoDecision,
} from "../screening/taScreeningService";
import {
  currentDeciderId,
  decisionLabel,
  el,
  escapeHtml,
  refreshLibraryNativeSectionsHidden,
  renderCardHeader,
  renderPaneError,
  resolveContextSync,
  setNativeSectionsHidden,
} from "./paneHelpers";

const PANE_ID = "zotero-evidence-screen-queue";

async function renderJudgmentArea(
  container: HTMLElement,
  doc: Document,
  ctx: ProjectPaneContext,
  item: Zotero.Item,
) {
  container.innerHTML = "";

  const criteriaRow = await getLatestCriteria(ctx.project.id, "ta");
  if (!criteriaRow) {
    container.appendChild(
      el(doc, "p", {
        properties: { innerHTML: getString("screen-queue-no-criteria") },
        styles: { color: "var(--fill-secondary, #a33)" },
      }),
    );
    return;
  }

  const state = await getScreeningState(ctx.project.id, item.key);
  await renderJudgmentContent(container, doc, ctx, item, state);
}

async function renderJudgmentContent(
  container: HTMLElement,
  doc: Document,
  ctx: ProjectPaneContext,
  item: Zotero.Item,
  state: ScreeningState | null,
) {
  container.innerHTML = "";

  const runAI = async () => {
    runBtn.setAttribute("disabled", "true");
    runBtn.textContent = getString("screen-queue-loading");
    try {
      const result = await runAIJudgment(ctx.project.id, item);
      const newState: ScreeningState = {
        id: result.screeningRecordId,
        aiDecision: result.decision,
        aiReasoning: result.reasoning,
        decision: null,
        exclusionReason: null,
      };
      await renderJudgmentContent(container, doc, ctx, item, newState);
    } catch (e: any) {
      ztoolkit.getGlobal("alert")(
        `${getString("screen-queue-error-run-ai")}\n${e?.message ?? e}`,
      );
      runBtn.removeAttribute("disabled");
      runBtn.textContent = getString("screen-queue-run-ai");
    }
  };

  const runBtn = el(doc, "button", {
    attributes: { type: "button" },
    properties: { innerHTML: getString("screen-queue-run-ai") },
    listeners: [{ type: "click", listener: () => void runAI() }],
  }) as HTMLButtonElement;

  // If this item was part of a human-human consistency round and the two
  // reviewers disagreed (an agreed item never reaches here -- it was
  // already applied as this project's real result and left the queue, see
  // humanConsistencyService.ts's applyAgreedResults), show both reviewers'
  // own calls so whoever screens it next (a third opinion) has that
  // context without leaving this pane. Rendered before the state==null
  // early return below -- a disagreement can easily still be sitting here
  // with no local AI judgment run yet.
  const consistencyResult = await getConsistencyItemResult(
    ctx.project.id,
    item.key,
  );
  const formatReviewerLine = (
    label: string,
    reviewerName: string,
    verdict: "include" | "exclude" | null,
    reason: string,
  ): string | null => {
    if (!verdict) return null;
    const who = reviewerName ? `${label} (${escapeHtml(reviewerName)})` : label;
    const reasonHtml =
      verdict === "exclude" && reason
        ? ` — ${getString("screen-queue-consistency-reason", { args: { reason: escapeHtml(reason) } })}`
        : "";
    return `${who}: ${decisionLabel(verdict)}${reasonHtml}`;
  };
  const reviewerLines = consistencyResult
    ? [
        formatReviewerLine(
          getString("screen-queue-consistency-reviewer-a"),
          consistencyResult.aReviewer,
          consistencyResult.aVerdict,
          consistencyResult.aExclusionReason,
        ),
        formatReviewerLine(
          getString("screen-queue-consistency-reviewer-b"),
          consistencyResult.bReviewer,
          consistencyResult.bVerdict,
          consistencyResult.bExclusionReason,
        ),
      ].filter((line): line is string => line !== null)
    : [];
  if (reviewerLines.length > 0) {
    container.appendChild(
      el(doc, "div", {
        classList: ["zotero-evidence-section"],
        children: [
          {
            tag: "h3",
            namespace: "html",
            properties: {
              innerHTML: getString("screen-queue-consistency-title"),
            },
          },
          ...reviewerLines.map((line) => ({
            tag: "p",
            namespace: "html" as const,
            properties: { innerHTML: line },
          })),
        ],
      }),
    );
  }

  if (state?.aiDecision) {
    container.appendChild(
      el(doc, "div", {
        classList: ["zotero-evidence-judgment"],
        children: [
          {
            tag: "strong",
            namespace: "html",
            properties: {
              innerHTML: `${getString("screen-queue-ai-suggestion")} ${decisionLabel(state.aiDecision)}`,
            },
          },
          {
            tag: "p",
            namespace: "html",
            properties: { innerHTML: escapeHtml(state.aiReasoning || "") },
          },
        ],
      }),
    );
  }

  // AI judgment is optional -- a reviewer who doesn't want or need it
  // should still be able to decide directly, so these buttons don't wait
  // on `state` existing at all. confirmDecision's screeningRecordId is
  // null in that case, which it already handles by inserting a fresh
  // human-only screening_records row (no ai_decision) rather than
  // requiring an existing one to update.
  const doConfirm = async (decision: TADecision, reason: string | null) => {
    try {
      await confirmDecision(
        ctx.project.id,
        item,
        ctx.collections,
        state?.id ?? null,
        decision,
        currentDeciderId(),
        reason,
      );
      new ztoolkit.ProgressWindow(config.addonName)
        .createLine({
          text: getString("screen-queue-confirmed"),
          type: "success",
          progress: 100,
        })
        .show();
    } catch (e: any) {
      ztoolkit.getGlobal("alert")(
        `${getString("screen-queue-error-confirm")}\n${e?.message ?? e}`,
      );
    }
  };

  const buttonRow = el(doc, "div", { classList: ["zotero-evidence-buttons"] });
  const decisions: TADecision[] = ["include", "exclude", "unclear"];
  for (const decision of decisions) {
    const isCurrent =
      state?.decision === decision ||
      (!state?.decision && state?.aiDecision === decision);
    const btn = el(doc, "button", {
      attributes: { type: "button" },
      properties: { innerHTML: decisionLabel(decision) },
      classList: isCurrent ? ["selected"] : [],
      listeners: [
        { type: "click", listener: () => void doConfirm(decision, null) },
      ],
    });
    buttonRow.appendChild(btn);
  }
  container.appendChild(buttonRow);

  if (state?.decision) {
    container.appendChild(
      el(doc, "p", {
        properties: {
          innerHTML: `${getString("screen-queue-decided")}: ${decisionLabel(state.decision)}`,
        },
      }),
    );
  }

  runBtn.textContent = getString(
    state?.aiDecision ? "screen-queue-rerun-ai" : "screen-queue-run-ai",
  );
  container.appendChild(runBtn);
}

/**
 * Read-only history view for the TA-Include/TA-Exclude/TA-Unclear
 * collections (PNL-04): shows the screening_records trail instead of
 * editable controls.
 */
async function renderHistoryArea(
  container: HTMLElement,
  doc: Document,
  ctx: ProjectPaneContext,
  item: Zotero.Item,
) {
  container.innerHTML = "";
  const state = await getScreeningState(ctx.project.id, item.key);

  container.appendChild(
    el(doc, "h3", {
      properties: { innerHTML: getString("screen-queue-history-title") },
    }),
  );

  if (!state) {
    container.appendChild(
      el(doc, "p", {
        properties: { innerHTML: getString("screen-queue-history-none") },
      }),
    );
    return;
  }

  if (state.aiDecision) {
    container.appendChild(
      el(doc, "div", {
        classList: ["zotero-evidence-judgment"],
        children: [
          {
            tag: "strong",
            namespace: "html",
            properties: {
              innerHTML: `${getString("screen-queue-history-ai")} ${decisionLabel(state.aiDecision)}`,
            },
          },
          {
            tag: "p",
            namespace: "html",
            properties: { innerHTML: escapeHtml(state.aiReasoning || "") },
          },
        ],
      }),
    );
  }

  if (state.decision) {
    container.appendChild(
      el(doc, "p", {
        properties: {
          innerHTML: `${getString("screen-queue-history-human")} ${decisionLabel(state.decision)}`,
        },
      }),
    );

    const undoBtn = el(doc, "button", {
      attributes: { type: "button" },
      properties: { innerHTML: getString("screen-queue-undo") },
      listeners: [
        {
          type: "click",
          listener: async () => {
            try {
              await undoDecision(ctx.project.id, item, ctx.collections);
              new ztoolkit.ProgressWindow(config.addonName)
                .createLine({
                  text: getString("screen-queue-undo-done"),
                  type: "success",
                  progress: 100,
                })
                .show();
            } catch (e: any) {
              ztoolkit.getGlobal("alert")(
                `${getString("screen-queue-error-undo")}\n${e?.message ?? e}`,
              );
            }
          },
        },
      ],
    });
    container.appendChild(undoBtn);
  }
}

export function registerScreenQueuePane() {
  Zotero.ItemPaneManager.registerSection({
    paneID: PANE_ID,
    pluginID: config.addonID,
    // Magnifier -- TA-Screening is a quick title/abstract scan, distinct
    // from FT-Screening's full-document read (page.svg) and Coding's
    // tagging (tag.svg). Matches Zotero's own native item-pane icon style
    // (chrome://zotero/skin/16/universal/*.svg, tinted via context-fill).
    header: {
      l10nID: getLocaleID("screen-queue-head-text"),
      icon: "chrome://zotero/skin/16/universal/magnifier.svg",
    },
    sidenav: {
      l10nID: getLocaleID("screen-queue-sidenav-tooltip"),
      icon: "chrome://zotero/skin/16/universal/magnifier.svg",
    },
    onItemChange: ({ item, doc, body, setEnabled, tabType }) => {
      // Must decide synchronously: Zotero renders based on this call's
      // result before any promise from here would resolve, so the lookup
      // has to be a synchronous cache read, not a fresh async DB query.
      const ctx = tabType === "library" ? resolveContextSync(item) : null;
      const relevant =
        !!ctx &&
        (ctx.role === "screen_queue" ||
          ctx.role === "ta_include" ||
          ctx.role === "ta_exclude" ||
          ctx.role === "ta_unclear");
      setEnabled(relevant);
      // Native-hide is a single shared class on the pane container that
      // both this section and ftQueuePane's toggle. Base it on "is this
      // item in ANY of our project collections" (ctx truthy) rather than
      // this section's own relevance -- otherwise, since Zotero calls every
      // registered section's onItemChange for the same event, whichever
      // section's hook runs last would clobber the other's decision back
      // off, and the two sections don't always agree on section-specific
      // relevance for the same collection.
      setNativeSectionsHidden(doc, body, !!ctx);
      // Keep the cache warm for next time in case it's gone stale (e.g. a
      // project was created/renamed since the last refresh).
      void refreshProjectPaneContextCache();
    },
    onDestroy: ({ doc }) => {
      refreshLibraryNativeSectionsHidden(doc);
    },
    // registerSection silently fails (returns false, no section is created
    // at all) without a synchronous onRender -- onAsyncRender alone isn't
    // enough, confirmed empirically. Keep this even though the real content
    // is built in onAsyncRender below.
    onRender: () => {},
    onAsyncRender: async ({ body, doc, item }) => {
      const ctx = resolveContextSync(item);
      if (
        !ctx ||
        !(
          ctx.role === "screen_queue" ||
          ctx.role === "ta_include" ||
          ctx.role === "ta_exclude" ||
          ctx.role === "ta_unclear"
        )
      ) {
        return;
      }
      const contentArea = renderCardHeader(body, doc, item);
      try {
        if (ctx.role === "screen_queue") {
          await renderJudgmentArea(contentArea, doc, ctx, item);
        } else {
          await renderHistoryArea(contentArea, doc, ctx, item);
        }
      } catch (e) {
        ztoolkit.log("Screen Queue pane render failed", item.key, e);
        renderPaneError(doc, contentArea, e);
      }
    },
  });
}
