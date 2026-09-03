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

/**
 * Applies the hide/readonly state to one specific <item-details> (or other
 * container) subtree -- shared by setNativeSectionsHidden (onItemChange,
 * scoped to the section instance's own root) and
 * refreshLibraryNativeSectionsHidden (onDestroy's recovery path, scoped to
 * the library's own fixed-id root).
 */
function applyNativeSectionsHidden(root: ParentNode, hidden: boolean) {
  // 1. Library pane: toggle class on #zotero-view-item so descendant CSS
  //    selectors at the top of zoteroPane.css hide native sections there.
  const libraryContainer = root.querySelector("#zotero-view-item");
  libraryContainer?.classList.toggle(NATIVE_HIDE_CLASS, hidden);

  // 2. Reader pane (and any other layout): toggle class directly on each
  //    built-in section element itself. The companion CSS rules target
  //    [data-pane="..."].zotero-evidence-hide-native, so we don't need to
  //    know the reader's container ID. This fixes the bug where our
  //    Evidence coding section shares the reader context pane with info/
  //    abstract/attachments -- those native sections take up visible space
  //    and the whole column needs to scroll through them to reach us.
  for (const paneId of BUILTIN_PANE_IDS) {
    const sections = root.querySelectorAll(`[data-pane="${paneId}"]`);
    for (const section of sections) {
      section.classList.toggle(NATIVE_HIDE_CLASS, hidden);
    }
  }

  // 3. Title field: Zotero's own <item-pane-header> exposes an `editable`
  //    property (chrome://zotero/content/elements/itemPaneHeader.js) that
  //    sets the title textarea's `readOnly` attribute -- readOnly still
  //    allows selecting and copying the title, just not typing into it.
  //    Evidence's screening/dedup/export logic all key off an item's title
  //    text, so editing it from inside a project pane risks silently
  //    desyncing that state from what was actually screened; disabling
  //    editing (not visibility, unlike #1/#2 above) is enough to prevent
  //    that while leaving copy/paste for citing the title elsewhere intact.
  //    Matched by tag name (not the duplicated id) within the scoped root.
  const header = root.querySelector("item-pane-header") as
    | (HTMLElement & { editable: boolean })
    | null;
  if (header) header.editable = !hidden;
}

/**
 * `body` (a hook's own section-content element) is required, not optional,
 * for a reason -- see the scoping comment below. Call from onItemChange
 * only -- see refreshLibraryNativeSectionsHidden for onDestroy, where
 * `body` is unreliable.
 */
export function setNativeSectionsHidden(
  doc: Document,
  body: HTMLElement,
  hidden: boolean,
) {
  // Scope every lookup to the SPECIFIC <item-details> instance this
  // section's own content (`body`) lives inside, not the whole document.
  // Zotero's reader-tab context pane is NOT a separate document -- it's
  // another <item-details id="{tabID}-context"> element living as a
  // sibling of the library tab's own <item-details id="zotero-item-
  // details">, all inside the SAME top-level chrome document
  // (chrome://zotero/content/elements/contextPane.js creates one per open
  // tab in a shared deck). Each instance's own internal template hard-
  // codes the SAME ids for its title header (#zotero-item-pane-header) and
  // view-item container (#zotero-view-item) -- valid HTML doesn't actually
  // forbid a document from containing duplicate ids, it just means an
  // unscoped doc.getElementById always silently resolves to whichever
  // instance happens to be first in the DOM (in practice, always the
  // library tab's) and never a reader tab's own copy. That's why this is
  // scoped by walking up from `body` rather than querying `doc` directly
  // -- confirmed via Zotero.debug logging that at onItemChange time `body`
  // is reliably still attached under its own <item-details>, unlike at
  // onDestroy time (see refreshLibraryNativeSectionsHidden). Falls back to
  // the whole document if no <item-details> ancestor is found (e.g. a test
  // environment without Zotero's real layout), matching the old unscoped
  // behavior.
  const root: ParentNode = body.closest("item-details") ?? doc;
  applyNativeSectionsHidden(root, hidden);
}

/**
 * Use from onDestroy instead of setNativeSectionsHidden -- onDestroy fires
 * whenever ANY instance of a pane section goes away (e.g. closing a PDF
 * reader tab opened from a Coding/FT-Include item), but by that point its
 * own `body` is already detached from its <item-details> ancestor
 * (confirmed via Zotero.debug logging: body.closest("item-details")
 * reliably returns null at onDestroy time, even though the identical call
 * from onItemChange moments earlier correctly found it) -- so scoping from
 * `body` the way setNativeSectionsHidden does doesn't work here, and
 * falling back to a document-wide search hits whichever <item-details> is
 * first in the DOM (the library tab's) regardless of which tab is actually
 * closing, incorrectly clearing the STILL-ACTIVE library tab's state. This
 * was exactly the reported bug: opening then closing a PDF from Extract
 * Coding left the library tab's native panes visible and its title
 * editable again, with nothing afterward to re-hide them (Zotero doesn't
 * re-fire onItemChange for the library tab just because a different tab
 * closed). Fixed by not trusting the destroy event's own body at all: the
 * library tab's own <item-details> root has a fixed, predictable id
 * ("zotero-item-details", unlike a reader tab's "{tabID}-context") --
 * found directly, then hidden is re-derived from the library pane's own
 * ACTUAL current selection (the same inputs onItemChange itself uses)
 * rather than assumed. A no-op if the library root can't be found (e.g.
 * the whole window is closing).
 */
export function refreshLibraryNativeSectionsHidden(doc: Document) {
  const root = doc.getElementById("zotero-item-details");
  if (!root) return;
  const ZoteroPaneGlobal = ztoolkit.getGlobal("ZoteroPane");
  const selectedItem = ZoteroPaneGlobal.getSelectedItems?.()[0];
  applyNativeSectionsHidden(root, !!resolveContextSync(selectedItem));
}

/**
 * Zotero 10 removed `ZoteroPane.getSelectedCollection()` -- it now throws
 * "was removed -- use ZoteroPane.getSelectedCollections()" unconditionally
 * (confirmed against the real Zotero 10.0.1 source: chrome/content/zotero/
 * zoteroPane.js). The new plural method (multi-selection support) doesn't
 * exist on Zotero 7-9, so this feature-detects rather than try/catching a
 * call that's guaranteed to throw on 10+: prefer the new array-returning
 * method when present (10+), taking the first selected id (this plugin's
 * whole role model is "which ONE collection is selected", so a multi-
 * selection resolves to its first row, same as picking none when nothing
 * is selected); fall back to the legacy singular getter on 7-9, where the
 * plural method was never added.
 */
export function getSelectedCollectionIdCompat(
  ZoteroPaneGlobal: any,
): number | null {
  if (typeof ZoteroPaneGlobal.getSelectedCollections === "function") {
    const ids = ZoteroPaneGlobal.getSelectedCollections(true);
    return Array.isArray(ids) && ids.length > 0 ? ids[0] : null;
  }
  return ZoteroPaneGlobal.getSelectedCollection(true) ?? null;
}

/**
 * Synchronous collection -> project/role lookup, safe to call from
 * onItemChange (see projectContext.ts for why this must stay synchronous).
 * Shared by every pane section (TA-Queue, FT-Queue, ...).
 */
export function resolveContextSync(
  item: Zotero.Item | undefined,
): ProjectPaneContext | null {
  if (!item || !item.isRegularItem()) return null;
  const ZoteroPaneGlobal = ztoolkit.getGlobal("ZoteroPane");
  const collectionId = getSelectedCollectionIdCompat(ZoteroPaneGlobal);
  return findProjectPaneContextSync(collectionId ?? null);
}

/**
 * Whether native Info/Abstract/etc. sections should be hidden (and the
 * title locked read-only) for this item -- call this, unconditionally,
 * from EVERY registered pane section's onItemChange, regardless of
 * tabType. Do NOT gate this by tabType (e.g. `tabType === "library" ?
 * resolveContextSync(item) : null`) even if the section itself has no
 * reader-tab content: Zotero calls every registered section's onItemChange
 * for the same event, and whichever one runs last wins on this shared
 * decision (there's no per-section scoping -- it's one class toggled on
 * one shared container). If a section computes this from a tabType-gated
 * ctx meant for its OWN setEnabled() relevance check, it can disagree with
 * sections that don't gate it, and depending on registration order can
 * silently re-show the native panes in the reader -- this happened twice
 * in this codebase's history (once when Project Overview was added as a
 * 4th, later-registered section, once latent in TA-Queue that only never
 * surfaced because it was never the last-registered section). Computing it
 * here, the same way, independent of any section's own relevance, is what
 * makes every section's onItemChange agree regardless of order or count.
 */
export function shouldHideNativeSections(
  item: Zotero.Item | undefined,
): boolean {
  return !!resolveContextSync(item);
}

export function el(doc: Document, tag: string, props: any = {}): any {
  return ztoolkit.UI.createElement(doc, tag, { namespace: "html", ...props });
}

/**
 * Shared "this stage isn't configured yet" chip -- a short message plus a
 * button that jumps straight to fixing it (opens the criteria/codebook
 * dialog and re-renders on close). Used by every pane section that has a
 * dependency it can't proceed without (TA-/FT-Queue's screening criteria,
 * Coding's codebook): before this existed, each of those three rendered
 * its own bare, non-actionable paragraph (colored text only, no button --
 * the user had to already know which File menu item to use), while
 * projectOverviewPane.ts's project-wide dashboard got a nicer actionable
 * treatment for the exact same underlying condition. Unifying on this one
 * makes every stage's "not configured" state look and behave the same way,
 * regardless of which pane it's shown in.
 */
export function renderConfigWarning(
  doc: Document,
  opts: {
    text: string;
    buttonLabel: string;
    onClick: () => void | Promise<void>;
  },
): HTMLElement {
  const warning = el(doc, "div", {
    classList: ["zotero-evidence-config-warning"],
    children: [
      {
        tag: "span",
        namespace: "html",
        properties: { innerHTML: escapeHtml(opts.text) },
      },
    ],
  }) as HTMLElement;
  warning.appendChild(
    el(doc, "button", {
      attributes: { type: "button" },
      properties: { innerHTML: escapeHtml(opts.buttonLabel) },
      listeners: [{ type: "click", listener: () => void opts.onClick() }],
    }),
  );
  return warning;
}

/**
 * Compact "what do these symbols mean" caption for a card's icon-only row
 * actions (⇄/✓/✕/↺) -- FT-Screening's checklist and Coding's suggestion
 * cards both went from TA-Queue's full-text Include/Exclude/Unclear
 * buttons to bare Unicode glyphs with only a hover tooltip once a card can
 * hold a dozen+ rows (no room for text buttons on every row), which is a
 * real interaction-paradigm jump for anyone who hasn't hovered each one
 * yet. This doesn't change that interaction -- just spells out the icons
 * actually present in THIS card, once, above the rows, reusing the exact
 * strings each icon's own button `title` already uses so the legend can
 * never drift out of sync with what a hover would tell you.
 */
export function renderRowActionsLegend(
  doc: Document,
  icons: { symbol: string; label: string }[],
): HTMLElement {
  return el(doc, "p", {
    classList: ["zotero-evidence-notes-hint"],
    properties: {
      // A literal "·" character, NOT the &middot; HTML named entity -- this
      // innerHTML lands in Zotero's XUL/XML item pane document (see
      // escapeHtml's own doc comment above), where only &amp;/&lt;/&gt;/
      // &apos;/&quot; are valid entities. &middot; is undefined there and
      // is a hard XML parse error that aborts the whole render, not just a
      // display glitch -- exactly what broke FT/Coding's suggestion cards
      // the moment this shipped.
      innerHTML: icons
        .map((i) => `${escapeHtml(i.symbol)} ${escapeHtml(i.label)}`)
        .join(" · "),
    },
  }) as HTMLElement;
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
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Identifies who made a screening decision, for decided_by/fulltext_ready_by
 * -- Zotero's own numeric account ID when the user is signed into Zotero
 * sync (stable across devices/renames, unlike a display name), falling back
 * to the generic "user" label used everywhere before this existed when no
 * account is configured (Zotero.Users.getCurrentUserID() returns 0 then).
 */
export function currentDeciderId(): string {
  const userID = Zotero.Users.getCurrentUserID();
  return userID ? String(userID) : "user";
}

/** Shared "key: preview text" option label for annotation-picker dropdowns
 * (Coding's per-record linker and FT-Screening's evidence linker). */
export function annotationOptionLabel(annotation: Zotero.Item): string {
  const preview = quotePreview(
    (annotation.annotationText as unknown as string) || "",
    50,
  );
  // The highlight's own key used to lead this label -- meaningless to a
  // human scanning the dropdown for "the one I just made". When was it
  // highlighted is what actually helps here, so show that instead.
  const when = annotationDateLabel(annotation);
  return preview
    ? `${when}: "${escapeHtml(preview)}"`
    : `${when} (${getString("annotation-no-text")})`;
}

function annotationDateLabel(annotation: Zotero.Item): string {
  const parsed = Zotero.Date.sqlToDate(annotation.dateAdded, true);
  return parsed ? parsed.toLocaleString() : annotation.dateAdded;
}

/** Newest-first, by when the highlight was made -- so "the highlight I just
 * created" surfaces at the top of a dropdown instead of wherever
 * getAnnotations() happened to return it. dateAdded sorts correctly as a
 * plain string comparison (Zotero's SQL datetime format is already
 * zero-padded/left-to-right chronological). Doesn't mutate the input. */
export function sortAnnotationsByNewest(
  annotations: Zotero.Item[],
): Zotero.Item[] {
  return [...annotations].sort((a, b) =>
    b.dateAdded.localeCompare(a.dateAdded),
  );
}

/**
 * Rebuilds a "pick an existing highlight" <select>'s options in place from
 * a fresh attachment.getAnnotations() read, preserving the current
 * selection if it's still valid afterwards. Used by the "Refresh" button
 * next to each of these dropdowns: a highlight made by hand in the PDF
 * reader shows up in Zotero's own annotation list immediately, but this
 * plugin's dropdowns are built from a one-time snapshot taken when their
 * containing card last rendered, so a just-made highlight doesn't appear
 * there until something rebuilds the options -- this, without forcing a
 * full-card rerender that would also collapse whatever the user has open.
 */
export function refreshAnnotationOptions(
  doc: Document,
  select: HTMLSelectElement,
  attachment: Zotero.Item,
  placeholderLabel: string,
): void {
  const previousValue = select.value;
  select.innerHTML = "";
  const placeholder = doc.createElement("option");
  placeholder.setAttribute("value", "");
  placeholder.textContent = placeholderLabel;
  select.appendChild(placeholder);
  for (const a of sortAnnotationsByNewest(attachment.getAnnotations())) {
    const opt = doc.createElement("option");
    opt.setAttribute("value", a.key);
    opt.innerHTML = annotationOptionLabel(a);
    select.appendChild(opt);
  }
  const options = Array.from(select.options) as HTMLOptionElement[];
  if (options.some((o) => o.value === previousValue)) {
    select.value = previousValue;
  }
}

/** Shared "Include"/"Exclude"/"Unclear" wording across TA and FT panes. */
export function decisionLabel(decision: string): string {
  return getString(`ta-queue-decision-${decision}` as any);
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
  const title = safeGetField(item, "title") || getString("ta-queue-untitled");
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
        : getString("ta-queue-no-abstract"),
    },
  }) as HTMLElement;
  body.appendChild(abstractBox);

  const toggleBtn = el(doc, "button", {
    attributes: { type: "button" },
    properties: { innerHTML: getString("ta-queue-expand") },
    listeners: [
      {
        type: "click",
        listener: () => {
          const expanded = abstractBox.classList.toggle("expanded");
          toggleBtn.textContent = getString(
            expanded ? "ta-queue-collapse" : "ta-queue-expand",
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
