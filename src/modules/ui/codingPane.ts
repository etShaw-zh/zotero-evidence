import { config } from "../../../package.json";
import { getLocaleID, getString } from "../../utils/locale";
import { CodebookVariable, getLatestCodebook } from "../coding/codebookService";
import {
  addManualRecord,
  CodingRecord,
  confirmRecord,
  deleteRecord,
  generateSuggestions,
  getCodingProgress,
  getCodingRecords,
  linkAnnotationToRecord,
  unconfirmRecord,
} from "../coding/codingService";
import { ProjectPaneContext } from "../project/projectContext";
import { safeGetField } from "../../utils/zoteroItem";
import {
  annotationOptionLabel,
  el,
  escapeHtml,
  quotePreview,
  renderCardHeader,
  renderPaneError,
  resolveAttachment,
  resolveContextSync,
  setNativeSectionsHidden,
} from "./paneHelpers";

const PANE_ID = "zotero-evidence-coding";

// Purely a visual grouping aid (no semantic meaning): a variable's multiple
// values all hash to the same color/letter, so a scan of the pending card
// can tell at a glance which rows belong to the same variable.
const BADGE_PALETTE = [
  "#4c8bf5",
  "#34a853",
  "#f9a13c",
  "#9b59b6",
  "#16a3a3",
  "#e0648b",
];

function badgeColorForVariable(name: string): string {
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
  return BADGE_PALETTE[sum % BADGE_PALETTE.length];
}

function renderBadge(
  doc: Document,
  letter: string,
  color: string,
): HTMLElement {
  return el(doc, "span", {
    classList: ["zotero-evidence-coding-badge"],
    properties: { innerHTML: letter },
    styles: {
      color,
      borderColor: color,
      backgroundColor: `${color}26`,
    },
  }) as HTMLElement;
}

/**
 * Resolve a Location that navigates reliably to a confirmed record's real
 * annotation. annotationKey alone can fail to navigate for an annotation
 * that was just materialized this render cycle -- the reader's own live
 * annotation index may not have caught up yet even though Zotero's data
 * layer already has it. Resolving the annotation's own stored position here
 * and passing it alongside annotationKey hedges against that gap.
 */
function locationForAnnotation(
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

/** Compact inline "choose one of the PDF's existing highlights, link it"
 * picker -- same manual-linking fallback as before, just shown on demand
 * (toggled by clicking a not-yet-located suggestion row) instead of always
 * taking up space. */
function renderInlineLinkPicker(
  doc: Document,
  item: Zotero.Item,
  annotations: Zotero.Item[],
  record: CodingRecord,
  onChanged: () => void,
): HTMLElement {
  const pickerRow = el(doc, "div", {
    classList: ["zotero-evidence-coding-link-picker"],
  }) as HTMLElement;

  // Auto-locate failed to place this suggestion in the PDF (that's why
  // manual linking is needed at all), so the human has nothing to go on
  // when scanning existing highlights unless the AI's own supporting quote
  // is shown here too.
  pickerRow.appendChild(
    el(doc, "p", {
      classList: ["zotero-evidence-coding-ai-quote"],
      properties: {
        innerHTML: record.quote
          ? `<strong>${getString("coding-ai-quote-label")}</strong> "${escapeHtml(quotePreview(record.quote, 120))}"`
          : getString("coding-ai-quote-none"),
      },
    }),
  );

  const pickerControls = el(doc, "div", {
    classList: ["zotero-evidence-coding-link-picker-controls"],
  }) as HTMLElement;
  pickerRow.appendChild(pickerControls);

  const select = el(doc, "select", {
    children: [
      {
        tag: "option",
        namespace: "html",
        properties: {
          value: "",
          innerHTML: getString("coding-choose-annotation"),
        },
      },
      ...annotations.map((a) => ({
        tag: "option",
        namespace: "html",
        properties: { value: a.key, innerHTML: annotationOptionLabel(a) },
      })),
    ],
  }) as HTMLSelectElement;
  pickerControls.appendChild(select);

  const linkBtn = el(doc, "button", {
    attributes: { type: "button" },
    properties: { innerHTML: getString("coding-link-annotation") },
    listeners: [
      {
        type: "click",
        listener: async (ev: Event) => {
          ev.stopPropagation();
          const key = select.value;
          if (!key) {
            ztoolkit.getGlobal("alert")(
              getString("coding-error-no-annotation-selected"),
            );
            return;
          }
          try {
            await linkAnnotationToRecord(
              record.id,
              key,
              record.variableName,
              record.variableValue,
            );
            onChanged();
          } catch (e: any) {
            ztoolkit.getGlobal("alert")(
              `${getString("coding-error-link")}\n${e?.message ?? e}`,
            );
          }
        },
      },
    ],
  });
  pickerControls.appendChild(linkBtn);

  return pickerRow;
}

/** One row inside the pending-suggestions card. */
function renderSuggestionRow(
  doc: Document,
  item: Zotero.Item,
  attachment: Zotero.Item | null,
  annotations: Zotero.Item[],
  record: CodingRecord,
  onChanged: () => void,
): HTMLElement {
  const wrap = el(doc, "div", {}) as HTMLElement;

  const row = el(doc, "div", {
    classList: ["zotero-evidence-coding-suggestion-row"],
  }) as HTMLElement;

  const letter = (record.variableName[0] || "?").toUpperCase();
  row.appendChild(
    renderBadge(doc, letter, badgeColorForVariable(record.variableName)),
  );

  row.appendChild(
    el(doc, "span", {
      classList: ["zotero-evidence-coding-row-label"],
      properties: {
        innerHTML: `<strong>${escapeHtml(record.variableName)}</strong>: ${escapeHtml(quotePreview(record.variableValue, 40))}`,
      },
    }),
  );

  let located: { pageIndex: number; rects: number[][] } | null = null;
  if (record.pendingPosition) {
    try {
      located = JSON.parse(record.pendingPosition);
    } catch {
      located = null;
    }
  }

  row.appendChild(
    el(doc, "span", {
      classList: ["zotero-evidence-coding-row-status"],
      properties: {
        innerHTML: located
          ? getString("coding-page-label", {
              args: { page: located.pageIndex + 1 },
            })
          : getString("coding-needs-manual-link"),
      },
    }),
  );

  const actions = el(doc, "div", {
    classList: ["zotero-evidence-coding-row-actions"],
  }) as HTMLElement;

  const rejectBtn = el(doc, "button", {
    attributes: { type: "button", title: getString("coding-reject-one") },
    properties: { innerHTML: "✕" },
    listeners: [
      {
        type: "click",
        listener: async (ev: Event) => {
          ev.stopPropagation();
          try {
            await deleteRecord(record.id);
            onChanged();
          } catch (e: any) {
            ztoolkit.getGlobal("alert")(
              `${getString("coding-error-reject")}\n${e?.message ?? e}`,
            );
          }
        },
      },
    ],
  });
  actions.appendChild(rejectBtn);
  row.appendChild(actions);

  // Row click: a located suggestion previews (jump + native flash, nothing
  // persisted); an unlocated one toggles the manual-link picker instead.
  row.addEventListener("click", () => {
    if (located) {
      if (!attachment) return;
      void Zotero.Reader.open(attachment.id, {
        pageIndex: located.pageIndex,
        position: { pageIndex: located.pageIndex, rects: located.rects },
      });
      return;
    }
    const existing = wrap.querySelector(".zotero-evidence-coding-link-picker");
    if (existing) {
      existing.remove();
      return;
    }
    wrap.appendChild(
      renderInlineLinkPicker(doc, item, annotations, record, onChanged),
    );
  });

  wrap.appendChild(row);
  return wrap;
}

/**
 * Group card for every not-yet-confirmed suggestion (COD-04), styled after
 * beaver-zotero's compact "N Highlights" review card (adapted: our rows
 * carry a variable/value, not a raw highlight, so the badge encodes
 * variable identity rather than highlight color, and batch actions map onto
 * confirmRecord/deleteRecord rather than a generic apply/reject).
 */
function renderPendingSuggestionsCard(
  container: HTMLElement,
  doc: Document,
  item: Zotero.Item,
  attachment: Zotero.Item | null,
  annotations: Zotero.Item[],
  records: CodingRecord[],
  onChanged: () => void,
): void {
  const pending = records.filter((r) => !r.annotationKey);
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

  for (const record of pending) {
    card.appendChild(
      renderSuggestionRow(doc, item, attachment, annotations, record, onChanged),
    );
  }

  const footer = el(doc, "div", {
    classList: ["zotero-evidence-coding-card-footer"],
  }) as HTMLElement;

  const rejectAllBtn = el(doc, "button", {
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
          for (const r of pending) {
            try {
              await deleteRecord(r.id);
            } catch (e) {
              ztoolkit.log("Coding reject-all failed for record", r.id, e);
            }
          }
          onChanged();
        },
      },
    ],
  });
  footer.appendChild(rejectAllBtn);

  const acceptAllBtn = el(doc, "button", {
    attributes: { type: "button" },
    properties: { innerHTML: getString("coding-accept-all") },
    listeners: [
      {
        type: "click",
        listener: async () => {
          // Only accepts suggestions that were successfully auto-located --
          // one that wasn't still needs a human to manually link an
          // annotation, same fallback confirmRecord already applies
          // per-record today, just batched here.
          let accepted = 0;
          let failed = 0;
          for (const r of pending.filter((x) => x.pendingPosition)) {
            try {
              await confirmRecord(r.id, item, r.variableName, r.variableValue);
              accepted++;
            } catch (e) {
              failed++;
              ztoolkit.log("Coding accept-all failed for record", r.id, e);
            }
          }
          ztoolkit.getGlobal("alert")(
            getString("coding-accept-all-done", { args: { accepted, failed } }),
          );
          onChanged();
        },
      },
    ],
  });
  footer.appendChild(acceptAllBtn);

  card.appendChild(footer);
  container.appendChild(card);
}

/** Compact, already-confirmed records. When `onChanged` is provided (the
 * full Coding editor, reader tab), each row gets an Undo action that sends
 * it back to the pending-suggestions card (see unconfirmRecord); omitting
 * it renders a read-only summary with no action button -- used by the
 * library-tab Coding summary, which is evidence-review-only. */
function renderConfirmedList(
  container: HTMLElement,
  doc: Document,
  item: Zotero.Item,
  attachment: Zotero.Item | null,
  annotations: Zotero.Item[],
  records: CodingRecord[],
  onChanged?: () => void,
): void {
  const confirmed = records.filter((r) => r.annotationKey);
  if (confirmed.length === 0) return;

  container.appendChild(
    el(doc, "h3", {
      properties: { innerHTML: getString("coding-confirmed-title") },
    }),
  );

  const list = el(doc, "div", {
    classList: ["zotero-evidence-confirmed-list"],
  }) as HTMLElement;

  for (const record of confirmed) {
    const wrap = el(doc, "div", {}) as HTMLElement;
    const row = el(doc, "div", {
      classList: ["zotero-evidence-confirmed-row"],
    }) as HTMLElement;

    row.appendChild(renderBadge(doc, "✓", "#2e7d32"));

    row.appendChild(
      el(doc, "span", {
        classList: ["zotero-evidence-coding-row-label"],
        properties: {
          innerHTML: `<strong>${escapeHtml(record.variableName)}</strong>: ${escapeHtml(quotePreview(record.variableValue, 40))}`,
        },
      }),
    );

    let pageLabel = "";
    const annotation = annotations.find((a) => a.key === record.annotationKey);
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
        // no page info available -- leave the label blank
      }
    }
    row.appendChild(
      el(doc, "span", {
        classList: ["zotero-evidence-coding-row-status"],
        properties: { innerHTML: pageLabel },
      }),
    );

    if (onChanged) {
      const onConfirmedChanged = onChanged;
      const actions = el(doc, "div", {
        classList: ["zotero-evidence-coding-row-actions"],
      }) as HTMLElement;
      const undoBtn = el(doc, "button", {
        attributes: { type: "button", title: getString("coding-undo-confirm") },
        properties: { innerHTML: "↺" },
        listeners: [
          {
            type: "click",
            listener: async (ev: Event) => {
              ev.stopPropagation();
              try {
                await unconfirmRecord(record.id);
                onConfirmedChanged();
              } catch (e: any) {
                ztoolkit.getGlobal("alert")(
                  `${getString("coding-error-undo")}\n${e?.message ?? e}`,
                );
              }
            },
          },
        ],
      });
      actions.appendChild(undoBtn);
      row.appendChild(actions);
    }

    row.addEventListener("click", () => {
      if (!attachment || !record.annotationKey) return;
      void Zotero.Reader.open(
        attachment.id,
        locationForAnnotation(record.annotationKey, annotations),
      );
    });

    wrap.appendChild(row);
    list.appendChild(wrap);
  }

  container.appendChild(list);
}

async function renderManualAddForm(
  container: HTMLElement,
  doc: Document,
  ctx: ProjectPaneContext,
  item: Zotero.Item,
  codebookId: number,
  variables: CodebookVariable[],
  annotations: Zotero.Item[],
  onChanged: () => void,
) {
  const form = el(doc, "div", { classList: ["zotero-evidence-coding-form"] });

  const variableSelect = el(doc, "select", {
    children: variables.map((v) => ({
      tag: "option",
      namespace: "html",
      properties: { value: v.name, innerHTML: escapeHtml(v.name) },
    })),
  }) as HTMLSelectElement;
  form.appendChild(variableSelect);

  const valueInput = el(doc, "input", {
    attributes: {
      type: "text",
      placeholder: getString("coding-value-placeholder"),
    },
  }) as HTMLInputElement;
  form.appendChild(valueInput);

  const annotationSelect = el(doc, "select", {
    children: [
      {
        tag: "option",
        namespace: "html",
        properties: {
          value: "",
          innerHTML: getString("coding-choose-annotation-optional"),
        },
      },
      ...annotations.map((a) => ({
        tag: "option",
        namespace: "html",
        properties: { value: a.key, innerHTML: annotationOptionLabel(a) },
      })),
    ],
  }) as HTMLSelectElement;
  form.appendChild(annotationSelect);

  const addBtn = el(doc, "button", {
    attributes: { type: "button" },
    properties: { innerHTML: getString("coding-add-manual") },
    listeners: [
      {
        type: "click",
        listener: async () => {
          const variableName = variableSelect.value;
          const variableValue = valueInput.value.trim();
          if (!variableName || !variableValue) {
            ztoolkit.getGlobal("alert")(
              getString("coding-error-manual-incomplete"),
            );
            return;
          }
          const annotationKey = annotationSelect.value || null;
          const quote = annotationKey
            ? (annotations.find((a) => a.key === annotationKey)
                ?.annotationText as unknown as string) || null
            : null;
          try {
            await addManualRecord(
              ctx.project.id,
              item,
              codebookId,
              variableName,
              variableValue,
              annotationKey,
              quote,
            );
            onChanged();
          } catch (e: any) {
            ztoolkit.getGlobal("alert")(
              `${getString("coding-error-manual-add")}\n${e?.message ?? e}`,
            );
          }
        },
      },
    ],
  });
  form.appendChild(addBtn);

  container.appendChild(form);
}

async function renderCodingArea(
  container: HTMLElement,
  doc: Document,
  ctx: ProjectPaneContext,
  item: Zotero.Item,
) {
  container.innerHTML = "";

  const codebookRow = await getLatestCodebook(ctx.project.id);
  if (!codebookRow || codebookRow.variables.length === 0) {
    container.appendChild(
      el(doc, "p", {
        properties: { innerHTML: getString("coding-no-codebook") },
        styles: { color: "var(--fill-secondary, #a33)" },
      }),
    );
    return;
  }

  const attachment = await resolveAttachment(item);
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

  const progress = await getCodingProgress(
    ctx.project.id,
    item.key,
    codebookRow.variables,
  );
  if (progress.requiredTotal > 0) {
    container.appendChild(
      el(doc, "p", {
        classList: ["zotero-evidence-coding-progress"],
        properties: {
          innerHTML: `${progress.requiredDone} / ${progress.requiredTotal} ${getString("coding-progress-suffix")}`,
        },
      }),
    );
  }

  const rerender = async () => {
    await renderCodingArea(container, doc, ctx, item);
  };

  const buttonRow = el(doc, "div", { classList: ["zotero-evidence-buttons"] });

  const generateBtn = el(doc, "button", {
    attributes: { type: "button" },
    properties: { innerHTML: getString("coding-generate-suggestions") },
    listeners: [
      {
        type: "click",
        listener: async () => {
          generateBtn.setAttribute("disabled", "true");
          generateBtn.textContent = getString("coding-loading");
          try {
            const result = await generateSuggestions(ctx.project.id, item);
            item.addToCollection(ctx.collections.codingId);
            await item.saveTx();
            if (result.count === 0) {
              ztoolkit.getGlobal("alert")(getString("coding-no-suggestions"));
            }
            await rerender();
          } catch (e: any) {
            ztoolkit.log("Coding generateSuggestions failed", item.key, e);
            ztoolkit.getGlobal("alert")(
              `${getString("coding-error-generate")}\n${e?.stack ?? e?.message ?? e}`,
            );
            generateBtn.removeAttribute("disabled");
            generateBtn.textContent = getString("coding-generate-suggestions");
          }
        },
      },
    ],
  });
  buttonRow.appendChild(generateBtn);

  const refreshBtn = el(doc, "button", {
    attributes: { type: "button" },
    properties: { innerHTML: getString("coding-refresh") },
    listeners: [{ type: "click", listener: () => void rerender() }],
  });
  buttonRow.appendChild(refreshBtn);
  container.appendChild(buttonRow);

  const annotations = attachment ? attachment.getAnnotations() : [];
  const records = await getCodingRecords(ctx.project.id, item.key);

  const listArea = el(doc, "div", {
    classList: ["zotero-evidence-coding-list"],
  }) as HTMLElement;
  container.appendChild(listArea);

  if (records.length === 0) {
    listArea.appendChild(
      el(doc, "p", {
        properties: { innerHTML: getString("coding-no-records") },
      }),
    );
  } else {
    renderPendingSuggestionsCard(
      listArea,
      doc,
      item,
      attachment,
      annotations,
      records,
      () => void rerender(),
    );
    renderConfirmedList(
      listArea,
      doc,
      item,
      attachment,
      annotations,
      records,
      () => void rerender(),
    );
  }

  container.appendChild(
    el(doc, "h3", {
      properties: { innerHTML: getString("coding-manual-add-title") },
    }),
  );
  await renderManualAddForm(
    container,
    doc,
    ctx,
    item,
    codebookRow.id,
    codebookRow.variables,
    annotations,
    () => void rerender(),
  );
}

function renderHeader(
  body: HTMLDivElement,
  doc: Document,
  item: Zotero.Item,
): HTMLElement {
  body.innerHTML = "";
  body.classList.add("zotero-evidence-card");
  body.appendChild(
    el(doc, "h2", {
      properties: { innerHTML: escapeHtml(safeGetField(item, "title")) },
    }),
  );
  const contentArea = el(doc, "div", {
    classList: ["zotero-evidence-judgment-area"],
  }) as HTMLElement;
  body.appendChild(contentArea);
  return contentArea;
}

/**
 * Read-only "what's already been confirmed" summary for a Coding-collection
 * item, shown in the library item pane (not the full reader-tab editor --
 * no generate/manual-add/undo actions here, evidence review only).
 */
async function renderCodingSummary(
  contentArea: HTMLElement,
  doc: Document,
  ctx: ProjectPaneContext,
  item: Zotero.Item,
): Promise<void> {
  const records = await getCodingRecords(ctx.project.id, item.key);
  const confirmedCount = records.filter((r) => r.annotationKey).length;
  if (confirmedCount === 0) {
    contentArea.appendChild(
      el(doc, "p", {
        properties: { innerHTML: getString("coding-summary-empty") },
      }),
    );
    return;
  }
  const attachment = await resolveAttachment(item);
  const annotations = attachment ? attachment.getAnnotations() : [];
  renderConfirmedList(contentArea, doc, item, attachment, annotations, records);
}

export function registerCodingPane() {
  Zotero.ItemPaneManager.registerSection({
    paneID: PANE_ID,
    pluginID: config.addonID,
    // Tag -- Coding assigns codebook variable/value tags to extracted
    // evidence, distinct from TA-Screening's scan (magnifier.svg) and
    // FT-Screening's document read (page.svg). Matches Zotero's own native
    // item-pane icon style (chrome://zotero/skin/16/universal/*.svg,
    // tinted via context-fill).
    header: {
      l10nID: getLocaleID("coding-head-text"),
      icon: "chrome://zotero/skin/16/universal/tag.svg",
    },
    sidenav: {
      l10nID: getLocaleID("coding-sidenav-tooltip"),
      icon: "chrome://zotero/skin/16/universal/tag.svg",
    },
    // The reader's own right-side context pane turns out to reuse the same
    // stacked item-details sections (info/abstract/attachments/notes) as
    // the library item pane -- just switched via its sidenav's tabs instead
    // of scrolled -- so the same #zotero-view-item/.zotero-evidence-hide-
    // native toggle used by screenQueuePane.ts/ftQueuePane.ts applies here
    // too (a no-op if that container doesn't exist in some reader layout).
    // Goal: opening a PDF for a Coding/FT-Include item shouldn't leave Info/
    // Abstract as the only thing worth looking at in that pane.
    onItemChange: ({ item, doc, setEnabled, tabType }) => {
      const ctx = resolveContextSync(item);
      const relevant =
        (tabType === "reader" &&
          !!ctx &&
          (ctx.role === "ft_include" || ctx.role === "coding")) ||
        (tabType === "library" && !!ctx && ctx.role === "coding");
      setEnabled(relevant);
      setNativeSectionsHidden(doc, !!ctx);
    },
    onDestroy: ({ doc }) => {
      setNativeSectionsHidden(doc, false);
    },
    // Required for registerSection to actually succeed -- see
    // screenQueuePane.ts for the empirically-confirmed reason.
    onRender: () => {},
    onAsyncRender: async ({ body, doc, item, tabType }) => {
      const ctx = resolveContextSync(item);
      if (tabType === "reader") {
        if (!ctx || !(ctx.role === "ft_include" || ctx.role === "coding")) {
          return;
        }
        const contentArea = renderHeader(body, doc, item);
        try {
          await renderCodingArea(contentArea, doc, ctx, item);
        } catch (e) {
          ztoolkit.log("Coding pane render failed", item.key, e);
          renderPaneError(doc, contentArea, e);
        }
        return;
      }
      if (tabType === "library") {
        if (!ctx || ctx.role !== "coding") return;
        const contentArea = renderCardHeader(body, doc, item);
        try {
          await renderCodingSummary(contentArea, doc, ctx, item);
        } catch (e) {
          ztoolkit.log("Coding summary render failed", item.key, e);
          renderPaneError(doc, contentArea, e);
        }
      }
    },
  });
}
