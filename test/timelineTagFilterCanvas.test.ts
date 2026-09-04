import { assert } from "chai";
import {
  CURRENT_SCHEMA_VERSION,
  type Event,
  type TimelineDocument,
} from "../src/modules/timeline/schema";
import { STORAGE_TAG } from "../src/modules/timeline/storage";
import { TAG_FILTER_CHIP_CLASS } from "../src/modules/timeline/tagFilter";
import {
  EMPTY_PROMPT_CLASS,
  TITLE_INPUT_CLASS,
} from "../src/modules/timeline/eventEditor";
import { EDITOR_CLASS } from "../src/modules/timeline/timelineTab";
import { createDocumentNote, eraseAllPluginItems } from "./support-pluginItems";
import { waitFor } from "./waitFor";

// Applying the tag filter to the canvas (TASK-51). Driven through
// Zotero.ZoteroTimeline.api and real DOM/vis-timeline state, the same way
// timelineTagFilter.test.ts drives the chip bank TASK-50 built: the filter
// state lives in whichever module instance actually opened the tab.
describe("timeline canvas: tag filter applied", function () {
  this.timeout(60000);

  let libraryID: number;
  let api: any;

  function event(
    id: string,
    title: string,
    date: string,
    tags: string[],
  ): Event {
    return { id, title, date, sources: [], tags };
  }

  function doc(id: string, name: string, events: Event[]): TimelineDocument {
    return { version: CURRENT_SCHEMA_VERSION, id, name, events };
  }

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

  /**
   * The rendered event titles right now, read off vis-timeline's own DOM
   * rather than a DataSet, since the DataView the filter drives is what the
   * canvas actually paints from. `.vis-item.vis-box, .vis-item.vis-range` is
   * the same "one node per event" selector timelineTab.test.ts's fixture
   * count uses - a point-like item also renders a dot and an axis line
   * carrying the identical content, which would double- or triple-count it.
   */
  function visibleEventTitles(canvasEl: Element): string[] {
    return Array.from<Element>(
      canvasEl.querySelectorAll(".vis-item.vis-box, .vis-item.vis-range"),
    ).map((el) => el.querySelector(".vis-item-content")?.textContent ?? "");
  }

  function chipFor(sidebar: HTMLElement, tag: string): HTMLButtonElement {
    return Array.from<HTMLButtonElement>(
      sidebar.querySelectorAll(`.${TAG_FILTER_CHIP_CLASS}`),
    ).find((chip) => chip.textContent === tag) as HTMLButtonElement;
  }

  it("hides events carrying none of the chosen tags, and keeps the rest", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      doc("doc-a", "A", [
        event("ev-a1", "Alpha One", "1600", ["alpha"]),
        event("ev-a2", "Beta Two", "1650", ["beta"]),
      ]),
    );
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      doc("doc-b", "B", [event("ev-b1", "Beta Three", "1700", ["beta"])]),
    );

    const win = Zotero.getMainWindows()[0] as any;
    const winDoc = win.document as Document;
    await api.openTimelineTab();
    const canvasEl = (await waitFor(() => {
      const el = winDoc.getElementById("zoterotimeline-canvas");
      return el && visibleEventTitles(el).length === 3 ? el : null;
    }, "all three fixture events to render")) as HTMLElement;

    const sidebar = winDoc.getElementById(
      "zoterotimeline-sidebar",
    ) as HTMLElement;
    await waitFor(
      () => sidebar.querySelector(`.${TAG_FILTER_CHIP_CLASS}`),
      "the tag filter to render its chips",
    );
    chipFor(sidebar, "alpha").click();

    await waitFor(
      () => (visibleEventTitles(canvasEl).length === 1 ? true : null),
      "the canvas to narrow to the alpha-tagged event",
    );
    assert.deepEqual(
      visibleEventTitles(canvasEl),
      ["Alpha One"],
      "filtering by alpha left something other than exactly the alpha event",
    );

    // AC#2: a lane whose every event is now hidden (doc-b, all beta) keeps
    // its row rather than collapsing - its checkbox is untouched by the tag
    // filter, only the group-visibility toggle (TASK-39) ever writes it.
    const rowB = sidebar.querySelector(
      '[data-timeline-id="doc-b"]',
    ) as HTMLElement;
    assert.ok(rowB, "doc-b's lane disappeared once its only event was hidden");
    const checkboxB = rowB.querySelector(
      ".zoterotimeline-sidebar-row-visible",
    ) as HTMLInputElement;
    assert.isTrue(
      checkboxB.checked,
      "doc-b's lane was toggled off by the tag filter, which must never touch visibility",
    );
  });

  it("restores every event when the filter is cleared, with no rebuild", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      doc("doc-a", "A", [
        event("ev-a1", "Alpha One", "1600", ["alpha"]),
        event("ev-a2", "Beta Two", "1650", ["beta"]),
      ]),
    );

    const win = Zotero.getMainWindows()[0] as any;
    const winDoc = win.document as Document;
    await api.openTimelineTab();
    const canvasEl = (await waitFor(() => {
      const el = winDoc.getElementById("zoterotimeline-canvas");
      return el && visibleEventTitles(el).length === 2 ? el : null;
    }, "both fixture events to render")) as HTMLElement;

    const sidebar = winDoc.getElementById(
      "zoterotimeline-sidebar",
    ) as HTMLElement;
    await waitFor(
      () => sidebar.querySelector(`.${TAG_FILTER_CHIP_CLASS}`),
      "the tag filter to render its chips",
    );
    chipFor(sidebar, "alpha").click();
    await waitFor(
      () => (visibleEventTitles(canvasEl).length === 1 ? true : null),
      "the filter to narrow the canvas",
    );

    const rebuildsBefore = api.rebuildsSoFar();
    chipFor(sidebar, "alpha").click();
    await waitFor(
      () => (visibleEventTitles(canvasEl).length === 2 ? true : null),
      "clearing the filter to restore both events",
    );
    assert.equal(
      api.rebuildsSoFar(),
      rebuildsBefore,
      "clearing the filter triggered a canvas rebuild, not just a view refresh",
    );
  });

  it("clears the selection and blanks the editor when the filter hides the selected event", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      doc("doc-a", "A", [
        event("ev-a1", "Alpha One", "1600", ["alpha"]),
        event("ev-a2", "Beta Two", "1650", ["beta"]),
      ]),
    );

    const win = Zotero.getMainWindows()[0] as any;
    const winDoc = win.document as Document;
    await api.openTimelineTab();
    const timeline = await waitFor(
      () => api.getCurrentTimeline(),
      "the timeline to render",
    );
    const editor = winDoc.querySelector(`.${EDITOR_CLASS}`) as HTMLElement;

    timeline.setSelection(["doc-a:ev-a2"]);
    await waitFor(
      () => editor.querySelector(`.${TITLE_INPUT_CLASS}`),
      "the editor to open on the selected event",
    );
    assert.equal(
      (editor.querySelector(`.${TITLE_INPUT_CLASS}`) as HTMLInputElement).value,
      "Beta Two",
    );

    const sidebar = winDoc.getElementById(
      "zoterotimeline-sidebar",
    ) as HTMLElement;
    await waitFor(
      () => sidebar.querySelector(`.${TAG_FILTER_CHIP_CLASS}`),
      "the tag filter to render its chips",
    );
    // Selecting alpha hides the beta-tagged event currently selected.
    chipFor(sidebar, "alpha").click();

    await waitFor(
      () => (editor.querySelector(`.${EMPTY_PROMPT_CLASS}`) ? true : null),
      "the editor to blank once its selected event was filtered out",
    );
    assert.notOk(
      editor.querySelector(`.${TITLE_INPUT_CLASS}`),
      "the editor still shows the hidden event's form",
    );
    assert.deepEqual(
      timeline.getSelection(),
      [],
      "the hidden event is still recorded as selected",
    );
  });

  it("filters a parked event by its tags like any other", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      doc("doc-c", "C", [
        event("ev-c-broken", "Parked Alpha", "not-a-date", ["alpha"]),
        event("ev-c-readable", "Readable Beta", "1750", ["beta"]),
      ]),
    );

    const win = Zotero.getMainWindows()[0] as any;
    const winDoc = win.document as Document;
    await api.openTimelineTab();
    const canvasEl = (await waitFor(() => {
      const el = winDoc.getElementById("zoterotimeline-canvas");
      return el && visibleEventTitles(el).length === 2 ? el : null;
    }, "both the parked and readable event to render")) as HTMLElement;

    const sidebar = winDoc.getElementById(
      "zoterotimeline-sidebar",
    ) as HTMLElement;
    await waitFor(
      () => sidebar.querySelector(`.${TAG_FILTER_CHIP_CLASS}`),
      "the tag filter to render its chips",
    );

    chipFor(sidebar, "beta").click();
    await waitFor(
      () => (visibleEventTitles(canvasEl).length === 1 ? true : null),
      "filtering by beta to hide the parked, alpha-tagged event",
    );
    assert.deepEqual(visibleEventTitles(canvasEl), ["Readable Beta"]);

    chipFor(sidebar, "beta").click();
    await waitFor(
      () => (visibleEventTitles(canvasEl).length === 2 ? true : null),
      "clearing the filter to bring the parked event back",
    );
    chipFor(sidebar, "alpha").click();
    await waitFor(
      () => (visibleEventTitles(canvasEl).length === 1 ? true : null),
      "filtering by alpha to hide the readable event, keeping the parked one",
    );
    assert.deepEqual(visibleEventTitles(canvasEl), ["Parked Alpha"]);
  });
});
