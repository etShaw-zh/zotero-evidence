import { getString } from "../../utils/locale";
import { safeGetField } from "../../utils/zoteroItem";
import {
  findProjectPaneContextSync,
  ProjectPaneContext,
} from "../project/projectContext";

const NATIVE_HIDE_CLASS = "zotero-evidence-hide-native";

// Built-in pane IDs that should be hidden when our custom section is active.
const BUILTIN_PANE_IDS = [
  "info",
  "abstract",
  "attachments",
  "notes",
  "note-info",
  "attachment-info",
  "attachment-annotations",
  "libraries-collections",
  "tags",
  "related",
];

export function setNativeSectionsHidden(doc: Document, hidden: boolean) {
  // 1. Library pane: toggle class on #zotero-view-item so descendant CSS
  //    selectors at the top of zoteroPane.css hide native sections there.
  const libraryContainer = doc.getElementById("zotero-view-item");
  libraryContainer?.classList.toggle(NATIVE_HIDE_CLASS, hidden);

  // 2. Reader pane (and any other layout): toggle class directly on each
  //    built-in section element itself. The companion CSS rules target
  //    [data-pane="..."].zotero-evidence-hide-native, so we don't need to
  //    know the reader's container ID. This fixes the bug where our
  //    Evidence coding section shares the reader context pane with info/
  //    abstract/attachments -- those native sections take up visible space
  //    and the whole column needs to scroll through them to reach us.
  for (const paneId of BUILTIN_PANE_IDS) {
    const sections = doc.querySelectorAll(`[data-pane="${paneId}"]`);
    for (const section of sections) {
      section.classList.toggle(NATIVE_HIDE_CLASS, hidden);
    }
  }
}

/**
 * Synchronous collection -> project/role lookup, safe to call from
 * onItemChange (see projectContext.ts for why this must stay synchronous).
 * Shared by every pane section (Screen Queue, FT-Queue, ...).
 */
export function resolveContextSync(
  item: Zotero.Item | undefined,
): ProjectPaneContext | null {
  if (!item || !item.isRegularItem()) return null;
  const ZoteroPaneGlobal = ztoolkit.getGlobal("ZoteroPane");
  const collectionId = ZoteroPaneGlobal.getSelectedCollection(true);
  return findProjectPaneContextSync(collectionId ?? null);
}

export function el(doc: Document, tag: string, props: any = {}): any {
  return ztoolkit.UI.createElement(doc, tag, { namespace: "html", ...props });
}

/** Shared "does this item have a usable PDF attachment" lookup (Coding's
 * reader sidebar and FT-Screening's annotation linker both need it). */
export async function resolveAttachment(
  item: Zotero.Item,
): Promise<Zotero.Item | null> {
  try {
    const attachment = await item.getBestAttachment();
    return attachment && attachment.isPDFAttachment() ? attachment : null;
  } catch {
    return null;
  }
}

export function quotePreview(text: string | null, max = 60): string {
  if (!text) return "";
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/**
 * Every pane section assigns `.innerHTML` on elements living in Zotero's
 * XUL/XML item pane document, not a regular HTML page -- so, unlike a
 * browser tab, an unescaped `&` or `<` in the string isn't just an XSS risk,
 * it's a hard XML parse error (`InvalidCharacterError: An invalid or
 * illegal string was specified`) that aborts the render outright. Anything
 * that didn't originate as a fixed literal or a Fluent-managed getString()
 * result -- an item title/abstract/creator, an AI reasoning/quote/decision,
 * a Codebook variable name, a user-typed project name or criterion, an
 * annotation's own text -- must go through this before landing in an
 * innerHTML template.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Shared "key: preview text" option label for annotation-picker dropdowns
 * (Coding's per-record linker and FT-Screening's evidence linker). */
export function annotationOptionLabel(annotation: Zotero.Item): string {
  const preview = quotePreview(
    (annotation.annotationText as unknown as string) || "",
    50,
  );
  return preview
    ? `${annotation.key}: "${escapeHtml(preview)}"`
    : `${annotation.key} (${getString("annotation-no-text")})`;
}

/** Shared "Include"/"Exclude"/"Unclear" wording across TA and FT panes. */
export function decisionLabel(decision: string): string {
  return getString(`screen-queue-decision-${decision}` as any);
}

/**
 * Renders any unexpected render-time exception as a visible message instead
 * of silently leaving the pane's content area empty -- an item-specific bug
 * anywhere in the render pipeline (e.g. a malformed attachment/creator on
 * one particular item) used to abort onAsyncRender partway through and
 * leave the whole item with no action buttons and no indication why.
 */
export function renderPaneError(
  doc: Document,
  container: HTMLElement,
  error: unknown,
) {
  const message = error instanceof Error ? error.message : String(error);
  container.appendChild(
    el(doc, "p", {
      classList: ["zotero-evidence-pane-error"],
      properties: {
        innerHTML: `${getString("pane-render-error")} ${escapeHtml(message)}`,
      },
      styles: { color: "var(--fill-secondary, #a33)" },
    }),
  );
}

/**
 * Renders the shared card header (title, authors/year, collapsible
 * abstract) and returns the empty content area below it for the caller to
 * fill in with stage-specific controls.
 */
export function renderCardHeader(
  body: HTMLDivElement,
  doc: Document,
  item: Zotero.Item,
): HTMLElement {
  const title =
    safeGetField(item, "title") || getString("screen-queue-untitled");
  const creators = item
    .getCreators()
    .map((c) => `${c.lastName}${c.firstName ? ", " + c.firstName : ""}`)
    .join("; ");
  const year = (safeGetField(item, "date").match(/\d{4}/) || [])[0] || "";
  const abstract = safeGetField(item, "abstractNote");

  body.innerHTML = "";
  body.classList.add("zotero-evidence-card");

  body.appendChild(
    el(doc, "h2", { properties: { innerHTML: escapeHtml(title) } }),
  );
  body.appendChild(
    el(doc, "div", {
      classList: ["authors"],
      properties: {
        innerHTML: escapeHtml([creators, year].filter(Boolean).join(" · ")),
      },
    }),
  );

  const abstractBox = el(doc, "div", {
    classList: ["zotero-evidence-abstract"],
    properties: {
      innerHTML: abstract
        ? escapeHtml(abstract)
        : getString("screen-queue-no-abstract"),
    },
  }) as HTMLElement;
  body.appendChild(abstractBox);

  const toggleBtn = el(doc, "button", {
    attributes: { type: "button" },
    properties: { innerHTML: getString("screen-queue-expand") },
    listeners: [
      {
        type: "click",
        listener: () => {
          const expanded = abstractBox.classList.toggle("expanded");
          toggleBtn.textContent = getString(
            expanded ? "screen-queue-collapse" : "screen-queue-expand",
          );
        },
      },
    ],
  });
  body.appendChild(toggleBtn);

  const contentArea = el(doc, "div", {
    classList: ["zotero-evidence-judgment-area"],
  }) as HTMLElement;
  body.appendChild(contentArea);

  return contentArea;
}
