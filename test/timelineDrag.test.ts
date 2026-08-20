import { assert } from "chai";

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
  it("grows a drag handle only once the item is selected", async function () {
    this.timeout(60000);

    const api = (Zotero as any).ZoteroTimeline.api;
    const win = Zotero.getMainWindows()[0] as any;
    const doc = win.document;

    await api.openTimelineTab();
    await Zotero.Promise.delay(1500);

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
    const item = doc.querySelector(".vis-item") as any;
    assert.ok(item, "no .vis-item present");
    const r = item.getBoundingClientRect();
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
      await Zotero.Promise.delay(80);
    }
    await Zotero.Promise.delay(400);
    const selectionAfterClick = timeline.getSelection();
    Zotero.debug(
      `[ZoteroTimeline][click] selection=${JSON.stringify(selectionAfterClick)}`,
    );

    // The click above selected an item, so clear it before measuring the
    // select -> handle cycle from a known state.
    timeline.setSelection([]);
    await Zotero.Promise.delay(300);
    const before = doc.querySelectorAll(".vis-drag-center").length;
    timeline.setSelection(["doc-sources:ev-truce"]);
    await Zotero.Promise.delay(400);
    const after = doc.querySelectorAll(".vis-drag-center").length;

    timeline.setSelection([]);
    await Zotero.Promise.delay(400);
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
