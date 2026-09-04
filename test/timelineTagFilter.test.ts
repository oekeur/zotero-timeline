import { assert } from "chai";
import {
  CURRENT_SCHEMA_VERSION,
  type TimelineDocument,
} from "../src/modules/timeline/schema";
import { STORAGE_TAG } from "../src/modules/timeline/storage";
import {
  TAG_FILTER_CHIP_CLASS,
  TAG_FILTER_CHIP_SELECTED_CLASS,
  TAG_FILTER_EMPTY_CLASS,
} from "../src/modules/timeline/tagFilter";
import {
  SAVE_BUTTON_CLASS,
  TAG_INPUT_CLASS,
} from "../src/modules/timeline/eventEditor";
import { createDocumentNote, eraseAllPluginItems } from "./support-pluginItems";
import { waitFor } from "./waitFor";

// Driven entirely through Zotero.ZoteroTimeline.api, the same reason
// timelineSidebar.test.ts is: the sidebar's tag-filter state lives in
// whichever module instance actually opened the tab, not this file's own copy
// of timelineTab.ts.
describe("timeline sidebar: tag filter", function () {
  this.timeout(60000);

  let libraryID: number;
  let api: any;

  function documentWithTags(
    id: string,
    name: string,
    eventTags: string[][],
  ): TimelineDocument {
    return {
      version: CURRENT_SCHEMA_VERSION,
      id,
      name,
      events: eventTags.map((tags, index) => ({
        id: `${id}-e${index}`,
        title: `${name} event ${index}`,
        date: "1600",
        sources: [],
        tags,
      })),
    };
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

  async function openWithTags(): Promise<{
    doc: Document;
    sidebar: HTMLElement;
    itemA: Zotero.Item;
    itemB: Zotero.Item;
  }> {
    const itemA = await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      documentWithTags("doc-a", "A", [["shared", "onlyA", "Case"]]),
    );
    const itemB = await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      documentWithTags("doc-b", "B", [["shared", "onlyB", "case"]]),
    );
    const win = Zotero.getMainWindows()[0] as any;
    const doc = win.document as Document;
    await api.openTimelineTab();
    const sidebar = (await waitFor(() => {
      const el = doc.getElementById("zoterotimeline-sidebar");
      return el && el.querySelector(".zoterotimeline-sidebar-row") ? el : null;
    }, "the sidebar to render its rows")) as HTMLElement;
    // The tag section renders in the same pass as the rows above, but wait
    // for its own chips rather than assuming that ordering holds.
    await waitFor(
      () => sidebar.querySelector(`.${TAG_FILTER_CHIP_CLASS}`),
      "the tag filter to render its chips",
    );
    return { doc, sidebar, itemA, itemB };
  }

  function chipFor(sidebar: HTMLElement, tag: string): HTMLButtonElement {
    return Array.from<HTMLButtonElement>(
      sidebar.querySelectorAll(`.${TAG_FILTER_CHIP_CLASS}`),
    ).find((chip) => chip.textContent === tag) as HTMLButtonElement;
  }

  // The regression this file most needed and did not have. Every other spec
  // here changes the offered set through the sidebar (a toggle, a chip), and
  // all of those already funnel through renderSidebar. An edit made in the
  // EDITOR does not: the write goes to storage, the refresh observer compares
  // the stored document against what is drawn, finds them identical because
  // this tab is what just wrote it, and correctly declines to rebuild. The
  // chip bank was recomputed only by that rebuild, so a tag added here
  // persisted and stayed invisible until the tab was reopened.
  //
  // Asserted through the real editor rather than by calling the change
  // handler, because the handler is exactly the seam that was wired wrong;
  // a test that called it directly would have passed against the bug.
  it("offers a tag added through the editor without reopening the tab", async function () {
    const { doc, sidebar } = await openWithTags();

    assert.notInclude(
      api.getAvailableTags(),
      "freshlyAdded",
      "the fixture already carried the tag this spec adds",
    );

    const timeline = api.getCurrentTimeline();
    const panel = doc.querySelector("#zoterotimeline-editor") as HTMLElement;
    timeline.setSelection(["doc-a:doc-a-e0"]);
    const tagInput = (await waitFor(
      () => panel.querySelector(`.${TAG_INPUT_CLASS}`),
      "the editor's tag input for the selected event",
    )) as HTMLInputElement;

    tagInput.value = "freshlyAdded";
    tagInput.dispatchEvent(
      new (doc.defaultView as any).Event("input", { bubbles: true }),
    );
    tagInput.dispatchEvent(
      new (doc.defaultView as any).KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      }),
    );

    const saveButton = (await waitFor(
      () => panel.querySelector(`.${SAVE_BUTTON_CLASS}`),
      "the editor's save button",
    )) as HTMLButtonElement;
    saveButton.click();

    await waitFor(
      () => (api.getAvailableTags().includes("freshlyAdded") ? true : null),
      "the new tag to reach the offered set",
    );
    await waitFor(
      () => chipFor(sidebar, "freshlyAdded"),
      "a chip for the tag added through the editor",
    );
  });

  it("offers the union of tags on visible timelines only, case-sensitively", async function () {
    await openWithTags();

    assert.sameMembers(
      api.getAvailableTags(),
      ["shared", "onlyA", "onlyB", "Case", "case"],
      "the offered set is not the union of tags on the visible timelines",
    );
  });

  it("drops a tag from the offered set when its only timeline is toggled out of view", async function () {
    const { sidebar } = await openWithTags();

    const row = sidebar.querySelector(
      '[data-timeline-id="doc-a"]',
    ) as HTMLElement;
    const checkbox = row.querySelector(
      ".zoterotimeline-sidebar-row-visible",
    ) as HTMLInputElement;
    checkbox.click();
    await waitFor(
      () => (api.getVisibleTimelines().length === 1 ? true : null),
      "doc-a to leave the visible set",
    );

    assert.sameMembers(
      api.getAvailableTags(),
      ["shared", "onlyB", "case"],
      "onlyA and Case survived toggling their only timeline out of view",
    );
  });

  it("selecting several chips is recorded as a union, and writes to no document", async function () {
    const { sidebar, itemA, itemB } = await openWithTags();

    const bytesBeforeA = itemA.getNote();
    const bytesBeforeB = itemB.getNote();

    const sharedChip = chipFor(sidebar, "shared");
    assert.equal(sharedChip.getAttribute("aria-pressed"), "false");
    sharedChip.click();
    await waitFor(
      () => (api.getSelectedTagFilter().includes("shared") ? true : null),
      "shared to join the selected tag filter",
    );

    // The click rebuilt the sidebar; re-query for the current chip.
    const onlyBChip = chipFor(sidebar, "onlyB");
    onlyBChip.click();
    await waitFor(
      () => (api.getSelectedTagFilter().includes("onlyB") ? true : null),
      "onlyB to join the selected tag filter",
    );

    assert.deepEqual(
      api.getSelectedTagFilter(),
      ["onlyB", "shared"],
      "selecting two chips did not record their union",
    );

    const rerenderedShared = chipFor(sidebar, "shared");
    assert.equal(rerenderedShared.getAttribute("aria-pressed"), "true");
    assert.isTrue(
      rerenderedShared.classList.contains(TAG_FILTER_CHIP_SELECTED_CLASS),
    );

    assert.equal(
      itemA.getNote(),
      bytesBeforeA,
      "selecting tags to filter by wrote to doc-a's stored note",
    );
    assert.equal(
      itemB.getNote(),
      bytesBeforeB,
      "selecting tags to filter by wrote to doc-b's stored note",
    );
  });

  it("clicking a selected chip deselects it", async function () {
    const { sidebar } = await openWithTags();

    let chip = chipFor(sidebar, "shared");
    chip.click();
    await waitFor(
      () => (api.getSelectedTagFilter().includes("shared") ? true : null),
      "shared to be selected",
    );

    chip = chipFor(sidebar, "shared");
    chip.click();
    await waitFor(
      () => (api.getSelectedTagFilter().includes("shared") ? null : true),
      "shared to be deselected",
    );

    assert.deepEqual(api.getSelectedTagFilter(), []);
  });

  it("shows an empty state naming the next move when no tags are on the visible timelines", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      documentWithTags("doc-empty", "Empty", [[]]),
    );
    const win = Zotero.getMainWindows()[0] as any;
    const doc = win.document as Document;
    await api.openTimelineTab();
    const sidebar = (await waitFor(() => {
      const el = doc.getElementById("zoterotimeline-sidebar");
      return el && el.querySelector(".zoterotimeline-sidebar-row") ? el : null;
    }, "the sidebar to render its rows")) as HTMLElement;

    const empty = await waitFor(() => {
      const el = sidebar.querySelector(`.${TAG_FILTER_EMPTY_CLASS}`);
      return el && (el.textContent ?? "") !== "" ? el : null;
    }, "the empty tag-filter message to render and resolve through Fluent");
    assert.isNotEmpty(empty!.textContent);
    assert.notOk(sidebar.querySelector(`.${TAG_FILTER_CHIP_CLASS}`));
  });
});
