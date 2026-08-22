import { assert } from "chai";
import {
  CURRENT_SCHEMA_VERSION,
  type TimelineDocument,
} from "../src/modules/timeline/schema";
import { STORAGE_TAG, listTimelines } from "../src/modules/timeline/storage";
import { createDocumentNote, eraseAllPluginItems } from "./support-pluginItems";

// buildTimelineItem (canvas.ts) used to read event.date alone through
// toTimelineRange(), so an event that carried a separate endDate rendered as
// a point: the end endpoint TASK-24's editor field and TASK-26's drag
// write-back produced had no rendering of its own. This file seeds an event
// authored with date+endDate directly (not a range folded into date the way
// the existing fixture's ev-truce is) and asserts what only a fix that
// actually reads endDate would produce.
function rangeFixtureDocument(): TimelineDocument {
  return {
    version: CURRENT_SCHEMA_VERSION,
    id: "doc-range",
    name: "Range fixture",
    events: [
      {
        id: "ev-range",
        title: "Siege of Ostend",
        date: "1600-04",
        endDate: "1602-04",
        sources: [],
        tags: [],
      },
      {
        id: "ev-point",
        title: "Fall of Ostend",
        date: "1650-04",
        sources: [],
        tags: [],
      },
    ],
  };
}

function drag(
  win: any,
  handle: any,
  steps: number,
  stepPx: number,
): Promise<void> {
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

  return (async () => {
    pointer("pointerdown", x);
    await Zotero.Promise.delay(60);
    for (let i = 1; i <= steps; i++) {
      x += stepPx;
      pointer("pointermove", x);
      await Zotero.Promise.delay(40);
    }
    pointer("pointerup", x, true);
    await Zotero.Promise.delay(700);
  })();
}

describe("canvas range rendering", function () {
  this.timeout(60000);

  let libraryID: number;

  before(function () {
    libraryID = Zotero.Libraries.userLibraryID;
  });

  beforeEach(async function () {
    (Zotero as any).ZoteroTimeline.api.closeTimelineTab();
    await eraseAllPluginItems(libraryID);
    await createDocumentNote(libraryID, STORAGE_TAG, rangeFixtureDocument());
  });

  afterEach(async function () {
    await eraseAllPluginItems(libraryID);
  });

  async function rangeEvent() {
    const { timelines } = await listTimelines(libraryID);
    return timelines[0].doc.events.find((e) => e.id === "ev-range")!;
  }

  it("renders a date+endDate event as a range spanning both endpoints", async function () {
    this.timeout(60000);

    const api = (Zotero as any).ZoteroTimeline.api;
    const win = Zotero.getMainWindows()[0] as any;
    const doc = win.document;

    await api.openTimelineTab();
    await Zotero.Promise.delay(1500);

    const timeline = api.getCurrentTimeline();

    // Every EDTF value spans at least its own precision (a month-precision
    // date covers that whole month), so both events below render with the
    // "vis-range" class regardless of endDate - that class alone cannot
    // distinguish them. What only reading endDate produces is width: ev-range
    // spans date (1600-04) to endDate (1602-04), about two years, while
    // ev-point is a bare month-precision date with no endDate at all, about
    // one month. Without the fix, ev-range's end would still come from
    // toTimelineRange(event.date) alone (the month "1600-04" itself), so it
    // would render about as narrow as ev-point.
    timeline.setSelection(["doc-range:ev-range"]);
    await Zotero.Promise.delay(300);
    const rangeItem = doc.querySelector(
      ".vis-item.vis-selected",
    ) as HTMLElement;
    assert.ok(rangeItem, "no selected item for the date+endDate event");
    const rangeWidth = rangeItem.getBoundingClientRect().width;

    timeline.setSelection(["doc-range:ev-point"]);
    await Zotero.Promise.delay(300);
    const pointItem = doc.querySelector(
      ".vis-item.vis-selected",
    ) as HTMLElement;
    assert.ok(pointItem, "no selected item for the date-only event");
    const pointWidth = pointItem.getBoundingClientRect().width;

    assert.isAbove(
      rangeWidth,
      pointWidth * 5,
      `expected the date+endDate event (~2 years) to render far wider than the ` +
        `month-precision date-only event (~1 month): range=${rangeWidth}px point=${pointWidth}px`,
    );
  });

  it("moves the endDate endpoint on screen when its edge is dragged", async function () {
    this.timeout(60000);

    const api = (Zotero as any).ZoteroTimeline.api;
    const win = Zotero.getMainWindows()[0] as any;
    const doc = win.document;

    await api.openTimelineTab();
    await Zotero.Promise.delay(1500);

    const timeline = api.getCurrentTimeline();
    timeline.setSelection(["doc-range:ev-range"]);
    await Zotero.Promise.delay(400);

    const handle = doc.querySelector(".vis-drag-right") as HTMLElement;
    assert.ok(
      handle,
      "no right-edge drag handle after selecting the ranged item",
    );
    const item = handle.closest(".vis-item") as HTMLElement;
    assert.ok(item, "no .vis-item ancestor of the drag handle");

    const before = item.getBoundingClientRect();

    await drag(win, handle, 8, 20);

    const after = item.getBoundingClientRect();

    assert.approximately(
      after.left,
      before.left,
      2,
      `resizing the right edge should not move the start endpoint on screen: before=${before.left} after=${after.left}`,
    );
    assert.isAbove(
      Math.abs(after.right - before.right),
      2,
      `dragging the right edge should visibly move the end endpoint on screen: before=${before.right} after=${after.right}`,
    );

    const updated = await rangeEvent();
    assert.equal(
      updated.date,
      "1600-04",
      "the start endpoint's own field should not change",
    );
    assert.notEqual(
      updated.endDate,
      "1602-04",
      "endDate should have been written back with the new end endpoint",
    );
    assert.match(
      updated.endDate ?? "",
      /^\d{4}-\d{2}$/,
      `expected a month-precision endDate, got ${updated.endDate}`,
    );
  });
});
