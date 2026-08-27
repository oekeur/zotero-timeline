import { assert } from "chai";
import {
  buildTimelineItem,
  computeParkedAnchors,
} from "../src/modules/timeline/canvas";
import { toTimelineRange } from "../src/utils/edtfRange";
import {
  CURRENT_SCHEMA_VERSION,
  type Event,
  type TimelineDocument,
} from "../src/modules/timeline/schema";
import { STORAGE_TAG, listTimelines } from "../src/modules/timeline/storage";
import { createDocumentNote, eraseAllPluginItems } from "./support-pluginItems";
import { waitFor } from "./waitFor";

function event(id: string, date: string, extra: Partial<Event> = {}): Event {
  return { id, title: id, date, sources: [], tags: [], ...extra };
}

function doc(id: string, events: Event[]): TimelineDocument {
  return { version: CURRENT_SCHEMA_VERSION, id, name: id, events };
}

// A day-precision EDTF date spans its whole day (edtf@4.11.1: min at
// 00:00:00.000, max at 23:59:59.999), so it is never span-zero on its own.
// Only a fully-timed instant collapses min and max to the same millisecond -
// this is what the zero-span fixtures below use.
const INSTANT = "1700-06-15T00:00:00Z";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The min/max epoch ms of every date string, mirroring readableExtent. */
function extentOf(...dates: string[]): [number, number] {
  const instants = dates.flatMap((value) => {
    const range = toTimelineRange(value);
    return range.end
      ? [range.start.getTime(), range.end.getTime()]
      : [range.start.getTime()];
  });
  return [Math.min(...instants), Math.max(...instants)];
}

/**
 * The exact anchor computeParkedAnchors should produce for an extent, `new
 * Date(...)`'s own millisecond truncation included - a 5% offset on an odd
 * span leaves a sub-millisecond fraction that a Date silently drops, and
 * comparing against the untruncated float fails for the wrong reason.
 */
function expectedAnchorMs(min: number, max: number): number {
  const span = max - min;
  return Math.trunc(max + (span === 0 ? DAY_MS : span * 0.05));
}

describe("parked and flagged events", function () {
  describe("computeParkedAnchors: the anchor math, without a canvas", function () {
    it("anchors five per cent past the latest readable point in the document's own span", function () {
      const document = doc("doc-own-span", [
        event("ev-a", "1700-01-01"),
        event("ev-b", "1701-01-01"),
        event("ev-broken", "not-a-date"),
      ]);
      const expected = expectedAnchorMs(
        ...extentOf("1700-01-01", "1701-01-01"),
      );

      const anchors = computeParkedAnchors(
        new Map([[document.id, document]]),
        new Set([document.id]),
      );
      assert.equal(anchors.get(document.id)!.getTime(), expected);
    });

    it("offsets by one day when the document's readable span is zero", function () {
      const document = doc("doc-zero-span", [
        event("ev-instant", INSTANT),
        event("ev-broken", "not-a-date"),
      ]);
      const expected = expectedAnchorMs(...extentOf(INSTANT));

      const anchors = computeParkedAnchors(
        new Map([[document.id, document]]),
        new Set([document.id]),
      );
      assert.equal(anchors.get(document.id)!.getTime(), expected);
    });

    it("shares one position across every parked event in the same document", function () {
      const readable = event("ev-readable", "1900-01-01");
      const brokenOne = event("ev-broken-1", "not-a-date");
      const brokenTwo = event("ev-broken-2", "also-not-a-date");
      const document = doc("doc-shared", [readable, brokenOne, brokenTwo]);

      const anchors = computeParkedAnchors(
        new Map([[document.id, document]]),
        new Set([document.id]),
      );
      const anchor = anchors.get(document.id);
      const itemOne = buildTimelineItem(document.id, brokenOne, anchor);
      const itemTwo = buildTimelineItem(document.id, brokenTwo, anchor);
      assert.equal(
        (itemOne.start as Date).getTime(),
        (itemTwo.start as Date).getTime(),
      );
    });

    it("borrows the readable extent of another visible document when its own has none", function () {
      const noDates = doc("doc-no-dates", [event("ev-broken", "not-a-date")]);
      const withDates = doc("doc-with-dates", [
        event("ev-a", "1600-01-01"),
        event("ev-b", "1650-01-01"),
      ]);

      const expected = expectedAnchorMs(
        ...extentOf("1600-01-01", "1650-01-01"),
      );

      const anchors = computeParkedAnchors(
        new Map([
          [noDates.id, noDates],
          [withDates.id, withDates],
        ]),
        new Set([noDates.id, withDates.id]),
      );
      assert.equal(anchors.get(noDates.id)!.getTime(), expected);
    });

    it("never borrows from a document that is not currently visible", function () {
      const noDates = doc("doc-no-dates", [event("ev-broken", "not-a-date")]);
      const hidden = doc("doc-hidden", [event("ev-far", "1000-01-01")]);
      const visible = doc("doc-visible", [event("ev-near", "1900-01-01")]);

      const expected = expectedAnchorMs(...extentOf("1900-01-01"));

      const anchors = computeParkedAnchors(
        new Map([
          [noDates.id, noDates],
          [hidden.id, hidden],
          [visible.id, visible],
        ]),
        // doc-hidden deliberately excluded from the visible set.
        new Set([noDates.id, visible.id]),
      );
      assert.equal(anchors.get(noDates.id)!.getTime(), expected);
    });

    it("falls back to today when nothing anywhere is readable", function () {
      const noDatesOne = doc("doc-no-dates-1", [
        event("ev-broken-1", "not-a-date"),
      ]);
      const noDatesTwo = doc("doc-no-dates-2", [
        event("ev-broken-2", "also-not-a-date"),
      ]);

      const anchors = computeParkedAnchors(
        new Map([
          [noDatesOne.id, noDatesOne],
          [noDatesTwo.id, noDatesTwo],
        ]),
        new Set([noDatesOne.id, noDatesTwo.id]),
      );
      assert.closeTo(
        anchors.get(noDatesOne.id)!.getTime(),
        Date.now(),
        10_000,
        "expected a fallback to today when nothing anywhere is readable",
      );
    });
  });

  describe("buildTimelineItem: parked and flagged events", function () {
    it("parks an unreadable date at its anchor, non-editable, styled unreadable, naming edtf's own message", function () {
      const anchor = new Date("1900-01-01T00:00:00Z");
      let message = "";
      try {
        toTimelineRange("not-a-date");
      } catch (err) {
        message = (err as Error).message;
      }
      const item = buildTimelineItem(
        "doc",
        event("ev-broken", "not-a-date"),
        anchor,
      );
      assert.equal((item.start as Date).getTime(), anchor.getTime());
      assert.isUndefined((item as { end?: Date }).end);
      assert.strictEqual(item.editable, false);
      assert.equal(item.className, "zt-unreadable");
      assert.include(item.title, message);
    });

    it("flags an unreadable endDate as a point at the real start, keeping its form styling", function () {
      let message = "";
      try {
        toTimelineRange("not-a-date");
      } catch (err) {
        message = (err as Error).message;
      }
      const item = buildTimelineItem(
        "doc",
        event("ev-flagged", "1621?", { endDate: "not-a-date" }),
      );
      const expectedStart = toTimelineRange("1621?").start;
      assert.equal((item.start as Date).getTime(), expectedStart.getTime());
      assert.isUndefined((item as { end?: Date }).end);
      assert.equal(item.className, "zt-uncertain zt-unreadable");
      assert.notStrictEqual(item.editable, false);
      assert.include(item.title, message);
    });
  });

  // Own fixtures throughout, per canvasRangeRendering.test.ts's own fixture
  // pattern: vis-timeline auto-fits its window to every event's own span, and a
  // shared fixture stretched by an unrelated test breaks pixel assertions
  // elsewhere (see that file's formsFixtureDocument docblock).
  function ownSpanDocument(): TimelineDocument {
    return doc("doc-parked-own-span", [
      event("ev-readable", "1700-01-01"),
      event("ev-later", "1710-01-01"),
      event("ev-broken", "not-a-date"),
    ]);
  }

  function flaggedDocument(): TimelineDocument {
    return doc("doc-flagged", [
      event("ev-flagged", "1800-04-01", { endDate: "not-a-date" }),
    ]);
  }

  function noReadableDateDocument(): TimelineDocument {
    return doc("doc-no-readable-date", [event("ev-broken", "typo")]);
  }

  function borrowSourceDocument(): TimelineDocument {
    return doc("doc-borrow-source", [event("ev-source", "1990-01-01")]);
  }

  describe("canvas: parked and flagged events on a real timeline", function () {
    this.timeout(60000);

    let libraryID: number;
    let api: any;

    before(function () {
      libraryID = Zotero.Libraries.userLibraryID;
      api = (Zotero as any).ZoteroTimeline.api;
    });

    beforeEach(async function () {
      api.closeTimelineTab();
      await eraseAllPluginItems(libraryID);
    });

    afterEach(async function () {
      await eraseAllPluginItems(libraryID);
    });

    it("renders a parked event non-editable with no drag handle, unlike a readable event beside it", async function () {
      this.timeout(60000);
      await createDocumentNote(libraryID, STORAGE_TAG, ownSpanDocument());

      const win = Zotero.getMainWindows()[0] as any;
      const doc = win.document as Document;
      await api.openTimelineTab();
      const timeline = await waitFor(
        () => api.getCurrentTimeline(),
        "the timeline to render",
      );

      // ev-readable has no endDate, but a day-precision date still spans its
      // whole day (edtf@4.11.1), so buildTimelineItem gives it a real `end`
      // and it renders as a RangeItem, one DOM node. A parked item never
      // carries an `end` at all, so it renders as a BoxItem instead - which
      // renders THREE parallel nodes (box, an axis line, an axis dot), all
      // carrying the identical class string including vis-selected, so a bare
      // .vis-selected query can land on any of the three. Only dom.box ever
      // gets a drag handle, so that is the one to target for it.
      timeline.setSelection(["doc-parked-own-span:ev-readable"]);
      const readableItem = await waitFor(
        () => doc.querySelector(".vis-item.vis-range.vis-selected"),
        "the readable event to render selected",
      );
      assert.ok(readableItem, "no selected item for the readable event");
      assert.ok(
        readableItem!.querySelector(".vis-drag-center"),
        "expected a drag handle on a readable, editable event",
      );

      timeline.setSelection(["doc-parked-own-span:ev-broken"]);
      const parkedItem = await waitFor(
        () => doc.querySelector(".vis-item.vis-box.vis-selected"),
        "the parked event to render selected",
      );
      assert.ok(parkedItem, "no selected item for the parked event");
      assert.notOk(
        parkedItem!.querySelector(".vis-drag-center"),
        "a parked event must render with no drag handle",
      );
      assert.isTrue(
        parkedItem!.classList.contains("zt-unreadable"),
        "a parked event must be styled as unreadable",
      );
    });

    it("keeps the stored date string byte-identical after a parked event renders", async function () {
      await createDocumentNote(libraryID, STORAGE_TAG, ownSpanDocument());
      await api.openTimelineTab();
      await waitFor(() => api.getCurrentTimeline(), "the timeline to render");

      const { timelines } = await listTimelines(libraryID);
      const reread = timelines[0].doc.events.find((e) => e.id === "ev-broken");
      assert.equal(reread?.date, "not-a-date");
    });

    it("flags an unreadable endDate as a point at the real start, and keeps it editable", async function () {
      await createDocumentNote(libraryID, STORAGE_TAG, flaggedDocument());

      const win = Zotero.getMainWindows()[0] as any;
      const doc = win.document as Document;
      await api.openTimelineTab();
      const timeline = await waitFor(
        () => api.getCurrentTimeline(),
        "the timeline to render",
      );

      timeline.setSelection(["doc-flagged:ev-flagged"]);
      const item = await waitFor(
        () => doc.querySelector(".vis-item.vis-box.vis-selected"),
        "the flagged event to render selected",
      );
      assert.ok(item, "no selected item for the flagged event");
      assert.isTrue(item!.classList.contains("zt-unreadable"));
      assert.isFalse(
        item!.classList.contains("vis-range"),
        `a flagged event has lost its span and must not render as a range (actual classes: ${item!.className})`,
      );
      assert.ok(
        item!.querySelector(".vis-drag-center"),
        "an unreadable endDate must not park the event - it keeps its drag handle",
      );

      const data = timeline.itemsData.get("doc-flagged:ev-flagged");
      const expectedStart = toTimelineRange("1800-04-01").start;
      assert.equal(
        (data.start as Date).getTime(),
        expectedStart.getTime(),
        "a flagged event keeps its real start",
      );
      assert.isUndefined(
        data.end,
        "a flagged event has lost its span and carries no end",
      );
    });

    it("anchors a parked event with no readable date of its own to another visible timeline, moves it when that timeline is toggled off, and never re-reads a document", async function () {
      await createDocumentNote(
        libraryID,
        STORAGE_TAG,
        noReadableDateDocument(),
      );
      await createDocumentNote(libraryID, STORAGE_TAG, borrowSourceDocument());

      const win = Zotero.getMainWindows()[0] as any;
      const doc = win.document as Document;
      await api.openTimelineTab();
      const timeline = await waitFor(
        () => api.getCurrentTimeline(),
        "the timeline to render",
      );

      const expectedBorrowed = expectedAnchorMs(...extentOf("1990-01-01"));

      const itemId = "doc-no-readable-date:ev-broken";
      const before = timeline.itemsData.get(itemId).start as Date;
      assert.equal(before.getTime(), expectedBorrowed);

      const parsesBefore = api.parsesSoFar();

      const sidebar = doc.getElementById(
        "zoterotimeline-sidebar",
      ) as HTMLElement;
      const row = sidebar.querySelector(
        '[data-timeline-id="doc-borrow-source"]',
      ) as HTMLElement;
      const checkbox = row.querySelector(
        ".zoterotimeline-sidebar-row-visible",
      ) as HTMLInputElement;
      checkbox.click();
      await waitFor(
        () =>
          (timeline.itemsData.get(itemId).start as Date).getTime() !==
          before.getTime()
            ? true
            : null,
        "the parked event's anchor to move after the borrowed timeline is hidden",
      );

      assert.equal(
        api.parsesSoFar(),
        parsesBefore,
        "toggling a timeline's visibility must never re-read a document",
      );

      const after = timeline.itemsData.get(itemId).start as Date;
      assert.closeTo(
        after.getTime(),
        Date.now(),
        10_000,
        "with its only borrowed source hidden, the parked event should fall back to today",
      );
      assert.notEqual(
        after.getTime(),
        before.getTime(),
        "toggling the borrowed timeline off must move the parked event",
      );
    });

    it("never moves a parked event when the view is zoomed", async function () {
      await createDocumentNote(libraryID, STORAGE_TAG, ownSpanDocument());

      await api.openTimelineTab();
      const timeline = await waitFor(
        () => api.getCurrentTimeline(),
        "the timeline to render",
      );

      const itemId = "doc-parked-own-span:ev-broken";
      const before = (timeline.itemsData.get(itemId).start as Date).getTime();

      timeline.zoomIn(0.6);
      // Asserting nothing moves has no condition to poll for.
      await Zotero.Promise.delay(300);

      const after = (timeline.itemsData.get(itemId).start as Date).getTime();
      assert.equal(
        after,
        before,
        "zooming must never move a parked event - its position comes from stored dates, not the viewport",
      );
    });
  });
});
