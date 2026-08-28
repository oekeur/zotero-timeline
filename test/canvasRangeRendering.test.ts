import { assert } from "chai";
import { buildTimelineItem } from "../src/modules/timeline/canvas";
import {
  CURRENT_SCHEMA_VERSION,
  type TimelineDocument,
} from "../src/modules/timeline/schema";
import { STORAGE_TAG, listTimelines } from "../src/modules/timeline/storage";
import { createDocumentNote, eraseAllPluginItems } from "./support-pluginItems";
import { waitFor } from "./waitFor";

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

// The pacing between pointer events (60ms after down, 40ms per move,
// 700ms after up) is not waiting for an effect to appear - it is what
// vis-timeline's Hammer-based gesture recogniser needs between events to
// recognise a drag at all, plus the drag-end write it fires landing before a
// caller reads storage. There is no DOM state to poll for that stands in for
// "the gesture recogniser saw this as a drag", so this stays a fixed pace.
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

  // This spec and the drag spec below measure vis-timeline's rendered pixel
  // geometry. Converting their waits (getCurrentTimeline() plus a stability
  // poll on the item's own rect and the canvas container's width) passed
  // consistently on its own, but failed the same deterministic way inside
  // the full suite every time - and the pre-conversion fixed-delay version
  // of these two tests, run in that same isolated harness immediately
  // afterward, passed cleanly. That rules out load-driven flakiness as the
  // explanation and points at a real gap in the waitFor conversion's
  // condition rather than a masked product defect - not yet identified
  // within this task's budget, so these two stay on the fixed delay pending
  // that investigation.
  it("renders a date+endDate event as a range spanning both endpoints", async function () {
    this.timeout(60000);

    const api = (Zotero as any).ZoteroTimeline.api;
    const win = Zotero.getMainWindows()[0] as any;
    const doc = win.document;

    // Asserted against the built item rather than by comparing rendered
    // widths. The old comparison measured this range against a date-only
    // event and required it to be five times wider, which worked only while
    // that event was a sub-pixel sliver. Since TASK-44 a date-only event is a
    // box, whose width is its label, so the comparison is between a duration
    // and a piece of text and means nothing. What the criterion actually
    // claims is that the end comes from endDate, and that is checkable
    // directly.
    const built = buildTimelineItem("doc-range", {
      id: "ev-range",
      title: "Siege of Ostend",
      date: "1600-04",
      endDate: "1602-04",
      sources: [],
      tags: [],
    } as any) as any;
    assert.ok(built.end, "a date+endDate event was built with no end at all");
    assert.equal(
      new Date(built.end).getUTCFullYear(),
      1602,
      "the end did not come from endDate; it came from the date's own precision",
    );
    assert.equal(new Date(built.start).getUTCFullYear(), 1600);

    // And a date-only event of the same precision gets no end, which is what
    // stops its title being clipped inside a one-month bar.
    const point = buildTimelineItem("doc-range", {
      id: "ev-point",
      title: "Fall of Ostend",
      date: "1650-04",
      sources: [],
      tags: [],
    } as any) as any;
    assert.isUndefined(
      point.end,
      "a month-precision date with no endDate still produced an end, so its width still means precision",
    );

    // Then that the range really does draw as one on a rendered tab.
    await api.openTimelineTab();
    const timeline = (await waitFor(
      () => api.getCurrentTimeline(),
      "the canvas to render",
    )) as any;
    timeline.setSelection(["doc-range:ev-range"]);
    const rangeItem = (await waitFor(
      () => doc.querySelector(".vis-item.vis-range.vis-selected"),
      "the date+endDate event to render as a selected range",
    )) as HTMLElement;
    assert.ok(rangeItem, "the date+endDate event did not render as a range");
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
    const timeline = await waitFor(
      () => api.getCurrentTimeline(),
      "the timeline to render",
    );

    async function classesFor(eventId: string): Promise<DOMTokenList> {
      timeline.setSelection([`doc-forms:${eventId}`]);
      const item = (await waitFor(
        () => doc.querySelector(".vis-item.vis-selected"),
        `the selected item to render for ${eventId}`,
      )) as HTMLElement;
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
