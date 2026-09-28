/**
 * Full-window "busy" overlay for long, unsafe-to-interrupt operations --
 * originally built for restoreArchiveDialog (issue #11: a backup restore
 * recreates every item/attachment/annotation and re-links every
 * screening/coding/consistency row one at a time), and reused as-is by
 * deleteProjectDialog (which erases the same kind of tree, just in the
 * other direction). Either can run long enough that a user watching an
 * unchanged Zotero pane could reasonably conclude it's hung and start
 * clicking around -- switching the selected collection, starting another
 * import, retrying the same operation. None of that is safe mid-operation
 * (both write through Zotero.Item transactions the whole time), so this
 * pins the user out of the main window entirely for the duration, on top of
 * each caller's own server-side exclusivity guard (restoreTracker.ts,
 * deleteTracker.ts).
 *
 * A translucent, message-bearing div swallows pointer input (both visually,
 * via its own size/position, and functionally, via capturing listeners so a
 * click can never bubble through to whatever is underneath); a capturing
 * keydown listener on the window does the same for the keyboard, since
 * focus can remain on a background element the overlay never covers.
 */

const OVERLAY_ID = "evidence-ui-lock-overlay";
const MESSAGE_ID = "evidence-ui-lock-message";

export interface UiLockHandle {
  setMessage(text: string): void;
  unlock(): void;
}

export function lockWindow(win: Window, message: string): UiLockHandle {
  const doc = win.document;

  // Idempotent rather than stacking: shouldn't happen given each caller's
  // own exclusivity guard, but a leftover overlay from a prior run that
  // somehow didn't get unlocked must never compound.
  doc.getElementById(OVERLAY_ID)?.remove();

  const overlay = doc.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.setAttribute(
    "style",
    [
      "position:fixed",
      "inset:0",
      "z-index:2147483647",
      "background:rgba(0,0,0,0.35)",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "cursor:wait",
    ].join(";"),
  );

  const box = doc.createElement("div");
  box.setAttribute(
    "style",
    [
      "background:#fff",
      "color:#111",
      "padding:16px 24px",
      "border-radius:8px",
      "box-shadow:0 2px 16px rgba(0,0,0,0.35)",
      "font-size:14px",
      "min-width:260px",
      "max-width:420px",
      "text-align:center",
    ].join(";"),
  );

  const messageEl = doc.createElement("div");
  messageEl.id = MESSAGE_ID;
  messageEl.textContent = message;
  box.appendChild(messageEl);
  overlay.appendChild(box);

  const swallow = (ev: Event) => {
    ev.preventDefault();
    ev.stopPropagation();
  };
  overlay.addEventListener("click", swallow);
  overlay.addEventListener("mousedown", swallow);
  overlay.addEventListener("wheel", swallow, { passive: false });
  win.addEventListener("keydown", swallow, true);

  const root = doc.documentElement;
  if (!root) {
    throw new Error("lockWindow: window has no documentElement");
  }
  root.appendChild(overlay);

  let unlocked = false;
  return {
    setMessage(text: string) {
      messageEl.textContent = text;
    },
    unlock() {
      if (unlocked) return;
      unlocked = true;
      win.removeEventListener("keydown", swallow, true);
      overlay.remove();
    },
  };
}
