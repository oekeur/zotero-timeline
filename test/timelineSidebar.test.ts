import { assert } from "chai";
import { STORAGE_TAG } from "../src/modules/timeline/storage";
import {
  canvasFixtureDocuments,
  createDocumentNote,
  createRawNote,
  eraseAllPluginItems,
} from "./support-pluginItems";

// Driven entirely through Zotero.ZoteroTimeline.api rather than this test
// bundle's own copy of timelineTab.ts: the sidebar state (the vis groups
// DataSet, the parsed-document cache) lives in whichever module instance
// actually opened the tab, which is the plugin's, not this file's.
describe("timeline sidebar: visibility and order", function () {
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
    for (const document of canvasFixtureDocuments()) {
      await createDocumentNote(libraryID, STORAGE_TAG, document);
    }
  });

  afterEach(async function () {
    await eraseAllPluginItems(libraryID);
  });

  async function openSidebar(): Promise<{
    win: any;
    doc: Document;
    sidebar: HTMLElement;
  }> {
    const win = Zotero.getMainWindows()[0] as any;
    const doc = win.document as Document;
    await api.openTimelineTab();
    await Zotero.Promise.delay(1500);
    const sidebar = doc.getElementById("zoterotimeline-sidebar") as HTMLElement;
    assert.ok(sidebar, "no sidebar element in the tab");
    return { win, doc, sidebar };
  }

  it("lists every readable timeline, and lists an unreadable one rather than omitting it", async function () {
    await createRawNote(
      libraryID,
      STORAGE_TAG,
      "<p>not a timeline document</p>",
    );

    const { sidebar } = await openSidebar();
    // Fluent's DOM observer translates newly inserted data-l10n-id nodes
    // asynchronously; give it a turn before reading rendered text.
    await Zotero.Promise.delay(500);

    const names = Array.from(
      sidebar.querySelectorAll(".zoterotimeline-sidebar-row-name"),
    ).map((el) => el.textContent);
    assert.include(names, "Dutch Revolt");
    assert.include(names, "Source production");

    const unreadableRow = sidebar.querySelector(
      ".zoterotimeline-sidebar-row-unreadable",
    );
    assert.ok(unreadableRow, "no row rendered for the unreadable note");
    const unreadableText =
      unreadableRow!.querySelector(".zoterotimeline-sidebar-row-name")
        ?.textContent ?? "";
    assert.isNotEmpty(unreadableText, "the unreadable row rendered empty");
    assert.notEqual(
      unreadableText,
      "timeline-sidebar-unreadable-label",
      "Fluent did not resolve; the raw message id is showing",
    );
  });

  it("toggling a row's checkbox flips visibility and parses no document", async function () {
    const { sidebar } = await openSidebar();
    await Zotero.Promise.delay(500);

    assert.deepEqual(
      api.getVisibleTimelines().map((t: any) => t.doc.id),
      ["doc-revolt", "doc-sources"],
      "unexpected initial visible order",
    );

    const parsesBefore = api.parsesSoFar();

    const row = sidebar.querySelector(
      '[data-timeline-id="doc-revolt"]',
    ) as HTMLElement;
    const checkbox = row.querySelector(
      ".zoterotimeline-sidebar-row-visible",
    ) as HTMLInputElement;
    assert.isTrue(checkbox.checked, "expected doc-revolt to start visible");
    checkbox.click();
    await Zotero.Promise.delay(300);

    assert.equal(
      api.parsesSoFar(),
      parsesBefore,
      "toggling visibility parsed a document",
    );
    assert.deepEqual(
      api.getVisibleTimelines().map((t: any) => t.doc.id),
      ["doc-sources"],
      "toggling doc-revolt off did not drop it from the visible set",
    );

    // The checkbox above is a stale reference: the change handler that ran it
    // rebuilt the sidebar. Re-query for the current one.
    const rowAfter = sidebar.querySelector(
      '[data-timeline-id="doc-revolt"]',
    ) as HTMLElement;
    const checkboxAfter = rowAfter.querySelector(
      ".zoterotimeline-sidebar-row-visible",
    ) as HTMLInputElement;
    assert.isFalse(checkboxAfter.checked);
  });

  it("moving a row changes the visible order", async function () {
    const { sidebar } = await openSidebar();
    await Zotero.Promise.delay(500);

    assert.deepEqual(
      api.getVisibleTimelines().map((t: any) => t.doc.id),
      ["doc-revolt", "doc-sources"],
      "unexpected initial visible order",
    );

    const row = sidebar.querySelector(
      '[data-timeline-id="doc-sources"]',
    ) as HTMLElement;
    const moveUp = row.querySelector(
      ".zoterotimeline-sidebar-row-move-up",
    ) as HTMLButtonElement;
    assert.isFalse(moveUp.disabled);
    moveUp.click();
    await Zotero.Promise.delay(300);

    assert.deepEqual(
      api.getVisibleTimelines().map((t: any) => t.doc.id),
      ["doc-sources", "doc-revolt"],
      "moving doc-sources up did not change the visible order",
    );
  });

  it("prompts when the toggle reaches zero visible, and clears the prompt once one is back on", async function () {
    const { doc, sidebar } = await openSidebar();
    await Zotero.Promise.delay(500);

    const canvas = doc.getElementById("zoterotimeline-canvas") as HTMLElement;
    assert.notOk(
      canvas.querySelector(".zoterotimeline-canvas-empty-prompt"),
      "the prompt is showing with timelines still visible",
    );

    for (const id of ["doc-revolt", "doc-sources"]) {
      const row = sidebar.querySelector(
        `[data-timeline-id="${id}"]`,
      ) as HTMLElement;
      const checkbox = row.querySelector(
        ".zoterotimeline-sidebar-row-visible",
      ) as HTMLInputElement;
      checkbox.click();
      await Zotero.Promise.delay(300);
    }

    assert.deepEqual(api.getVisibleTimelines(), []);
    const prompt = canvas.querySelector(".zoterotimeline-canvas-empty-prompt");
    assert.ok(prompt, "no prompt shown with zero timelines visible");
    assert.isNotEmpty(prompt!.textContent, "the prompt rendered empty");

    const row = sidebar.querySelector(
      '[data-timeline-id="doc-revolt"]',
    ) as HTMLElement;
    const checkbox = row.querySelector(
      ".zoterotimeline-sidebar-row-visible",
    ) as HTMLInputElement;
    checkbox.click();
    await Zotero.Promise.delay(300);

    assert.notOk(
      canvas.querySelector(".zoterotimeline-canvas-empty-prompt"),
      "the prompt stayed after a timeline was toggled back on",
    );
  });

  // TASK-16 attaches Enter/Space activation to these rows through
  // data-timeline-id; this only guards the property it depends on existing -
  // that a row is a real tab stop, in the order it is drawn.
  it("each sidebar row is keyboard-focusable, in the order the rows are drawn", async function () {
    const { doc, sidebar } = await openSidebar();
    await Zotero.Promise.delay(500);

    const rows = Array.from(
      sidebar.querySelectorAll(
        ".zoterotimeline-sidebar-row:not(.zoterotimeline-sidebar-row-unreadable)",
      ),
    ) as HTMLElement[];
    assert.deepEqual(
      rows.map((row) => row.getAttribute("data-timeline-id")),
      ["doc-revolt", "doc-sources"],
      "rows are not drawn in the visible order",
    );

    for (const row of rows) {
      assert.equal(
        row.tabIndex,
        0,
        `${row.outerHTML} is not a keyboard tab stop`,
      );
    }

    rows[0].focus();
    assert.equal(
      doc.activeElement,
      rows[0],
      "focus() did not land on the first row",
    );
    rows[1].focus();
    assert.equal(
      doc.activeElement,
      rows[1],
      "focus() did not land on the second row",
    );

    // The checkbox and move buttons inside the row keep their own stops -
    // the row is not a focus trap around them.
    const checkbox = rows[0].querySelector(
      ".zoterotimeline-sidebar-row-visible",
    ) as HTMLInputElement;
    checkbox.focus();
    assert.equal(
      doc.activeElement,
      checkbox,
      "the row swallowed focus meant for its own checkbox",
    );
  });
});
