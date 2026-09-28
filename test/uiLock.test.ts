// Integration test for the shared long-operation UI lock
// (src/modules/ui/uiLock.ts, used by both restoreArchiveDialog and
// deleteProjectDialog), run against the real main window rather than a mock
// DOM -- the whole point of this helper is that a click or keypress on the
// real Zotero window during one of those operations must never reach
// whatever's underneath, which a fake `document` couldn't demonstrate.
import { assert } from "chai";
import { lockWindow } from "../src/modules/ui/uiLock";

// A window-level keydown probe used to prove/disprove OUR listener's
// effect, not the window's overall state -- this suite runs in the same
// real, shared Zotero main window as every other integration test file, so
// asserting an absolute "Enter is never prevented here" is exactly the kind
// of thing an unrelated earlier test's leftover global handler (a reader
// tab's shortcut, an open dialog, ...) could flip out from under this file.
// Comparing "with our lock" against "without it" for the SAME synthetic
// event isolates our module's own effect regardless of what else the
// window has accumulated by the time this runs.
function dispatchProbeKeydown(win: Window): boolean {
  const ev = new win.KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "Enter",
  });
  win.document.documentElement.dispatchEvent(ev);
  return ev.defaultPrevented;
}

describe("uiLock (integration)", function () {
  it("shows a message overlay and lets it be updated while locked", function () {
    const win = Zotero.getMainWindow();
    const lock = lockWindow(win, "Preparing restore…");
    try {
      const overlay = win.document.getElementById("evidence-ui-lock-overlay");
      assert.isNotNull(overlay, "overlay should be attached to the document");
      const message = win.document.getElementById("evidence-ui-lock-message");
      assert.equal(message?.textContent, "Preparing restore…");

      lock.setMessage("Restoring items (3 / 10)…");
      assert.equal(message?.textContent, "Restoring items (3 / 10)…");
    } finally {
      lock.unlock();
    }
  });

  it("swallows clicks on the overlay and keydowns on the window while locked, and stops swallowing either once unlocked", function () {
    const win = Zotero.getMainWindow();

    const beforeLock = dispatchProbeKeydown(win);

    const lock = lockWindow(win, "Restoring…");
    try {
      const overlay = win.document.getElementById("evidence-ui-lock-overlay")!;
      const click = new win.MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      overlay.dispatchEvent(click);
      assert.isTrue(
        click.defaultPrevented,
        "a click on the overlay itself must be swallowed",
      );

      assert.isTrue(
        dispatchProbeKeydown(win),
        "keyboard input anywhere in the window must be swallowed while locked",
      );
    } finally {
      lock.unlock();
    }

    assert.isNull(
      win.document.getElementById("evidence-ui-lock-overlay"),
      "overlay must be removed on unlock",
    );
    assert.equal(
      dispatchProbeKeydown(win),
      beforeLock,
      "once unlocked, the SAME probe event must behave exactly as it did before this lock existed -- proving our own capturing listener (not some other window state) was what changed in between",
    );

    // Calling unlock() again must be a no-op, not throw.
    assert.doesNotThrow(() => lock.unlock());
  });

  it("is idempotent: locking twice replaces the overlay instead of stacking it", function () {
    const win = Zotero.getMainWindow();
    const first = lockWindow(win, "First");
    const second = lockWindow(win, "Second");
    try {
      const overlays = win.document.querySelectorAll(
        "#evidence-ui-lock-overlay",
      );
      assert.equal(overlays.length, 1);
      assert.equal(
        win.document.getElementById("evidence-ui-lock-message")?.textContent,
        "Second",
      );
    } finally {
      first.unlock();
      second.unlock();
    }
  });
});
