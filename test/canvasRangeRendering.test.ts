import { assert } from "chai";
import { buildTimelineItem } from "../src/modules/timeline/canvas";
import {
  CURRENT_SCHEMA_VERSION,
  type TimelineDocument,
} from "../src/modules/timeline/schema";
import { STORAGE_TAG, listTimelines } from "../src/modules/timeline/storage";
import { createDocumentNote, eraseAllPluginItems } from "./support-pluginItems";

function eventWithDate(date: string) {
  return { id: "e", title: "t", date, sources: [], tags: [] };
}

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

// A separate document, and a separate width-agnostic test, rather than
// growing rangeFixtureDocument above: vis-timeline auto-fits its initial
// window to the full extent of every event on the canvas, and this fixture's
// events deliberately span 1580-2001, over eight times rangeFixtureDocument's
// own 1600-1650 span. Seeding both fixtures into the same test would squeeze
// rangeFixtureDocument's pixel-width assertions down to a couple of pixels
// each and make them meaningless.
function formsFixtureDocument(): TimelineDocument {
  return {
    version: CURRENT_SCHEMA_VERSION,
    id: "doc-forms",
    name: "Forms fixture",
    events: [
      {
        id: "ev-plain",
        title: "A plain date",
        date: "1621-03-09",
        sources: [],
        tags: [],
      },
      {
        id: "ev-uncertain",
        title: "Doubted date",
        date: "1621?",
        sources: [],
        tags: [],
      },
      {
        id: "ev-approximate",
        title: "Imprecise date",
        date: "1580~",
        sources: [],
        tags: [],
      },
      {
        id: "ev-interval",
        title: "A span",
        date: "1580/1590",
        sources: [],
        tags: [],
      },
      {
        id: "ev-one-of",
        title: "One year of these",
        date: "[1580..1590]",
        sources: [],
        tags: [],
      },
      {
        id: "ev-season",
        title: "Spring of 2001",
        date: "2001-21",
        sources: [],
        tags: [],
      },
      {
        id: "ev-list",
        title: "All of these years",
        date: "{1667,1668,1670}",
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

  it("draws each EDTF form as one of five distinguishable classes on the rendered item", async function () {
    this.timeout(60000);

    const api = (Zotero as any).ZoteroTimeline.api;
    const win = Zotero.getMainWindows()[0] as any;
    const doc = win.document;

    // Own fixture (see formsFixtureDocument's own docblock for why), so this
    // test's timeline holds only the forms fixture's events.
    await eraseAllPluginItems(libraryID);
    await createDocumentNote(libraryID, STORAGE_TAG, formsFixtureDocument());

    await api.openTimelineTab();
    await Zotero.Promise.delay(1500);

    const timeline = api.getCurrentTimeline();

    async function classesFor(eventId: string): Promise<DOMTokenList> {
      timeline.setSelection([`doc-forms:${eventId}`]);
      await Zotero.Promise.delay(300);
      const item = doc.querySelector(".vis-item.vis-selected") as HTMLElement;
      assert.ok(item, `no selected item for ${eventId}`);
      return item.classList;
    }

    assert.isFalse(
      (await classesFor("ev-plain")).contains("zt-uncertain"),
      "a plain date must not carry any zt- styling class",
    );
    assert.isFalse((await classesFor("ev-plain")).contains("zt-interval"));
    assert.isFalse((await classesFor("ev-plain")).contains("zt-one-of"));

    assert.isTrue((await classesFor("ev-uncertain")).contains("zt-uncertain"));
    assert.isTrue(
      (await classesFor("ev-approximate")).contains("zt-approximate"),
    );

    // The one-of/interval pair (and the list/season pair below) resolve to
    // the same start/end span but must never draw with the same class - that
    // is the entire point of the form field this styling reads.
    assert.isTrue((await classesFor("ev-interval")).contains("zt-interval"));
    assert.isTrue((await classesFor("ev-one-of")).contains("zt-one-of"));
    assert.isFalse((await classesFor("ev-interval")).contains("zt-one-of"));
    assert.isFalse((await classesFor("ev-one-of")).contains("zt-interval"));

    // Season maps onto the interval styling and list onto one-of (both pairs
    // make the same claim about what is known), rather than either drawing
    // as the plain, unstyled look.
    assert.isTrue((await classesFor("ev-season")).contains("zt-interval"));
    assert.isTrue((await classesFor("ev-list")).contains("zt-one-of"));
  });

  describe("buildTimelineItem's form-to-styling mapping", function () {
    it("maps each of the seven EDTF forms to one of five styling classes", function () {
      assert.isUndefined(
        buildTimelineItem("doc", eventWithDate("1621-03-09")).className,
      );
      assert.equal(
        buildTimelineItem("doc", eventWithDate("1621?")).className,
        "zt-uncertain",
      );
      assert.equal(
        buildTimelineItem("doc", eventWithDate("1580~")).className,
        "zt-approximate",
      );
      assert.equal(
        buildTimelineItem("doc", eventWithDate("1580/1590")).className,
        "zt-interval",
      );
      assert.equal(
        buildTimelineItem("doc", eventWithDate("[1580..1590]")).className,
        "zt-one-of",
      );
      assert.equal(
        buildTimelineItem("doc", eventWithDate("2001-21")).className,
        "zt-interval",
        "a season has real bounds, so it draws with the interval styling",
      );
      assert.equal(
        buildTimelineItem("doc", eventWithDate("{1667,1668,1670}")).className,
        "zt-one-of",
        "a list makes the same claim a one-of set does",
      );
    });
  });
});
