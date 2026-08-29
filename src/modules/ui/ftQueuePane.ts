import { config } from "../../../package.json";
import { getLocaleID, getString } from "../../utils/locale";
import { refreshProjectPaneContextCache } from "../project/projectContext";
import { ProjectPaneContext } from "../project/projectContext";
import { getLatestCriteria } from "../screening/criteriaService";
import {
  confirmDecision,
  FTDecision,
  getScreeningState,
  linkFtAnnotation,
  markFulltextReady,
  markUnavailable,
  runAIJudgment,
  ScreeningState,
} from "../screening/ftScreeningService";
import {
  annotationOptionLabel,
  decisionLabel,
  el,
  escapeHtml,
  renderCardHeader,
  renderExcludeReasonPicker,
  renderPaneError,
  resolveAttachment,
  resolveContextSync,
  setNativeSectionsHidden,
} from "./paneHelpers";

const PANE_ID = "zotero-evidence-ft-queue";

/**
 * FTS-06's evidence-linking widget: shows the currently-linked highlight (if
 * any) with a jump button, or a picker to claim one of the PDF's existing
 * highlights as the decision's supporting evidence. linkFtAnnotation forces
 * it to the fixed orange color -- AI can't create the highlight itself (no
 * official text-to-PDF-coordinates API, see ftScreeningService.ts), so this
 * is the human-highlights-then-claims workflow already established for
 * Coding (COD-04).
 */
function renderFtEvidenceLinker(
  doc: Document,
  ctx: ProjectPaneContext,
  item: Zotero.Item,
  attachment: Zotero.Item,
  state: ScreeningState,
  onChanged: () => void,
): HTMLElement {
  const container = el(doc, "div", {
    classList: ["zotero-evidence-ft-annotation"],
  }) as HTMLElement;

  if (state.annotationKey) {
    container.appendChild(
      el(doc, "button", {
        attributes: { type: "button" },
        properties: { innerHTML: getString("ft-queue-jump-to-annotation") },
        listeners: [
          {
            type: "click",
            listener: async () => {
              // annotationKey alone can fail to navigate for an annotation
              // that was just materialized this render cycle -- the
              // reader's own live annotation index may not have caught up
              // yet even though Zotero's data layer already has it (the
              // same resolve gap "预览位置" avoids by using position
              // directly). Resolving the annotation's own stored position
              // here and passing it alongside annotationKey makes
              // navigation as reliable as the preview button in that case.
              const location: _ZoteroTypes.Reader.Location = {
                annotationKey: state.annotationKey!,
              };
              const annotation = attachment
                .getAnnotations()
                .find((a) => a.key === state.annotationKey);
              if (annotation) {
                try {
                  const pos = JSON.parse(
                    annotation.annotationPosition as unknown as string,
                  );
                  if (typeof pos.pageIndex === "number") {
                    location.pageIndex = pos.pageIndex;
                    location.position = {
                      pageIndex: pos.pageIndex,
                      rects: pos.rects,
                    };
                  }
                } catch {
                  // fall through -- annotationKey-only navigation still runs
                }
              }
              await Zotero.Reader.open(attachment.id, location);
            },
          },
        ],
      }),
    );
    container.appendChild(
      el(doc, "span", {
        classList: ["zotero-evidence-coding-confirmed"],
        properties: { innerHTML: getString("ft-queue-evidence-linked") },
      }),
    );
    return container;
  }

  if (state.pendingPosition) {
    // Auto-located but not yet confirmed (FTS-06): preview jumps to and
    // flashes the location via Zotero's native position-based navigation
    // WITHOUT creating anything -- the real highlight only gets created
    // once the human clicks Include/Exclude (see confirmDecision).
    container.appendChild(
      el(doc, "button", {
        attributes: { type: "button" },
        properties: { innerHTML: getString("ft-queue-preview-location") },
        listeners: [
          {
            type: "click",
            listener: async () => {
              const located = JSON.parse(state.pendingPosition!);
              await Zotero.Reader.open(attachment.id, {
                pageIndex: located.pageIndex,
                position: {
                  pageIndex: located.pageIndex,
                  rects: located.rects,
                },
              });
            },
          },
        ],
      }),
    );
    container.appendChild(
      el(doc, "span", {
        classList: ["zotero-evidence-coding-pending"],
        properties: { innerHTML: getString("ft-queue-pending-confirmation") },
      }),
    );
    return container;
  }

  const annotations = attachment.getAnnotations();
  const select = el(doc, "select", {
    children: [
      {
        tag: "option",
        namespace: "html",
        properties: {
          value: "",
          innerHTML: getString("ft-queue-choose-annotation"),
        },
      },
      ...annotations.map((a) => ({
        tag: "option",
        namespace: "html",
        properties: { value: a.key, innerHTML: annotationOptionLabel(a) },
      })),
    ],
  }) as HTMLSelectElement;
  container.appendChild(select);

  container.appendChild(
    el(doc, "button", {
      attributes: { type: "button" },
      properties: { innerHTML: getString("ft-queue-link-annotation") },
      listeners: [
        {
          type: "click",
          listener: async () => {
            const key = select.value;
            if (!key) {
              ztoolkit.getGlobal("alert")(
                getString("ft-queue-error-no-annotation-selected"),
              );
              return;
            }
            try {
              await linkFtAnnotation(ctx.project.id, item, key);
              onChanged();
            } catch (e: any) {
              ztoolkit.getGlobal("alert")(
                `${getString("ft-queue-error-link-annotation")}\n${e?.message ?? e}`,
              );
            }
          },
        },
      ],
    }),
  );

  return container;
}

async function renderFtContent(
  container: HTMLElement,
  doc: Document,
  ctx: ProjectPaneContext,
  item: Zotero.Item,
  attachment: Zotero.Item | null,
  state: ScreeningState | null,
  hasCriteria: boolean,
  exclusionCriteria: string[],
) {
  container.innerHTML = "";

  container.appendChild(
    el(doc, "p", {
      classList: ["zotero-evidence-attachment-status"],
      properties: {
        innerHTML: attachment
          ? getString("ft-queue-pdf-found")
          : getString("ft-queue-pdf-missing"),
      },
    }),
  );

  const rerender = async () => {
    const newState = await getScreeningState(ctx.project.id, item.key);
    await renderFtContent(
      container,
      doc,
      ctx,
      item,
      attachment,
      newState,
      hasCriteria,
      exclusionCriteria,
    );
  };

  if (!state?.fulltextReady) {
    const confirmBtn = el(doc, "button", {
      attributes: { type: "button" },
      properties: { innerHTML: getString("ft-queue-confirm-ready") },
      listeners: [
        {
          type: "click",
          listener: async () => {
            try {
              await markFulltextReady(ctx.project.id, item, "user");
              await rerender();
            } catch (e: any) {
              ztoolkit.getGlobal("alert")(
                `${getString("ft-queue-error-ready")}\n${e?.message ?? e}`,
              );
            }
          },
        },
      ],
    });
    container.appendChild(confirmBtn);
  } else if (!hasCriteria) {
    container.appendChild(
      el(doc, "p", {
        properties: { innerHTML: getString("ft-queue-no-criteria") },
        styles: { color: "var(--fill-secondary, #a33)" },
      }),
    );
  } else {
    const runAI = async () => {
      runBtn.setAttribute("disabled", "true");
      runBtn.textContent = getString("ft-queue-loading");
      try {
        await runAIJudgment(ctx.project.id, item);
        await rerender();
      } catch (e: any) {
        ztoolkit.getGlobal("alert")(
          `${getString("ft-queue-error-run-ai")}\n${e?.message ?? e}`,
        );
        runBtn.removeAttribute("disabled");
        runBtn.textContent = getString("ft-queue-run-ai");
      }
    };

    const runBtn = el(doc, "button", {
      attributes: { type: "button" },
      properties: {
        innerHTML: getString(
          state.aiDecision || state.aiReasoning
            ? "ft-queue-rerun-ai"
            : "ft-queue-run-ai",
        ),
      },
      listeners: [{ type: "click", listener: () => void runAI() }],
    }) as HTMLButtonElement;

    if (state.aiDecision) {
      container.appendChild(
        el(doc, "div", {
          classList: ["zotero-evidence-judgment"],
          children: [
            {
              tag: "strong",
              namespace: "html",
              properties: {
                innerHTML: `${getString("ft-queue-ai-suggestion")} ${decisionLabel(state.aiDecision)}`,
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
    } else if (state.aiReasoning) {
      // AI ran but the response couldn't be parsed into a decision --
      // surface the raw text so a human can decide directly (no synthesized
      // third state at the FT stage, see ftScreeningService.ts).
      container.appendChild(
        el(doc, "div", {
          classList: ["zotero-evidence-judgment"],
          children: [
            {
              tag: "strong",
              namespace: "html",
              properties: { innerHTML: getString("ft-queue-ai-unparseable") },
            },
            {
              tag: "p",
              namespace: "html",
              properties: { innerHTML: escapeHtml(state.aiReasoning) },
            },
          ],
        }),
      );
    }

    const doConfirm = async (decision: FTDecision, reason: string | null) => {
      try {
        await confirmDecision(
          ctx.project.id,
          item,
          ctx.collections,
          decision,
          "user",
          reason,
        );
        new ztoolkit.ProgressWindow(config.addonName)
          .createLine({
            text: getString("ft-queue-confirmed"),
            type: "success",
            progress: 100,
          })
          .show();
      } catch (e: any) {
        ztoolkit.getGlobal("alert")(
          `${getString("ft-queue-error-confirm")}\n${e?.message ?? e}`,
        );
      }
    };

    const excludeReasonRow = renderExcludeReasonPicker(
      doc,
      exclusionCriteria,
      (reason) => doConfirm("exclude", reason),
    );

    const buttonRow = el(doc, "div", {
      classList: ["zotero-evidence-buttons"],
    });
    const decisions: FTDecision[] = ["include", "exclude"];
    for (const decision of decisions) {
      const isCurrent =
        state.decision === decision ||
        (!state.decision && state.aiDecision === decision);
      const btn = el(doc, "button", {
        attributes: { type: "button" },
        properties: { innerHTML: decisionLabel(decision) },
        classList: isCurrent ? ["selected"] : [],
        listeners: [
          {
            type: "click",
            listener: () => {
              if (decision === "exclude") {
                excludeReasonRow.classList.add("open");
              } else {
                void doConfirm(decision, null);
              }
            },
          },
        ],
      });
      buttonRow.appendChild(btn);
    }
    container.appendChild(buttonRow);
    container.appendChild(excludeReasonRow);

    if (attachment) {
      container.appendChild(
        renderFtEvidenceLinker(
          doc,
          ctx,
          item,
          attachment,
          state,
          () => void rerender(),
        ),
      );
    }

    if (state.decision) {
      container.appendChild(
        el(doc, "p", {
          properties: {
            innerHTML: `${getString("ft-queue-decided")}: ${decisionLabel(state.decision)}`,
          },
        }),
      );
    }

    container.appendChild(runBtn);
  }

  const unavailableBtn = el(doc, "button", {
    attributes: { type: "button" },
    classList: ["zotero-evidence-unavailable-button"],
    properties: { innerHTML: getString("ft-queue-mark-unavailable") },
    listeners: [
      {
        type: "click",
        listener: async () => {
          try {
            await markUnavailable(
              ctx.project.id,
              item,
              ctx.collections,
              "user",
            );
            new ztoolkit.ProgressWindow(config.addonName)
              .createLine({
                text: getString("ft-queue-marked-unavailable"),
                type: "success",
                progress: 100,
              })
              .show();
          } catch (e: any) {
            ztoolkit.getGlobal("alert")(
              `${getString("ft-queue-error-unavailable")}\n${e?.message ?? e}`,
            );
          }
        },
      },
    ],
  });
  container.appendChild(unavailableBtn);
}

async function renderFtArea(
  container: HTMLElement,
  doc: Document,
  ctx: ProjectPaneContext,
  item: Zotero.Item,
) {
  container.innerHTML = "";
  const criteriaRow = await getLatestCriteria(ctx.project.id, "ft");
  const state = await getScreeningState(ctx.project.id, item.key);
  const attachment = await resolveAttachment(item);
  await renderFtContent(
    container,
    doc,
    ctx,
    item,
    attachment,
    state,
    !!criteriaRow,
    criteriaRow?.criteria.exclusionCriteria ?? [],
  );
}

export function registerFtQueuePane() {
  Zotero.ItemPaneManager.registerSection({
    paneID: PANE_ID,
    pluginID: config.addonID,
    header: {
      l10nID: getLocaleID("ft-queue-head-text"),
      icon: "chrome://zotero/skin/16/universal/book.svg",
    },
    sidenav: {
      l10nID: getLocaleID("ft-queue-sidenav-tooltip"),
      icon: "chrome://zotero/skin/20/universal/save.svg",
    },
    onItemChange: ({ item, doc, setEnabled, tabType }) => {
      const ctx = tabType === "library" ? resolveContextSync(item) : null;
      const relevant = !!ctx && ctx.role === "ft_queue";
      setEnabled(relevant);
      // See screenQueuePane.ts for why this must be based on ctx truthiness
      // rather than this section's own relevance -- both sections share one
      // class and Zotero calls every section's onItemChange per event, so
      // whichever runs last must not clobber the other's decision.
      setNativeSectionsHidden(doc, !!ctx);
      void refreshProjectPaneContextCache();
    },
    onDestroy: ({ doc }) => {
      setNativeSectionsHidden(doc, false);
    },
    // Required for registerSection to actually succeed -- see
    // screenQueuePane.ts for the empirically-confirmed reason.
    onRender: () => {},
    onAsyncRender: async ({ body, doc, item }) => {
      const ctx = resolveContextSync(item);
      if (!ctx || ctx.role !== "ft_queue") return;
      const contentArea = renderCardHeader(body, doc, item);
      try {
        await renderFtArea(contentArea, doc, ctx, item);
      } catch (e) {
        ztoolkit.log("FT-Queue pane render failed", item.key, e);
        renderPaneError(doc, contentArea, e);
      }
    },
  });
}
