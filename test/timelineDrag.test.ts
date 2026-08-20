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

    api.openTimelineTab();
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

    const before = doc.querySelectorAll(".vis-drag-center").length;
    timeline.setSelection(["doc-sources:ev-truce"]);
    await Zotero.Promise.delay(400);
    const after = doc.querySelectorAll(".vis-drag-center").length;

    timeline.setSelection([]);
    await Zotero.Promise.delay(400);
    const afterDeselect = doc.querySelectorAll(".vis-drag-center").length;

    win.removeEventListener("error", onError, true);

    const report = { before, after, afterDeselect, errors };
    Zotero.debug(`[ZoteroTimeline][drag] ${JSON.stringify(report)}`);

    assert.isEmpty(errors, `selecting threw: ${JSON.stringify(report)}`);
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
