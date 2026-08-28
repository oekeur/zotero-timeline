import { assert } from "chai";
import {
  CURRENT_SCHEMA_VERSION,
  type TimelineDocument,
} from "../src/modules/timeline/schema";
import { STORAGE_TAG } from "../src/modules/timeline/storage";
import {
  FIT_BUTTON_CLASS,
  JUMP_BUTTON_CLASS,
  JUMP_ERROR_CLASS,
  JUMP_INPUT_CLASS,
  ZOOM_IN_BUTTON_CLASS,
  ZOOM_OUT_BUTTON_CLASS,
} from "../src/modules/timeline/timelineTab";
import { createDocumentNote, eraseAllPluginItems } from "./support-pluginItems";
import { waitFor } from "./waitFor";

/**
 * The thin chrome around the canvas (TASK-41).
 *
 * Span rather than pixels throughout: zoom and fit are defined by what window
 * the timeline is showing, and asserting on rendered widths would make these
 * depend on the tab's size. getWindow is the same thing the controls act on.
 */
describe("canvas chrome: zoom, fit and jump", function () {
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

  function chromeDocument(
    events: TimelineDocument["events"],
  ): TimelineDocument {
    return {
      version: CURRENT_SCHEMA_VERSION,
      id: "doc-chrome",
      name: "Chrome fixture",
      events,
    };
  }

  const anEvent = (id: string, title: string, date: string) => ({
    id,
    title,
    date,
    sources: [],
    tags: [],
  });

  async function open(events: TimelineDocument["events"]) {
    await createDocumentNote(libraryID, STORAGE_TAG, chromeDocument(events));
    const win = Zotero.getMainWindows()[0] as any;
    await api().openTimelineTab();
    const timeline = (await waitFor(
      () => api().getCurrentTimeline(),
      "the canvas to render",
    )) as any;
    const doc = win.document as Document;
    await waitFor(
      () => doc.querySelector(`.${FIT_BUTTON_CLASS}`),
      "the chrome strip to render",
    );
    // vis runs its own fit-to-content on a deferred tick after construction,
    // so the window keeps moving for a moment after the canvas exists.
    // Reading it before that settles makes every assertion here a race: a
    // zoom gets overwritten by the fit, and a "the view did not move" check
    // sees the fit's move and blames the control.
    let previous: string | null = null;
    await waitFor(
      () => {
        const w = timeline.getWindow();
        const now = `${w.start.valueOf()}:${w.end.valueOf()}`;
        const settled = previous === now;
        previous = now;
        return settled ? true : null;
      },
      "the initial fit to stop moving the window",
      { interval: 100, timeout: 10000 },
    );
    return { doc, timeline };
  }

  const span = (timeline: any) => {
    const w = timeline.getWindow();
    return w.end.valueOf() - w.start.valueOf();
  };

  // AC #1
  it("zooms in, zooms out, and frames every visible event on fit", async function () {
    const { doc, timeline } = await open([
      anEvent("e1", "Early", "1700"),
      anEvent("e2", "Late", "1900"),
    ]);

    const before = span(timeline);
    (doc.querySelector(`.${ZOOM_IN_BUTTON_CLASS}`) as HTMLElement).click();
    const zoomedIn = await waitFor(
      () => (span(timeline) < before ? span(timeline) : null),
      "zoom in to narrow the window",
    );
    assert.isBelow(zoomedIn as number, before, "zoom in did not narrow");

    (doc.querySelector(`.${ZOOM_OUT_BUTTON_CLASS}`) as HTMLElement).click();
    const zoomedOut = await waitFor(
      () => (span(timeline) > (zoomedIn as number) ? span(timeline) : null),
      "zoom out to widen the window",
    );
    assert.isAbove(zoomedOut as number, zoomedIn as number);

    // Fit frames both events, so the window covers 1700 and 1900.
    (doc.querySelector(`.${FIT_BUTTON_CLASS}`) as HTMLElement).click();
    await waitFor(() => {
      const w = timeline.getWindow();
      return w.start.valueOf() <= Date.UTC(1700, 0, 1) &&
        w.end.valueOf() >= Date.UTC(1900, 0, 1)
        ? true
        : null;
    }, "fit to frame every event");
  });

  // AC #2
  it("jumps to a date, keeping the span and changing no selection", async function () {
    const { doc, timeline } = await open([
      anEvent("e1", "Early", "1700"),
      anEvent("e2", "Late", "1900"),
    ]);
    timeline.setSelection(["doc-chrome:e1"]);
    await waitFor(
      () => (timeline.getSelection().length === 1 ? true : null),
      "an event to be selected before the jump",
    );

    const spanBefore = span(timeline);
    const input = doc.querySelector(`.${JUMP_INPUT_CLASS}`) as HTMLInputElement;
    input.value = "1850";
    (doc.querySelector(`.${JUMP_BUTTON_CLASS}`) as HTMLElement).click();

    await waitFor(() => {
      const w = timeline.getWindow();
      return w.start.valueOf() <= Date.UTC(1850, 0, 1) &&
        w.end.valueOf() >= Date.UTC(1850, 0, 1)
        ? true
        : null;
    }, "the window to move onto 1850");

    // The span is preserved, so a jump changes where the view is and not how
    // far it reaches. Allowed a little slack for rounding in vis.
    assert.closeTo(
      span(timeline),
      spanBefore,
      spanBefore * 0.02,
      "the jump changed the zoom as well as the position",
    );
    assert.deepEqual(
      timeline.getSelection(),
      ["doc-chrome:e1"],
      "the jump changed the selection; it is not a search",
    );
  });

  it("declines an unreadable date without moving the view", async function () {
    const { doc, timeline } = await open([anEvent("e1", "Only", "1800")]);
    const before = timeline.getWindow();

    const input = doc.querySelector(`.${JUMP_INPUT_CLASS}`) as HTMLInputElement;
    input.value = "not-a-date";
    (doc.querySelector(`.${JUMP_BUTTON_CLASS}`) as HTMLElement).click();

    const message = (await waitFor(
      () =>
        doc.querySelector(`.${JUMP_ERROR_CLASS}`)?.textContent?.trim() || null,
      "the jump control to say it could not read the date",
    )) as string;
    // Short, and not edtf's grammar dump: that runs to dozens of lines and is
    // diagnostic output rather than something to put in a toolbar.
    assert.isBelow(
      message.length,
      80,
      `the jump error is ${message.length} characters, which is edtf's own dump rather than a message`,
    );
    assert.equal(
      timeline.getWindow().start.valueOf(),
      before.start.valueOf(),
      "an unreadable date still moved the view",
    );
  });

  // AC #3
  it("frames parked events on fit rather than producing an empty view", async function () {
    const { doc, timeline } = await open([
      anEvent("e-broken", "Unreadable", "not-a-date"),
      anEvent("e-also", "Also unreadable", "still-not-a-date"),
    ]);

    (doc.querySelector(`.${FIT_BUTTON_CLASS}`) as HTMLElement).click();
    await Zotero.Promise.delay(400);

    const w = timeline.getWindow();
    assert.isAbove(
      w.end.valueOf() - w.start.valueOf(),
      0,
      "fit produced a zero-width window with only parked events present",
    );
    // The parked items sit at a fabricated anchor; fit has to land on it
    // rather than on some default epoch far away from anything drawn.
    const items = timeline.itemsData.get();
    assert.isNotEmpty(items, "no parked items rendered");
    for (const item of items) {
      const at = new Date(item.start).valueOf();
      assert.isTrue(
        at >= w.start.valueOf() && at <= w.end.valueOf(),
        `fit left a parked event outside the framed window`,
      );
    }
  });

  // AC #4
  it("gives every control a data-l10n-id that resolves to real text", async function () {
    const { doc } = await open([anEvent("e1", "Only", "1800")]);

    const controls = [
      ZOOM_IN_BUTTON_CLASS,
      ZOOM_OUT_BUTTON_CLASS,
      FIT_BUTTON_CLASS,
      JUMP_INPUT_CLASS,
      JUMP_BUTTON_CLASS,
    ];
    for (const cls of controls) {
      const el = doc.querySelector(`.${cls}`) as HTMLElement;
      assert.ok(el, `no control rendered for .${cls}`);
      const id = el.getAttribute("data-l10n-id");
      assert.ok(id, `.${cls} carries no data-l10n-id`);

      // Resolved means the visible text differs from the id and is not empty.
      // An icon-only button carries its label on `title`, since a plain-value
      // Fluent message on an element with children replaces the <img> inside.
      const resolved = await waitFor(
        () =>
          (el.getAttribute("title") || "").trim() ||
          (el.getAttribute("placeholder") || "").trim() ||
          (el.textContent || "").trim() ||
          null,
        `.${cls}'s Fluent message to resolve`,
      );
      assert.notEqual(
        resolved,
        id,
        `.${cls} rendered its raw message id, so the string is missing from the .ftl`,
      );
    }
  });
});
