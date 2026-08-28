import { assert } from "chai";
import { STORAGE_TAG } from "../src/modules/timeline/storage";
import {
  canvasFixtureDocuments,
  createDocumentNote,
  eraseAllPluginItems,
} from "./support-pluginItems";
import { waitFor } from "./waitFor";

// A range item is not draggable until it is selected. vis-timeline only builds
// the .vis-drag-center handle - the element that actually carries the drag -
// when `this.selected && this.editable.updateTime` holds, so dragging an
// unselected item does nothing at all and reports nothing. That is the
// library's model, not a defect, and it is the thing to know before concluding
// the timeline is broken.
//
// This asserts the mechanism. It deliberately does not assert that onMove
// fires: the drag is recognised by Hammer from a real pointer gesture, and
// synthesised pointer events in a XUL window do not satisfy its recogniser.
// Confirming the payload needs a person, and is TASK-4's remaining criterion.
describe("timeline drag", function () {
  this.timeout(60000);

  let libraryID: number;

  before(function () {
    libraryID = Zotero.Libraries.userLibraryID;
  });

  beforeEach(async function () {
    (Zotero as any).ZoteroTimeline.api.closeTimelineTab();
    await eraseAllPluginItems(libraryID);
    for (const doc of canvasFixtureDocuments()) {
      await createDocumentNote(libraryID, STORAGE_TAG, doc);
    }
  });

  afterEach(async function () {
    await eraseAllPluginItems(libraryID);
  });

  it("grows a drag handle only once the item is selected", async function () {
    this.timeout(60000);

    const api = (Zotero as any).ZoteroTimeline.api;
    const win = Zotero.getMainWindows()[0] as any;
    const doc = win.document;

    await api.openTimelineTab();
    await waitFor(() => api.getCurrentTimeline(), "the timeline to render");

    const errors: string[] = [];
    const onError = (ev: any) => {
      errors.push(
        `${ev.message ?? ev.type} @ ${ev.filename ?? "?"}:${ev.lineno ?? "?"}`,
      );
    };
    win.addEventListener("error", onError, true);

    const timeline = api.getCurrentTimeline();
    assert.ok(timeline, "no timeline instance exposed");

    // Did the deferred import actually defer? If the vis module evaluated with
    // no window, Hammer froze win = {} and no gesture can ever be recognised.
    const evalEnv = api.getModuleEvalEnv?.();
    assert.deepEqual(
      evalEnv,
      { hasWindow: true, hasDocument: true },
      `the vis module evaluated without the shimmed globals: ${JSON.stringify(evalEnv)}`,
    );

    // Does a click select? This is what Hammer's gesture recognition buys us,
    // and it only works if Hammer resolved a real window at module scope.
    // currentTimeline is assigned before vis-timeline's own initial redraw has
    // put anything in the DOM, so the item itself needs its own wait.
    // The content-bearing node, not any .vis-item. A point-like item renders
    // three parallel nodes (box, axis line, axis dot) and the line and dot are
    // a pixel or two wide, so a click centred on whichever matched first lands
    // on nothing. Since TASK-44 a date asserting no extent is a box, so this
    // matters for ordinary events and not only for parked ones.
    const item = (await waitFor(
      () => doc.querySelector(".vis-item.vis-box, .vis-item.vis-range"),
      "the first item to render on the canvas",
    )) as any;
    assert.ok(item, "no .vis-item present");
    // vis-timeline also runs its own initial fit-to-content on a deferred
    // tick after construction; a click position computed before it settles
    // can miss the item once it moves.
    let lastRect: DOMRect | null = null;
    const stableRect = await waitFor(
      () => {
        const rect = item.getBoundingClientRect();
        const stable =
          lastRect !== null &&
          rect.left === lastRect.left &&
          rect.width === lastRect.width;
        lastRect = rect;
        return stable ? rect : null;
      },
      "the item's layout to stop changing",
      { interval: 50, timeout: 3000 },
    ).catch(() => item.getBoundingClientRect());
    const r = stableRect;
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(r.top + r.height / 2);
    const PE = win.PointerEvent;
    for (const type of ["pointerdown", "pointerup"]) {
      item.dispatchEvent(
        new PE(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: cx,
          clientY: cy,
          buttons: type === "pointerup" ? 0 : 1,
          isPrimary: true,
          pointerId: 1,
          pointerType: "mouse",
          view: win,
        }),
      );
      // Pointer-event pacing, not effect-waiting - Hammer's gesture
      // recogniser needs the gap between down and up.
      await Zotero.Promise.delay(80);
    }
    // A diagnostic harness: waiting for the real condition speeds up the
    // pass path, but a genuine Hammer failure should still report through
    // the informative assertions below rather than a bare waitFor timeout.
    await waitFor(
      () => (timeline.getSelection().length > 0 ? true : null),
      "a click to select an item",
    ).catch(() => {});
    const selectionAfterClick = timeline.getSelection();
    Zotero.debug(
      `[ZoteroTimeline][click] selection=${JSON.stringify(selectionAfterClick)}`,
    );

    // The click above selected an item, so clear it before measuring the
    // select -> handle cycle from a known state.
    timeline.setSelection([]);
    await waitFor(
      () =>
        doc.querySelectorAll(".vis-drag-center").length === 0 ? true : null,
      "the drag handle to clear",
    ).catch(() => {});
    const before = doc.querySelectorAll(".vis-drag-center").length;
    timeline.setSelection(["doc-sources:ev-truce"]);
    await waitFor(
      () =>
        doc.querySelectorAll(".vis-drag-center").length === 1 ? true : null,
      "the drag handle to render for the selected item",
    ).catch(() => {});
    const after = doc.querySelectorAll(".vis-drag-center").length;

    timeline.setSelection([]);
    await waitFor(
      () =>
        doc.querySelectorAll(".vis-drag-center").length === 0 ? true : null,
      "the drag handle to clear again",
    ).catch(() => {});
    const afterDeselect = doc.querySelectorAll(".vis-drag-center").length;

    win.removeEventListener("error", onError, true);

    const report = {
      selectionAfterClick,
      before,
      after,
      afterDeselect,
      errors,
    };
    Zotero.debug(`[ZoteroTimeline][drag] ${JSON.stringify(report)}`);

    assert.isEmpty(errors, `selecting threw: ${JSON.stringify(report)}`);
    assert.isNotEmpty(
      selectionAfterClick,
      `a click did not select the item, so Hammer is not recognising gestures. ${JSON.stringify(report)}`,
    );
    assert.equal(
      before,
      0,
      `expected no drag handle before selecting. ${JSON.stringify(report)}`,
    );
    assert.equal(
      after,
      1,
      `selecting should build exactly one drag handle. ${JSON.stringify(report)}`,
    );
    assert.equal(
      afterDeselect,
      0,
      `deselecting should remove the drag handle. ${JSON.stringify(report)}`,
    );
  });
});
