import { assert } from "chai";

// Attempts a real pan gesture on a selected item's drag handle and reads the
// onMove payload. This is the spike's central question: whether `group` is
// present, and whether it agrees with the document derived from the namespaced
// id. The write-back must never trust item.group.
describe("timeline drag payload", function () {
  it("reports the onMove payload for a dragged range item", async function () {
    this.timeout(60000);

    const api = (Zotero as any).ZoteroTimeline.api;
    const win = Zotero.getMainWindows()[0] as any;
    const doc = win.document;

    await api.openTimelineTab();
    await Zotero.Promise.delay(1500);

    const timeline = api.getCurrentTimeline();
    // The ranged item, so the payload can be checked for `end`.
    timeline.setSelection(["doc-sources:ev-truce"]);
    await Zotero.Promise.delay(400);

    const handle = doc.querySelector(".vis-drag-center") as any;
    assert.ok(handle, "no drag handle after selecting the ranged item");

    const r = handle.getBoundingClientRect();
    let x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top + r.height / 2);
    const PE = win.PointerEvent;

    function pointer(type: string, cx: number, up = false) {
      handle.dispatchEvent(
        new PE(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: cx,
          clientY: y,
          buttons: up ? 0 : 1,
          isPrimary: true,
          pointerId: 1,
          pointerType: "mouse",
          view: win,
        }),
      );
    }

    pointer("pointerdown", x);
    await Zotero.Promise.delay(60);
    for (let i = 1; i <= 10; i++) {
      x += 14;
      pointer("pointermove", x);
      await Zotero.Promise.delay(40);
    }
    pointer("pointerup", x, true);
    await Zotero.Promise.delay(700);

    const payload = api.getLastMovePayload?.();
    Zotero.debug(
      `[ZoteroTimeline][payload] ${JSON.stringify(payload ?? null)}`,
    );

    assert.ok(payload, "onMove never fired for a pan on the drag handle");

    assert.equal(payload.id, "doc-sources:ev-truce");
    assert.equal(payload.derivedDocumentId, "doc-sources");
    assert.isTrue(
      payload.hasEnd,
      `the ranged item reported no end: ${JSON.stringify(payload)}`,
    );
  });
});
