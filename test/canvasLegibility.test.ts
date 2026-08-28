import { assert } from "chai";
import { buildTimelineItem } from "../src/modules/timeline/canvas";
import {
  CURRENT_SCHEMA_VERSION,
  type TimelineDocument,
} from "../src/modules/timeline/schema";
import { STORAGE_TAG } from "../src/modules/timeline/storage";
import { createDocumentNote, eraseAllPluginItems } from "./support-pluginItems";
import { waitFor } from "./waitFor";

/**
 * A title stays readable and a short event is not an unreadable sliver
 * (TASK-44).
 *
 * The mechanism under test is that an event asserting no extent gets no `end`,
 * so vis renders it as a box whose width is its label rather than as a bar
 * whose width is the precision of its date. "Legible" is therefore checked as
 * two things a clipped label cannot satisfy: the box is wide enough to be hit,
 * and its text is not scrolled out of its own content box.
 *
 * Own fixture and its own window, deliberately. vis auto-fits to every event
 * on the canvas, so a shared fixture decides the zoom these assertions are
 * made at, which is exactly the variable this task is about.
 */
describe("legibility of titles and short events", function () {
  this.timeout(60000);

  let libraryID: number;
  const api = () => (Zotero as any).ZoteroTimeline.api;

  before(function () {
    libraryID = Zotero.Libraries.userLibraryID;
  });

  beforeEach(async function () {
    api().closeTimelineTab();
    await eraseAllPluginItems(libraryID);
  });

  afterEach(async function () {
    api().closeTimelineTab();
    await eraseAllPluginItems(libraryID);
  });

  function legibilityDocument(): TimelineDocument {
    return {
      version: CURRENT_SCHEMA_VERSION,
      id: "doc-legible",
      name: "Legibility fixture",
      events: [
        // A single day, the hardest case: its own precision is one day, which
        // on a decade-wide view is far under a pixel.
        {
          id: "ev-day",
          title: "The day the levee broke",
          date: "1927-04-15",
          sources: [],
          tags: [],
        },
        // A year-precision point, the ordinary case.
        {
          id: "ev-year",
          title: "A year with a long enough title to clip",
          date: "1930",
          sources: [],
          tags: [],
        },
        // A genuine extent, which must keep its width.
        {
          id: "ev-span",
          title: "A decade of something",
          date: "1935/1945",
          sources: [],
          tags: [],
        },
      ],
    };
  }

  async function openOn(
    windowStart: string,
    windowEnd: string,
  ): Promise<{ doc: Document; timeline: any }> {
    await createDocumentNote(libraryID, STORAGE_TAG, legibilityDocument());
    const win = Zotero.getMainWindows()[0] as any;
    await api().openTimelineTab();
    const timeline = (await waitFor(
      () => api().getCurrentTimeline(),
      "the canvas to render",
    )) as any;
    // Pin the zoom rather than accepting whatever auto-fit chose, so these
    // assertions are about a stated view width and not about the fixture.
    timeline.setWindow(new Date(windowStart), new Date(windowEnd), {
      animation: false,
    });
    await waitFor(
      () => (win.document as Document).querySelector(".vis-item.vis-box"),
      "a box item to render",
    );
    return { doc: win.document as Document, timeline };
  }

  function boxFor(doc: Document, id: string): HTMLElement | null {
    // The box carries the label; the axis line and dot are the other two nodes
    // of the same item and are a pixel or two wide.
    for (const el of Array.from(
      doc.querySelectorAll(".vis-item.vis-box"),
    ) as HTMLElement[]) {
      if ((el.textContent ?? "").includes(id)) {
        return el;
      }
    }
    return null;
  }

  function isLegible(el: HTMLElement): { wide: boolean; unclipped: boolean } {
    const rect = el.getBoundingClientRect();
    // A box sizes to its content, so a label that fits is one whose scroll
    // width does not exceed the content box it is drawn in. A one-pixel
    // sliver fails the first check; a clipped title fails the second.
    return {
      wide: rect.width >= 20,
      unclipped: el.scrollWidth <= el.clientWidth + 1,
    };
  }

  // AC #2
  it("keeps a one-day event legible on a decade-wide view", async function () {
    const { doc } = await openOn("1925-01-01", "1935-01-01");
    const box = boxFor(doc, "The day the levee broke");
    assert.ok(box, "the one-day event did not render a box carrying its title");
    const { wide, unclipped } = isLegible(box!);
    assert.isTrue(
      wide,
      `a one-day event rendered ${box!.getBoundingClientRect().width}px wide on a decade view`,
    );
    assert.isTrue(unclipped, "the one-day event's title is clipped");
  });

  // AC #3
  it("keeps a point event with no end legible", async function () {
    const built = buildTimelineItem("doc-legible", {
      id: "ev-year",
      title: "A year with a long enough title to clip",
      date: "1930",
      sources: [],
      tags: [],
    } as any) as any;
    assert.isUndefined(
      built.end,
      "a year-precision point still carries an end, so its width still means precision",
    );

    const { doc } = await openOn("1900-01-01", "1960-01-01");
    const box = boxFor(doc, "A year with a long enough title");
    assert.ok(box, "the point event did not render a box carrying its title");
    const { wide, unclipped } = isLegible(box!);
    assert.isTrue(wide, "a point event rendered too narrow to read or hit");
    assert.isTrue(unclipped, "the point event's title is clipped");
  });

  // AC #4
  it("gives a parked event no fabricated width alongside its fabricated position", function () {
    const parked = buildTimelineItem(
      "doc-legible",
      {
        id: "ev-broken",
        title: "Unreadable",
        date: "not-a-date",
        sources: [],
        tags: [],
      } as any,
      new Date("1940-01-01"),
    ) as any;
    assert.isUndefined(
      parked.end,
      "a parked event gained an end, so its fabricated position now carries a fabricated extent too",
    );
    assert.isFalse(parked.editable, "a parked event must not be draggable");
  });

  // An extent must keep its width; this is the half of the change that must
  // NOT have happened, and TASK-28's decision depends on it.
  it("still gives an interval its real extent", function () {
    const span = buildTimelineItem("doc-legible", {
      id: "ev-span",
      title: "A decade of something",
      date: "1935/1945",
      sources: [],
      tags: [],
    } as any) as any;
    assert.ok(span.end, "an EDTF interval lost its extent");
    assert.equal(new Date(span.start).getUTCFullYear(), 1935);
    assert.equal(new Date(span.end).getUTCFullYear(), 1945);
  });

  // AC #5
  it("does not overlap a neighbouring event's title at the zoom levels tried", async function () {
    const { doc, timeline } = await openOn("1920-01-01", "1950-01-01");

    for (const [start, end] of [
      ["1920-01-01", "1950-01-01"],
      ["1925-01-01", "1935-01-01"],
      ["1926-01-01", "1932-01-01"],
    ]) {
      timeline.setWindow(new Date(start), new Date(end), { animation: false });
      await Zotero.Promise.delay(300);

      const boxes = (
        Array.from(doc.querySelectorAll(".vis-item.vis-box")) as HTMLElement[]
      ).map((el) => el.getBoundingClientRect());

      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i];
          const b = boxes[j];
          const overlaps =
            a.left < b.right &&
            b.left < a.right &&
            a.top < b.bottom &&
            b.top < a.bottom;
          assert.isFalse(
            overlaps,
            `two titles overlap at ${start}..${end}: ` +
              `[${Math.round(a.left)},${Math.round(a.top)},${Math.round(a.width)}x${Math.round(a.height)}] and ` +
              `[${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.width)}x${Math.round(b.height)}]`,
          );
        }
      }
    }
  });
});
