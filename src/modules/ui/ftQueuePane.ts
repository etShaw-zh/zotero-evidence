import { config } from "../../../package.json";
import { getLocaleID, getString } from "../../utils/locale";
import { refreshProjectPaneContextCache } from "../project/projectContext";
import { ProjectPaneContext } from "../project/projectContext";
import {
  getLatestCriteria,
  ScreeningCriteria,
} from "../screening/criteriaService";
import {
  addManualCheck,
  computeRollup,
  confirmCheck,
  CriterionCheck,
  CriterionType,
  CriterionVerdict,
  deleteCheck,
  getConfirmedExclusionReasons,
  getCriterionChecks,
  getUnconfirmedExcludeChecks,
  linkAnnotationToCheck,
  runCriterionChecks,
  unconfirmCheck,
  updateCheck,
} from "../screening/ftCriterionCheckService";
import {
  confirmDecision,
  FTDecision,
  getScreeningState,
  markFulltextReady,
  markUnavailable,
  undoDecision,
} from "../screening/ftScreeningService";
import {
  annotationOptionLabel,
  currentDeciderId,
  decisionLabel,
  el,
  escapeHtml,
  quotePreview,
  refreshAnnotationOptions,
  refreshLibraryNativeSectionsHidden,
  renderCardHeader,
  renderPaneError,
  resolveAttachment,
  resolveContextSync,
  setNativeSectionsHidden,
  shouldHideNativeSections,
  sortAnnotationsByNewest,
} from "./paneHelpers";

const PANE_ID = "zotero-evidence-ft-queue";

/**
 * Per-CRITERION verdict wording, distinct from decisionLabel's paper-level
 * "Include"/"Exclude" -- reusing the paper-level wording here reads as if
 * each row were itself deciding to include/exclude the paper, when it's
 * really just recording whether one specific criterion was met. The
 * overall Include/Exclude call (rollup line, finalize buttons, history) is
 * a genuinely different question and keeps decisionLabel.
 *
 * "verdict" itself means "does this row count toward excluding the paper"
 * (exclude) vs "toward including it" (include) -- NOT "is the criterion
 * satisfied" in a type-neutral sense, and those two readings only agree
 * for INCLUSION criteria. An exclusion criterion is only ever recorded
 * with verdict='exclude' when it actually applies to the paper (see
 * runCriterionChecks's "skip any exclusion criterion that does not apply"
 * rule) -- so for an exclusion criterion, verdict='exclude' means the
 * criterion WAS satisfied/triggered (bad news for the paper), the reverse
 * of what verdict='exclude' means for an inclusion criterion. Wording
 * must therefore branch on criterionType, not just verdict.
 */
function criterionVerdictLabel(
  criterionType: CriterionType,
  verdict: CriterionVerdict,
): string {
  if (criterionType === "exclusion") {
    return getString(
      verdict === "exclude"
        ? "ft-queue-verdict-triggered"
        : "ft-queue-verdict-not-triggered",
    );
  }
  return getString(
    verdict === "include"
      ? "ft-queue-verdict-satisfied"
      : "ft-queue-verdict-not-satisfied",
  );
}

/**
 * Located-position helper shared by renderFtCheckRow's click handler and
 * renderFtLinkPicker's fallback -- parses a check's pendingPosition JSON,
 * tolerating a malformed/missing value the same way every other consumer
 * of this column does.
 */
function parseLocated(
  pendingPosition: string | null,
): { pageIndex: number; rects: number[][] } | null {
  if (!pendingPosition) return null;
  try {
    return JSON.parse(pendingPosition);
  } catch {
    return null;
  }
}

/** Resolves a Reader Location for a confirmed check's real annotation,
 * same reasoning as codingPane.ts's locationForAnnotation: annotationKey
 * alone can fail to navigate for an annotation materialized this render
 * cycle, so the annotation's own stored position is resolved and passed
 * alongside it as a hedge. */
function locationForCheckAnnotation(
  annotationKey: string,
  annotations: Zotero.Item[],
): _ZoteroTypes.Reader.Location {
  const location: _ZoteroTypes.Reader.Location = { annotationKey };
  const annotation = annotations.find((a) => a.key === annotationKey);
  if (annotation) {
    try {
      const pos = JSON.parse(
        annotation.annotationPosition as unknown as string,
      );
      if (typeof pos.pageIndex === "number") {
        location.pageIndex = pos.pageIndex;
        location.position = { pageIndex: pos.pageIndex, rects: pos.rects };
      }
    } catch {
      // fall through -- annotationKey-only navigation still runs
    }
  }
  return location;
}

/**
 * Compact inline "choose one of the PDF's existing highlights, link it"
 * picker -- shown on demand (toggled by clicking a check row that has
 * neither a real annotation nor an auto-located pending position) instead
 * of always taking up space, same pattern as codingPane.ts's
 * renderInlineLinkPicker. Also surfaces the AI's supporting quote (if any)
 * since a human scanning existing highlights has nothing else to go on
 * once auto-locate has already failed.
 */
function renderFtLinkPicker(
  doc: Document,
  ctx: ProjectPaneContext,
  item: Zotero.Item,
  attachment: Zotero.Item | null,
  check: CriterionCheck,
  onChanged: () => void,
): HTMLElement {
  const pickerRow = el(doc, "div", {
    classList: ["zotero-evidence-coding-link-picker"],
  }) as HTMLElement;

  pickerRow.appendChild(
    el(doc, "p", {
      classList: ["zotero-evidence-coding-ai-quote"],
      properties: {
        innerHTML: check.quote
          ? `<strong>${getString("coding-ai-quote-label")}</strong> "${escapeHtml(quotePreview(check.quote, 120))}"`
          : getString("coding-ai-quote-none"),
      },
    }),
  );

  if (!attachment) {
    pickerRow.appendChild(
      el(doc, "p", {
        properties: { innerHTML: getString("ft-queue-check-no-evidence") },
      }),
    );
    return pickerRow;
  }

  const pickerControls = el(doc, "div", {
    classList: ["zotero-evidence-coding-link-picker-controls"],
  }) as HTMLElement;
  pickerRow.appendChild(pickerControls);

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
      ...sortAnnotationsByNewest(annotations).map((a) => ({
        tag: "option",
        namespace: "html",
        properties: { value: a.key, innerHTML: annotationOptionLabel(a) },
      })),
    ],
  }) as HTMLSelectElement;
  pickerControls.appendChild(select);

  pickerControls.appendChild(
    el(doc, "button", {
      attributes: { type: "button" },
      properties: { innerHTML: getString("annotation-refresh") },
      listeners: [
        {
          type: "click",
          listener: (ev: Event) => {
            ev.stopPropagation();
            refreshAnnotationOptions(
              doc,
              select,
              attachment,
              getString("ft-queue-choose-annotation"),
            );
          },
        },
      ],
    }),
  );

  pickerControls.appendChild(
    el(doc, "button", {
      attributes: { type: "button" },
      properties: { innerHTML: getString("ft-queue-link-annotation") },
      listeners: [
        {
          type: "click",
          listener: async (ev: Event) => {
            ev.stopPropagation();
            const key = select.value;
            if (!key) {
              ztoolkit.getGlobal("alert")(
                getString("ft-queue-error-no-annotation-selected"),
              );
              return;
            }
            try {
              await linkAnnotationToCheck(
                check.id,
                item.libraryID,
                key,
                ctx.project.id,
                item.key,
              );
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

  return pickerRow;
}

/**
 * One compact row for a single criterion check -- styled after
 * codingPane.ts's renderSuggestionRow/renderConfirmedList (a colored
 * verdict badge, a truncated one-line label, a status column, and small
 * icon actions) instead of the old full-height card, so a checklist of a
 * dozen+ criteria doesn't turn the sidebar into a long scroll. Full
 * criterion text and AI reasoning are still available via the row's title
 * tooltip rather than always-rendered paragraphs.
 *
 * Passing `onChanged` renders the row interactively (flip/confirm-or-undo/
 * reject, and a click toggles the manual link picker when there's no
 * evidence yet); omitting it renders a read-only row for the decided-item
 * history view, matching the confirmed-vs-summary distinction Coding's
 * renderConfirmedList already draws.
 */
function renderFtCheckRow(
  doc: Document,
  ctx: ProjectPaneContext,
  item: Zotero.Item,
  attachment: Zotero.Item | null,
  check: CriterionCheck,
  onChanged?: () => void,
): HTMLElement {
  const wrap = el(doc, "div", {}) as HTMLElement;
  const row = el(doc, "div", {
    classList: [
      check.confirmed
        ? "zotero-evidence-confirmed-row"
        : "zotero-evidence-coding-suggestion-row",
    ],
  }) as HTMLElement;

  const symbol = check.verdict === "include" ? "✓" : "✕";
  const color = check.verdict === "include" ? "#2e7d32" : "#a33";
  row.appendChild(
    el(doc, "span", {
      classList: ["zotero-evidence-coding-badge"],
      attributes: {
        title: criterionVerdictLabel(check.criterionType, check.verdict),
      },
      properties: { innerHTML: symbol },
      styles: {
        color,
        borderColor: color,
        backgroundColor: `${color}26`,
      },
    }),
  );

  const typeLabel = getString(
    check.criterionType === "inclusion"
      ? "ft-queue-criterion-type-inclusion"
      : "ft-queue-criterion-type-exclusion",
  );
  const titleText = check.reasoning
    ? `${check.criterionText}\n\n${check.reasoning}`
    : check.criterionText;
  row.appendChild(
    el(doc, "span", {
      classList: ["zotero-evidence-coding-row-label"],
      attributes: { title: titleText },
      properties: {
        innerHTML: `<strong>[${escapeHtml(typeLabel)}]</strong> ${escapeHtml(quotePreview(check.criterionText, 60))}`,
      },
    }),
  );

  const located = parseLocated(check.pendingPosition);
  let statusText = getString("coding-needs-manual-link");
  if (check.annotationKey) {
    const annotation = attachment
      ?.getAnnotations()
      .find((a) => a.key === check.annotationKey);
    let pageLabel = "";
    if (annotation) {
      try {
        const pos = JSON.parse(
          annotation.annotationPosition as unknown as string,
        );
        if (typeof pos.pageIndex === "number") {
          pageLabel = getString("coding-page-label", {
            args: { page: pos.pageIndex + 1 },
          });
        }
      } catch {
        // no page info available -- status stays blank
      }
    }
    statusText = pageLabel;
  } else if (located) {
    statusText = getString("coding-page-label", {
      args: { page: located.pageIndex + 1 },
    });
  }
  row.appendChild(
    el(doc, "span", {
      classList: ["zotero-evidence-coding-row-status"],
      properties: { innerHTML: statusText },
    }),
  );

  if (onChanged) {
    const actions = el(doc, "div", {
      classList: ["zotero-evidence-coding-row-actions"],
    }) as HTMLElement;

    actions.appendChild(
      el(doc, "button", {
        attributes: {
          type: "button",
          title: criterionVerdictLabel(
            check.criterionType,
            check.verdict === "include" ? "exclude" : "include",
          ),
        },
        properties: { innerHTML: "⇄" },
        listeners: [
          {
            type: "click",
            listener: async (ev: Event) => {
              ev.stopPropagation();
              const next: CriterionVerdict =
                check.verdict === "include" ? "exclude" : "include";
              await updateCheck(
                check.id,
                next,
                check.reasoning,
                ctx.project.id,
                item.key,
              );
              onChanged();
            },
          },
        ],
      }),
    );

    if (!check.confirmed) {
      actions.appendChild(
        el(doc, "button", {
          attributes: {
            type: "button",
            title: getString("ft-queue-check-confirm"),
          },
          properties: { innerHTML: "✓" },
          listeners: [
            {
              type: "click",
              listener: async (ev: Event) => {
                ev.stopPropagation();
                await confirmCheck(check.id, item, ctx.project.id);
                onChanged();
              },
            },
          ],
        }),
      );
      actions.appendChild(
        el(doc, "button", {
          attributes: { type: "button", title: getString("coding-reject-one") },
          properties: { innerHTML: "✕" },
          listeners: [
            {
              type: "click",
              listener: async (ev: Event) => {
                ev.stopPropagation();
                try {
                  await deleteCheck(check.id, ctx.project.id, item.key);
                  onChanged();
                } catch (e: any) {
                  ztoolkit.getGlobal("alert")(
                    `${getString("ft-queue-checks-error")}\n${e?.message ?? e}`,
                  );
                }
              },
            },
          ],
        }),
      );
    } else {
      actions.appendChild(
        el(doc, "button", {
          attributes: {
            type: "button",
            title: getString("coding-undo-confirm"),
          },
          properties: { innerHTML: "↺" },
          listeners: [
            {
              type: "click",
              listener: async (ev: Event) => {
                ev.stopPropagation();
                await unconfirmCheck(check.id, ctx.project.id, item.key);
                onChanged();
              },
            },
          ],
        }),
      );
    }
    row.appendChild(actions);
  }

  row.addEventListener("click", () => {
    if (check.annotationKey) {
      if (!attachment) return;
      void Zotero.Reader.open(
        attachment.id,
        locationForCheckAnnotation(
          check.annotationKey,
          attachment.getAnnotations(),
        ),
      );
      return;
    }
    if (located) {
      if (!attachment) return;
      void Zotero.Reader.open(attachment.id, {
        pageIndex: located.pageIndex,
        position: { pageIndex: located.pageIndex, rects: located.rects },
      });
      return;
    }
    if (!onChanged) return; // read-only history view: nothing to link
    const existing = wrap.querySelector(".zotero-evidence-coding-link-picker");
    if (existing) {
      existing.remove();
      return;
    }
    wrap.appendChild(
      renderFtLinkPicker(doc, ctx, item, attachment, check, onChanged),
    );
  });

  wrap.appendChild(row);
  return wrap;
}

/**
 * Group card for every not-yet-confirmed check (mirrors codingPane.ts's
 * renderPendingSuggestionsCard almost exactly): a count header, one compact
 * row per check, and Reject All / Accept All batch actions in the footer.
 */
function renderFtPendingCard(
  container: HTMLElement,
  doc: Document,
  ctx: ProjectPaneContext,
  item: Zotero.Item,
  attachment: Zotero.Item | null,
  checks: CriterionCheck[],
  onChanged: () => void,
): void {
  const pending = checks.filter((c) => !c.confirmed);
  if (pending.length === 0) return;

  const card = el(doc, "div", {
    classList: ["zotero-evidence-coding-card"],
  }) as HTMLElement;

  card.appendChild(
    el(doc, "div", {
      classList: ["zotero-evidence-coding-card-header"],
      properties: {
        innerHTML: getString("coding-pending-title", {
          args: { count: pending.length },
        }),
      },
    }),
  );

  for (const check of pending) {
    card.appendChild(
      renderFtCheckRow(doc, ctx, item, attachment, check, onChanged),
    );
  }

  const footer = el(doc, "div", {
    classList: ["zotero-evidence-coding-card-footer"],
  }) as HTMLElement;

  footer.appendChild(
    el(doc, "button", {
      attributes: { type: "button" },
      properties: { innerHTML: getString("coding-reject-all") },
      listeners: [
        {
          type: "click",
          listener: async () => {
            const confirmFn = ztoolkit.getGlobal("confirm");
            if (
              !confirmFn(
                getString("coding-reject-all-confirm", {
                  args: { count: pending.length },
                }),
              )
            ) {
              return;
            }
            for (const c of pending) {
              try {
                await deleteCheck(c.id, ctx.project.id, item.key);
              } catch (e) {
                ztoolkit.log(
                  "FT-Screening reject-all failed for check",
                  c.id,
                  e,
                );
              }
            }
            onChanged();
          },
        },
      ],
    }),
  );

  footer.appendChild(
    el(doc, "button", {
      attributes: { type: "button" },
      properties: { innerHTML: getString("coding-accept-all") },
      listeners: [
        {
          type: "click",
          listener: async () => {
            // Only accepts checks that were successfully auto-located --
            // one that wasn't still needs a human to manually link an
            // annotation, same fallback confirmCheck already applies
            // per-check today, just batched here.
            let accepted = 0;
            let failed = 0;
            for (const c of pending.filter((x) => x.pendingPosition)) {
              try {
                await confirmCheck(c.id, item, ctx.project.id);
                accepted++;
              } catch (e) {
                failed++;
                ztoolkit.log(
                  "FT-Screening accept-all failed for check",
                  c.id,
                  e,
                );
              }
            }
            ztoolkit.getGlobal("alert")(
              getString("coding-accept-all-done", {
                args: { accepted, failed },
              }),
            );
            onChanged();
          },
        },
      ],
    }),
  );

  card.appendChild(footer);
  container.appendChild(card);
}

/** Compact, already-confirmed checks -- each row gets an Undo action that
 * sends it back to the pending card (see unconfirmCheck). */
function renderFtConfirmedList(
  container: HTMLElement,
  doc: Document,
  ctx: ProjectPaneContext,
  item: Zotero.Item,
  attachment: Zotero.Item | null,
  checks: CriterionCheck[],
  onChanged?: () => void,
): void {
  const confirmed = checks.filter((c) => c.confirmed);
  if (confirmed.length === 0) return;

  container.appendChild(
    el(doc, "h3", {
      properties: { innerHTML: getString("coding-confirmed-title") },
    }),
  );

  const list = el(doc, "div", {
    classList: ["zotero-evidence-confirmed-list"],
  }) as HTMLElement;
  for (const check of confirmed) {
    list.appendChild(
      renderFtCheckRow(doc, ctx, item, attachment, check, onChanged),
    );
  }
  container.appendChild(list);
}

/**
 * Inline "add a check by hand" form, collapsed behind a toggle button until
 * clicked -- for a criterion the AI missed or got wrong entirely. Mirrors
 * codingPane.ts's renderManualAddForm: the criterion is picked from the
 * project's own pre-entered inclusion/exclusion criteria via a dropdown
 * (never freehand-typed, since the standards are already fixed once
 * screening criteria are configured), with an optional annotation picker
 * alongside it -- both in one compact row instead of separate label/field
 * pairs.
 */
function renderFtManualCheckForm(
  doc: Document,
  ctx: ProjectPaneContext,
  item: Zotero.Item,
  criteria: ScreeningCriteria,
  attachment: Zotero.Item | null,
  onAdded: () => void,
): HTMLElement {
  const container = el(doc, "div", {
    classList: ["zotero-evidence-ft-manual-check"],
  }) as HTMLElement;

  const options: { type: CriterionType; index: number; text: string }[] = [
    ...criteria.inclusionCriteria.map((text, index) => ({
      type: "inclusion" as CriterionType,
      index,
      text,
    })),
    ...criteria.exclusionCriteria.map((text, index) => ({
      type: "exclusion" as CriterionType,
      index,
      text,
    })),
  ];
  if (options.length === 0) return container;

  const toggleBtn = el(doc, "button", {
    attributes: { type: "button" },
    properties: { innerHTML: getString("ft-queue-add-manual-check") },
  }) as HTMLButtonElement;

  const form = el(doc, "div", {
    classList: ["zotero-evidence-coding-form"],
  }) as HTMLElement;
  form.style.display = "none";

  const criterionSelect = el(doc, "select", {
    children: options.map((o) => ({
      tag: "option",
      namespace: "html",
      properties: {
        value: `${o.type}:${o.index}`,
        innerHTML: `[${escapeHtml(
          getString(
            o.type === "inclusion"
              ? "ft-queue-criterion-type-inclusion"
              : "ft-queue-criterion-type-exclusion",
          ),
        )}] ${escapeHtml(quotePreview(o.text, 50))}`,
      },
    })),
  }) as HTMLSelectElement;
  form.appendChild(criterionSelect);

  const verdictSelect = el(doc, "select", {
    children: [
      { tag: "option", namespace: "html", properties: { value: "include" } },
      { tag: "option", namespace: "html", properties: { value: "exclude" } },
    ],
  }) as HTMLSelectElement;
  form.appendChild(verdictSelect);

  // Verdict wording depends on the selected criterion's TYPE, not just the
  // include/exclude value (see criterionVerdictLabel) -- an inclusion
  // criterion's options read "Satisfied"/"Not satisfied", an exclusion
  // criterion's read "Triggered"/"Not triggered". Re-labels both options
  // and resets the default whenever the criterion selection changes,
  // without hard-locking the value -- a human overriding the default is
  // still a deliberate, informed choice.
  const syncVerdictForType = () => {
    const [type] = criterionSelect.value.split(":") as [CriterionType, string];
    for (const opt of Array.from(
      verdictSelect.options,
    ) as HTMLOptionElement[]) {
      opt.textContent = criterionVerdictLabel(
        type,
        opt.value as CriterionVerdict,
      );
    }
    verdictSelect.value = type === "exclusion" ? "exclude" : "include";
  };
  criterionSelect.addEventListener("change", syncVerdictForType);
  syncVerdictForType();

  const annotations = attachment ? attachment.getAnnotations() : [];
  const annotationSelect = el(doc, "select", {
    children: [
      {
        tag: "option",
        namespace: "html",
        properties: {
          value: "",
          innerHTML: getString("ft-queue-choose-annotation-optional"),
        },
      },
      ...sortAnnotationsByNewest(annotations).map((a) => ({
        tag: "option",
        namespace: "html",
        properties: { value: a.key, innerHTML: annotationOptionLabel(a) },
      })),
    ],
  }) as HTMLSelectElement;
  form.appendChild(annotationSelect);

  if (attachment) {
    form.appendChild(
      el(doc, "button", {
        attributes: { type: "button" },
        properties: { innerHTML: getString("annotation-refresh") },
        listeners: [
          {
            type: "click",
            listener: () => {
              refreshAnnotationOptions(
                doc,
                annotationSelect,
                attachment,
                getString("ft-queue-choose-annotation-optional"),
              );
            },
          },
        ],
      }),
    );
  }

  form.appendChild(
    el(doc, "button", {
      attributes: { type: "button" },
      properties: { innerHTML: getString("coding-add-manual") },
      listeners: [
        {
          type: "click",
          listener: async () => {
            const [type, indexStr] = criterionSelect.value.split(":");
            const list =
              type === "inclusion"
                ? criteria.inclusionCriteria
                : criteria.exclusionCriteria;
            const text = list[Number(indexStr)];
            if (!text) {
              ztoolkit.getGlobal("alert")(
                getString("ft-queue-manual-check-error-incomplete"),
              );
              return;
            }
            try {
              await addManualCheck(
                ctx.project.id,
                item,
                type as CriterionType,
                text,
                verdictSelect.value as CriterionVerdict,
                annotationSelect.value || null,
              );
              onAdded();
            } catch (e: any) {
              ztoolkit.getGlobal("alert")(
                `${getString("coding-error-manual-add")}\n${e?.message ?? e}`,
              );
            }
          },
        },
      ],
    }),
  );
  form.appendChild(
    el(doc, "button", {
      attributes: { type: "button" },
      properties: { innerHTML: getString("ft-queue-manual-check-cancel") },
      listeners: [
        {
          type: "click",
          listener: () => {
            form.style.display = "none";
            toggleBtn.style.display = "";
          },
        },
      ],
    }),
  );

  toggleBtn.addEventListener("click", () => {
    form.style.display = "";
    toggleBtn.style.display = "none";
  });

  container.appendChild(toggleBtn);
  container.appendChild(form);
  return container;
}

/**
 * Library tab, FT-Screen Queue role (not yet decided): the pre-screening
 * step -- PDF detection status plus explicit "mark full text available/
 * unavailable" buttons. This used to be silently auto-confirmed the moment
 * the reader tab rendered; now it's an explicit human action taken BEFORE
 * opening the reader, same reasoning as everything else in this rewrite --
 * nothing gets treated as confirmed without an actual human click.
 */
async function renderFtPreScreenArea(
  container: HTMLElement,
  doc: Document,
  ctx: ProjectPaneContext,
  item: Zotero.Item,
) {
  container.innerHTML = "";
  const [state, attachment, checks] = await Promise.all([
    getScreeningState(ctx.project.id, item.key),
    resolveAttachment(item),
    getCriterionChecks(ctx.project.id, item.key),
  ]);

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

  const rerender = () => void renderFtPreScreenArea(container, doc, ctx, item);

  if (state?.fulltextReady) {
    container.appendChild(
      el(doc, "p", {
        properties: { innerHTML: getString("ft-queue-ready-note") },
      }),
    );
    if (checks.length > 0) {
      container.appendChild(
        el(doc, "p", {
          properties: {
            innerHTML: getString("ft-queue-checks-in-progress-note", {
              args: { n: checks.length },
            }),
          },
        }),
      );
    }
  } else if (attachment) {
    container.appendChild(
      el(doc, "button", {
        attributes: { type: "button" },
        properties: { innerHTML: getString("ft-queue-mark-ready") },
        listeners: [
          {
            type: "click",
            listener: async () => {
              await markFulltextReady(ctx.project.id, item, currentDeciderId());
              rerender();
            },
          },
        ],
      }),
    );
  }

  container.appendChild(
    el(doc, "button", {
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
                currentDeciderId(),
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
    }),
  );
}

/**
 * Reader tab, FT-Screen Queue role: the full checklist workflow. Runs the
 * AI checklist, lets the human review/confirm/override each criterion
 * check, shows the AI's roll-up suggestion, and finalizes the item's
 * overall Include/Exclude decision from whichever checks are actually
 * confirmed by then (see confirmDecision in ftScreeningService.ts and this
 * function's Exclude handler below for what happens when some aren't).
 */
async function renderFtChecklistArea(
  container: HTMLElement,
  doc: Document,
  ctx: ProjectPaneContext,
  item: Zotero.Item,
) {
  container.innerHTML = "";
  const criteriaRow = await getLatestCriteria(ctx.project.id, "ft");
  if (!criteriaRow) {
    container.appendChild(
      el(doc, "p", {
        properties: { innerHTML: getString("ft-queue-no-criteria") },
        styles: { color: "var(--fill-secondary, #a33)" },
      }),
    );
    return;
  }

  const state = await getScreeningState(ctx.project.id, item.key);
  if (!state?.fulltextReady) {
    // Safety net for opening the PDF directly (bypassing the library tab's
    // button) -- still requires an explicit click, never silently assumed.
    container.appendChild(
      el(doc, "button", {
        attributes: { type: "button" },
        properties: { innerHTML: getString("ft-queue-mark-ready") },
        listeners: [
          {
            type: "click",
            listener: async () => {
              await markFulltextReady(ctx.project.id, item, currentDeciderId());
              await renderFtChecklistArea(container, doc, ctx, item);
            },
          },
        ],
      }),
    );
    return;
  }

  const rerender = async () => {
    await renderFtChecklistArea(container, doc, ctx, item);
  };

  const [attachment, checks] = await Promise.all([
    resolveAttachment(item),
    getCriterionChecks(ctx.project.id, item.key),
  ]);
  const totalInclusion = criteriaRow.criteria.inclusionCriteria.length;
  const rollup = computeRollup(checks, totalInclusion);

  const rollupLine = el(doc, "p", {
    classList: ["zotero-evidence-judgment"],
  }) as HTMLElement;
  const rollupLabel =
    rollup === "unclear"
      ? getString("ft-queue-rollup-unclear")
      : decisionLabel(rollup);
  rollupLine.innerHTML = `<strong>${escapeHtml(getString("ft-queue-rollup-label"))}</strong> ${escapeHtml(rollupLabel)}`;
  container.appendChild(rollupLine);

  const buttonRow = el(doc, "div", {
    classList: ["zotero-evidence-buttons"],
  }) as HTMLElement;

  const runBtn = el(doc, "button", {
    attributes: { type: "button" },
    properties: {
      innerHTML: getString(
        checks.length > 0 ? "ft-queue-rerun-checks" : "ft-queue-run-checks",
      ),
    },
  }) as HTMLButtonElement;
  runBtn.addEventListener("click", async () => {
    runBtn.setAttribute("disabled", "true");
    runBtn.textContent = getString("ft-queue-checks-loading");
    try {
      await runCriterionChecks(ctx.project.id, item);
      await rerender();
    } catch (e: any) {
      ztoolkit.getGlobal("alert")(
        `${getString("ft-queue-checks-error")}\n${e?.message ?? e}`,
      );
      runBtn.removeAttribute("disabled");
      runBtn.textContent = getString(
        checks.length > 0 ? "ft-queue-rerun-checks" : "ft-queue-run-checks",
      );
    }
  });
  buttonRow.appendChild(runBtn);

  buttonRow.appendChild(
    el(doc, "button", {
      attributes: { type: "button" },
      properties: { innerHTML: getString("coding-refresh") },
      listeners: [{ type: "click", listener: () => void rerender() }],
    }),
  );
  container.appendChild(buttonRow);

  container.appendChild(
    el(doc, "h3", {
      properties: { innerHTML: getString("ft-queue-checklist-title") },
    }),
  );
  if (checks.length === 0) {
    container.appendChild(
      el(doc, "p", {
        properties: { innerHTML: getString("ft-queue-checklist-empty") },
      }),
    );
  } else {
    renderFtPendingCard(
      container,
      doc,
      ctx,
      item,
      attachment,
      checks,
      () => void rerender(),
    );
    renderFtConfirmedList(
      container,
      doc,
      ctx,
      item,
      attachment,
      checks,
      () => void rerender(),
    );
  }

  container.appendChild(
    renderFtManualCheckForm(
      doc,
      ctx,
      item,
      criteriaRow.criteria,
      attachment,
      () => void rerender(),
    ),
  );

  const decisionRow = el(doc, "div", {
    classList: ["zotero-evidence-buttons", "zotero-evidence-ft-finalize-row"],
  });
  const decisions: FTDecision[] = ["include", "exclude"];
  for (const decision of decisions) {
    const isCurrent = state.decision === decision;
    decisionRow.appendChild(
      el(doc, "button", {
        attributes: { type: "button" },
        properties: { innerHTML: decisionLabel(decision) },
        classList: [
          "zotero-evidence-ft-finalize-button",
          decision,
          ...(isCurrent ? ["selected"] : []),
        ],
        listeners: [
          {
            type: "click",
            listener: async () => {
              // Both branches below hinge on whether the checklist actually
              // backs an "exclude" outcome for this item -- fetch every
              // check once, up front, rather than the old decision-specific
              // spots. Matches computeRollup's own definition of "exclude"
              // (ANY confirmed check with verdict='exclude', not just a
              // triggered EXCLUSION-type criterion): an unmet INCLUSION
              // criterion is just as valid a basis for excluding a paper --
              // arguably the more common one in practice -- even though it
              // doesn't itself populate PRISMA's itemized exclusion-reasons
              // breakdown (see getConfirmedExclusionReasons's own doc
              // comment for why that's a deliberate, separate distinction).
              const allChecks = await getCriterionChecks(
                ctx.project.id,
                item.key,
              );
              const confirmedExcludeChecks = allChecks.filter(
                (c) => c.confirmed && c.verdict === "exclude",
              );
              if (decision === "exclude") {
                // Hard gate, not a warning: an Exclude with nothing
                // confirmed behind it has no basis anyone can point back
                // to -- and if the only thing backing it were a triggered
                // EXCLUSION criterion, skipping it would also mean the
                // item never appears in PRISMA's itemized "Reason | Stage |
                // Count" breakdown (getFtReasonCounts only counts confirmed
                // ft_criterion_checks rows), silently losing that data.
                if (confirmedExcludeChecks.length === 0) {
                  ztoolkit.getGlobal("alert")(
                    getString("ft-queue-finalize-exclude-blocked-no-reason"),
                  );
                  return;
                }
                // Softer: AI suggested other exclusion matches that were
                // never reviewed. Excluding without them just means fewer
                // reasons get recorded, not zero -- a warning the user can
                // choose to proceed past, unlike the hard gate above.
                const unconfirmed = await getUnconfirmedExcludeChecks(
                  ctx.project.id,
                  item.key,
                );
                if (unconfirmed.length > 0) {
                  const proceed = ztoolkit.getGlobal("confirm")(
                    getString("ft-queue-finalize-exclude-confirm-unreviewed", {
                      args: { n: unconfirmed.length },
                    }),
                  );
                  if (!proceed) return;
                }
              } else if (confirmedExcludeChecks.length > 0) {
                // decision === "include": hard gate, not a warning -- a
                // confirmed check (of either type) already says this paper
                // should be excluded, so finalizing as Include would
                // directly contradict the project's own checklist.
                ztoolkit.getGlobal("alert")(
                  getString(
                    "ft-queue-finalize-include-blocked-exclusion-reasons",
                    { args: { n: confirmedExcludeChecks.length } },
                  ),
                );
                return;
              }
              const reasons =
                decision === "exclude"
                  ? await getConfirmedExclusionReasons(ctx.project.id, item.key)
                  : null;
              try {
                await confirmDecision(
                  ctx.project.id,
                  item,
                  ctx.collections,
                  decision,
                  currentDeciderId(),
                  reasons,
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
            },
          },
        ],
      }),
    );
  }
  container.appendChild(decisionRow);

  if (state.decision) {
    container.appendChild(
      el(doc, "p", {
        properties: {
          innerHTML: `${getString("ft-queue-decided")}: ${decisionLabel(state.decision)}`,
        },
      }),
    );
  }
}

/**
 * History view for the FT-Include/FT-Exclude/FT-Unavailable collections:
 * the AI-vs-human rollup summary, a read-only rendering of the confirmed
 * criterion checklist, and Undo. Undo is available in both tabs -- unlike
 * making the decision itself (which needs the PDF), reversing it doesn't.
 */
async function renderFtHistoryArea(
  container: HTMLElement,
  doc: Document,
  ctx: ProjectPaneContext,
  item: Zotero.Item,
) {
  container.innerHTML = "";
  const state = await getScreeningState(ctx.project.id, item.key);

  container.appendChild(
    el(doc, "h3", {
      properties: { innerHTML: getString("ft-queue-history-title") },
    }),
  );

  if (!state) {
    container.appendChild(
      el(doc, "p", {
        properties: { innerHTML: getString("ft-queue-history-none") },
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
              innerHTML: `${getString("ft-queue-history-ai")} ${decisionLabel(state.aiDecision)}`,
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

  const checks = await getCriterionChecks(ctx.project.id, item.key);
  if (checks.length > 0) {
    const attachment = await resolveAttachment(item);
    renderFtConfirmedList(container, doc, ctx, item, attachment, checks);
  }

  if (state.decision) {
    container.appendChild(
      el(doc, "p", {
        properties: {
          innerHTML: `${getString("ft-queue-history-human")} ${decisionLabel(state.decision)}`,
        },
      }),
    );

    const undoBtn = el(doc, "button", {
      attributes: { type: "button" },
      properties: { innerHTML: getString("ft-queue-undo") },
      listeners: [
        {
          type: "click",
          listener: async () => {
            try {
              await undoDecision(ctx.project.id, item, ctx.collections);
              new ztoolkit.ProgressWindow(config.addonName)
                .createLine({
                  text: getString("ft-queue-undo-done"),
                  type: "success",
                  progress: 100,
                })
                .show();
            } catch (e: any) {
              ztoolkit.getGlobal("alert")(
                `${getString("ft-queue-error-undo")}\n${e?.message ?? e}`,
              );
            }
          },
        },
      ],
    });
    container.appendChild(undoBtn);
  }
}

export function registerFtQueuePane() {
  Zotero.ItemPaneManager.registerSection({
    paneID: PANE_ID,
    pluginID: config.addonID,
    // Plain document -- FT-Screening reads the actual full-text PDF,
    // distinct from TA-Screening's abstract-level scan (magnifier.svg) and
    // Coding's tagging (tag.svg). Matches Zotero's own native item-pane
    // icon style (chrome://zotero/skin/16/universal/*.svg, tinted via
    // context-fill).
    header: {
      l10nID: getLocaleID("ft-queue-head-text"),
      icon: "chrome://zotero/skin/16/universal/page.svg",
    },
    sidenav: {
      l10nID: getLocaleID("ft-queue-sidenav-tooltip"),
      icon: "chrome://zotero/skin/16/universal/page.svg",
    },
    onItemChange: ({ item, doc, body, setEnabled }) => {
      const ctx = resolveContextSync(item);
      const relevant =
        !!ctx &&
        (ctx.role === "ft_queue" ||
          ctx.role === "ft_include" ||
          ctx.role === "ft_exclude" ||
          ctx.role === "ft_unavailable");
      setEnabled(relevant);
      // Deliberately calling shouldHideNativeSections(item) here rather
      // than reusing `ctx` above (even though they happen to agree in this
      // section, since this section's own relevance was never tabType-
      // gated) -- every registered section computing native-hide the exact
      // same way is what keeps this correct regardless of registration
      // order or how many sections exist; see that function's doc comment.
      setNativeSectionsHidden(doc, body, shouldHideNativeSections(item));
      void refreshProjectPaneContextCache();
    },
    onDestroy: ({ doc }) => {
      refreshLibraryNativeSectionsHidden(doc);
    },
    // Required for registerSection to actually succeed -- see
    // taQueuePane.ts for the empirically-confirmed reason.
    onRender: () => {},
    // Reader tab + ft_queue role: the full checklist workflow -- FT-
    // screening fundamentally requires reading the PDF to decide, so it
    // belongs where the PDF is, same reasoning as Coding's reader-tab
    // editor. Library tab + ft_queue role: the pre-screening step (mark
    // full text available/unavailable) -- doesn't need the PDF open.
    // Every other case (either tab, already-decided roles) shows the same
    // read-only history view with Undo.
    onAsyncRender: async ({ body, doc, item, tabType }) => {
      const ctx = resolveContextSync(item);
      if (
        !ctx ||
        !(
          ctx.role === "ft_queue" ||
          ctx.role === "ft_include" ||
          ctx.role === "ft_exclude" ||
          ctx.role === "ft_unavailable"
        )
      ) {
        return;
      }
      const contentArea = renderCardHeader(body, doc, item);
      try {
        if (tabType === "reader" && ctx.role === "ft_queue") {
          await renderFtChecklistArea(contentArea, doc, ctx, item);
        } else if (tabType === "library" && ctx.role === "ft_queue") {
          await renderFtPreScreenArea(contentArea, doc, ctx, item);
        } else {
          await renderFtHistoryArea(contentArea, doc, ctx, item);
        }
      } catch (e) {
        ztoolkit.log("FT-Queue pane render failed", item.key, e);
        renderPaneError(doc, contentArea, e);
      }
    },
  });
}
