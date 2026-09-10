import { assert } from "chai";
import { addSource } from "../src/modules/timeline/mutations";
import { clearCache } from "../src/modules/timeline/documentCache";
import { whenStorageIdle } from "../src/modules/timeline/storage";
import { ROW_CLASS } from "../src/modules/timeline/itemPaneSection";
import { documentNamed, eraseAllPluginItems } from "./support-pluginItems";
import { waitFor } from "./waitFor";

describe("adversarial: jump to an event on a hidden timeline", function () {
  this.timeout(60000);

  let libraryID: number;
  let extras: Zotero.Item[];
  let api: any;
  const allowSwitch = () => true;

  before(function () {
    libraryID = Zotero.Libraries.userLibraryID;
    api = (Zotero as any).ZoteroTimeline.api;
    api.setCrossLibrarySwitchConfirmForTests(allowSwitch);
  });

  beforeEach(async function () {
    api.closeTimelineTab();
    await eraseAllPluginItems(libraryID);
    clearCache();
    extras = [];
  });

  afterEach(async function () {
    api.setCrossLibrarySwitchConfirmForTests(allowSwitch);
    api.closeTimelineTab();
    for (const item of extras) {
      await item.eraseTx();
    }
    await whenStorageIdle();
    await eraseAllPluginItems(libraryID);
    clearCache();
  });

  async function regularItem(title = "A cited work"): Promise<Zotero.Item> {
    const item = new Zotero.Item("document");
    item.libraryID = libraryID;
    item.setField("title", title);
    await item.saveTx();
    extras.push(item);
    return item;
  }

  async function documentCitingWritten(
    name: string,
    id: string,
    item: Zotero.Item,
  ) {
    const base = documentNamed(name, id);
    const doc = addSource(base, base.events[0].id, {
      kind: "item",
      libraryID,
      key: item.key,
      typeId: "cites",
    })!;
    return api.createDocumentNoteForTests(libraryID, doc);
  }

  async function clickRow(item: Zotero.Item, documentId: string) {
    const win = Zotero.getMainWindows()[0] as any;
    await win.ZoteroPane.selectItem(item.id);
    const sectionSelector =
      'item-pane-custom-section[data-pane*="citing-events"]';
    const rowSelector = `.${ROW_CLASS}[data-timeline-id="${documentId}"]`;
    const row = await waitFor<HTMLElement>(
      () =>
        win.document
          .querySelector(sectionSelector)
          ?.querySelector('[data-type="body"]')
          ?.querySelector(rowSelector) ?? null,
      `a citing row for document ${documentId} in the real item pane`,
    );
    row.click();
  }

  async function hideViaSidebar(documentId: string) {
    const win = Zotero.getMainWindows()[0] as any;
    const checkbox = await waitFor<HTMLInputElement>(
      () =>
        win.document.querySelector(
          `.zoterotimeline-sidebar-row[data-timeline-id="${documentId}"] .zoterotimeline-sidebar-row-visible`,
        ),
      `the sidebar row for ${documentId}`,
    );
    checkbox.click();
    await waitFor(
      () =>
        api.getVisibleTimelines().some((t: any) => t.doc.id === documentId)
          ? null
          : true,
      `the checkbox to hide ${documentId}`,
    );
  }

  it("leaves the revealed target selected and active", async function () {
    const cited = await regularItem();
    const other = await regularItem("Other");
    await documentCitingWritten("Timeline A", "tl-adv-a", cited);
    await documentCitingWritten("Timeline B", "tl-adv-b", other);
    await api.openTimelineTab();
    await hideViaSidebar("tl-adv-a");

    await clickRow(cited, "tl-adv-a");
    await waitFor(
      () =>
        api.getVisibleTimelines().some((t: any) => t.doc.id === "tl-adv-a")
          ? true
          : null,
      "the jump to reveal tl-adv-a",
    );

    assert.deepEqual(
      api.getCurrentTimeline().getSelection(),
      ["tl-adv-a:e-1"],
      "the jumped-to event must end up selected",
    );
    assert.strictEqual(
      api.getActiveTimeline(),
      "tl-adv-a",
      "the revealed timeline must be the active one",
    );
    const win = Zotero.getMainWindows()[0] as any;
    const drawn = Array.from(
      win.document.querySelectorAll(
        ".zoterotimeline-canvas .vis-item.vis-selected",
      ),
    ) as HTMLElement[];
    const described = drawn.map(
      (el) =>
        `${el.className}|parent=${(el.parentElement as HTMLElement)?.className}|w=${el.offsetWidth}|h=${el.offsetHeight}|text=${(el.textContent ?? "").trim().slice(0, 30)}`,
    );
    assert.isAtLeast(
      drawn.length,
      1,
      `the canvas must draw the selected item; matched: ${described.join(" ;; ")}`,
    );
    assert.isTrue(
      drawn.some((el) => el.offsetWidth > 0 && el.offsetHeight > 0),
      `the selected item must have layout; matched: ${described.join(" ;; ")}`,
    );
    assert.isAtLeast(drawn.length, 1, `matched: ${described.join(" ;; ")}`);
  });

  it("reveals a hidden middle timeline without reordering or hiding the others", async function () {
    const a = await regularItem("Cited A");
    const b = await regularItem("Cited B");
    const c = await regularItem("Cited C");
    await documentCitingWritten("Timeline A", "tl-adv-a", a);
    await documentCitingWritten("Timeline B", "tl-adv-b", b);
    await documentCitingWritten("Timeline C", "tl-adv-c", c);
    await api.openTimelineTab();
    const orderBefore = api.getVisibleTimelines().map((t: any) => t.doc.id);
    await hideViaSidebar("tl-adv-b");

    await clickRow(b, "tl-adv-b");
    await waitFor(
      () =>
        api.getVisibleTimelines().some((t: any) => t.doc.id === "tl-adv-b")
          ? true
          : null,
      "the jump to reveal tl-adv-b",
    );

    assert.deepEqual(
      api.getVisibleTimelines().map((t: any) => t.doc.id),
      orderBefore,
      "the reveal must not reorder or hide the other timelines",
    );
    assert.deepEqual(api.getCurrentTimeline().getSelection(), ["tl-adv-b:e-1"]);
    assert.strictEqual(api.getActiveTimeline(), "tl-adv-b");
  });

  it("reveals through the live canvas after the tab was closed and reopened", async function () {
    const cited = await regularItem();
    const other = await regularItem("Other");
    await documentCitingWritten("Timeline A", "tl-adv-a", cited);
    await documentCitingWritten("Timeline B", "tl-adv-b", other);
    await api.openTimelineTab();
    api.closeTimelineTab();
    await api.openTimelineTab();
    await waitFor(() => api.getCurrentTimeline(), "the reopened timeline tab");
    await hideViaSidebar("tl-adv-a");

    await clickRow(cited, "tl-adv-a");
    await waitFor(
      () =>
        api.getVisibleTimelines().some((t: any) => t.doc.id === "tl-adv-a")
          ? true
          : null,
      "the jump to reveal tl-adv-a after a reopen",
    );
    assert.deepEqual(api.getCurrentTimeline().getSelection(), ["tl-adv-a:e-1"]);
  });

  async function docCitingWithEvent(
    name: string,
    id: string,
    item: Zotero.Item,
    event: any,
  ) {
    const base: any = {
      version: (documentNamed(name, id) as any).version,
      id,
      name,
      events: [event],
    };
    const doc = addSource(base, event.id, {
      kind: "item",
      libraryID,
      key: item.key,
      typeId: "cites",
    })!;
    return api.createDocumentNoteForTests(libraryID, doc);
  }

  function selectedParts(): string[] {
    const win = Zotero.getMainWindows()[0] as any;
    return Array.from(
      win.document.querySelectorAll(
        ".zoterotimeline-canvas .vis-item.vis-selected",
      ),
    ).map(
      (el: any) =>
        `${el.className}|w=${el.offsetWidth}|h=${el.offsetHeight}|text=${(el.textContent ?? "").trim().slice(0, 20)}`,
    );
  }

  it("draws a tracked event after revealing its hidden timeline", async function () {
    const cited = await regularItem();
    const other = await regularItem("Other");
    await docCitingWithEvent("Timeline A", "tl-adv-a", cited, {
      id: "e-1",
      title: "Tracked",
      date: "1863-07-01",
      track: "Trial",
      sources: [],
      tags: [],
    });
    await documentCitingWritten("Timeline B", "tl-adv-b", other);
    await api.openTimelineTab();
    await hideViaSidebar("tl-adv-a");

    await clickRow(cited, "tl-adv-a");
    await waitFor(
      () =>
        api.getVisibleTimelines().some((t: any) => t.doc.id === "tl-adv-a")
          ? true
          : null,
      "the jump to reveal tl-adv-a",
    );
    assert.deepEqual(api.getCurrentTimeline().getSelection(), ["tl-adv-a:e-1"]);
    const parts = selectedParts();
    assert.isAtLeast(
      parts.length,
      1,
      `the tracked event must be drawn as selected; matched: ${parts.join(" ;; ")}`,
    );
  });

  it("draws a parked event after revealing its hidden timeline", async function () {
    const cited = await regularItem();
    const other = await regularItem("Other");
    await docCitingWithEvent("Timeline A", "tl-adv-a", cited, {
      id: "e-1",
      title: "Parked",
      date: "not-a-date",
      sources: [],
      tags: [],
    });
    await documentCitingWritten("Timeline B", "tl-adv-b", other);
    await api.openTimelineTab();
    await hideViaSidebar("tl-adv-a");

    await clickRow(cited, "tl-adv-a");
    await waitFor(
      () =>
        api.getVisibleTimelines().some((t: any) => t.doc.id === "tl-adv-a")
          ? true
          : null,
      "the jump to reveal tl-adv-a",
    );
    assert.deepEqual(api.getCurrentTimeline().getSelection(), ["tl-adv-a:e-1"]);
    const parts = selectedParts();
    assert.isAtLeast(
      parts.length,
      1,
      `the parked event must be drawn as selected; matched: ${parts.join(" ;; ")}`,
    );
  });

  it("reveals the target when every timeline was toggled off", async function () {
    const cited = await regularItem();
    const other = await regularItem("Other");
    await documentCitingWritten("Timeline A", "tl-adv-a", cited);
    await documentCitingWritten("Timeline B", "tl-adv-b", other);
    await api.openTimelineTab();
    await hideViaSidebar("tl-adv-a");
    await hideViaSidebar("tl-adv-b");

    await clickRow(cited, "tl-adv-a");
    await waitFor(
      () =>
        api.getVisibleTimelines().some((t: any) => t.doc.id === "tl-adv-a")
          ? true
          : null,
      "the jump to reveal tl-adv-a from a fully hidden canvas",
    );
    const win = Zotero.getMainWindows()[0] as any;
    assert.isNull(
      win.document.querySelector(".zoterotimeline-canvas-empty-prompt"),
      "the none-visible prompt must be gone once the target is revealed",
    );
    assert.deepEqual(api.getCurrentTimeline().getSelection(), ["tl-adv-a:e-1"]);
    const parts = selectedParts();
    assert.isAtLeast(
      parts.length,
      1,
      `the revealed event must be drawn; matched: ${parts.join(" ;; ")}`,
    );
  });

  it("BASELINE visible target: draws a parked event with no hide involved", async function () {
    const cited = await regularItem();
    const other = await regularItem("Other");
    await docCitingWithEvent("Timeline A", "tl-adv-a", cited, {
      id: "e-1",
      title: "Parked",
      date: "not-a-date",
      sources: [],
      tags: [],
    });
    await documentCitingWritten("Timeline B", "tl-adv-b", other);
    await api.openTimelineTab();

    await clickRow(cited, "tl-adv-a");
    await waitFor(
      () => (api.getCurrentTimeline()?.getSelection().length > 0 ? true : null),
      "the jump to select the parked event on a visible timeline",
    );
    assert.deepEqual(api.getCurrentTimeline().getSelection(), ["tl-adv-a:e-1"]);
  });

  it("BASELINE visible target: parked event where the OTHER timeline is hidden", async function () {
    const cited = await regularItem();
    const other = await regularItem("Other");
    await docCitingWithEvent("Timeline A", "tl-adv-a", cited, {
      id: "e-1",
      title: "Parked",
      date: "not-a-date",
      sources: [],
      tags: [],
    });
    await documentCitingWritten("Timeline B", "tl-adv-b", other);
    await api.openTimelineTab();
    await hideViaSidebar("tl-adv-b");

    await clickRow(cited, "tl-adv-a");
    await waitFor(
      () => (api.getCurrentTimeline()?.getSelection().length > 0 ? true : null),
      "the jump to select the parked event while a sibling is hidden",
    );
    assert.deepEqual(api.getCurrentTimeline().getSelection(), ["tl-adv-a:e-1"]);
  });

  it("SEPARATOR: parked target on a VISIBLE but non-active timeline", async function () {
    const first = await regularItem("First");
    const cited = await regularItem("Parked target");
    await documentCitingWritten("Timeline A", "tl-adv-a", first);
    await docCitingWithEvent("Timeline B", "tl-adv-b", cited, {
      id: "e-1",
      title: "Parked",
      date: "not-a-date",
      sources: [],
      tags: [],
    });
    await api.openTimelineTab();
    await waitFor(
      () => (api.getActiveTimeline() === "tl-adv-a" ? true : null),
      `tl-adv-a to start active (was ${api.getActiveTimeline()})`,
    );

    await clickRow(cited, "tl-adv-b");
    await waitFor(
      () => (api.getActiveTimeline() === "tl-adv-b" ? true : null),
      "the jump to activate tl-adv-b",
    );
    assert.deepEqual(
      api.getCurrentTimeline().getSelection(),
      ["tl-adv-b:e-1"],
      "parked event on a visible, non-active timeline",
    );
  });

  it("SEPARATOR: dated target on a VISIBLE but non-active timeline", async function () {
    const first = await regularItem("First");
    const cited = await regularItem("Dated target");
    await documentCitingWritten("Timeline A", "tl-adv-a", first);
    await documentCitingWritten("Timeline B", "tl-adv-b", cited);
    await api.openTimelineTab();
    await waitFor(
      () => (api.getActiveTimeline() === "tl-adv-a" ? true : null),
      `tl-adv-a to start active (was ${api.getActiveTimeline()})`,
    );

    await clickRow(cited, "tl-adv-b");
    await waitFor(
      () => (api.getActiveTimeline() === "tl-adv-b" ? true : null),
      "the jump to activate tl-adv-b",
    );
    assert.deepEqual(api.getCurrentTimeline().getSelection(), ["tl-adv-b:e-1"]);
  });

  it("SCOPE: a dated hidden target with an unrelated parked timeline loaded", async function () {
    const cited = await regularItem("Dated target");
    const other = await regularItem("Other");
    const third = await regularItem("Parked owner");
    await documentCitingWritten("Timeline A", "tl-adv-a", cited);
    await documentCitingWritten("Timeline B", "tl-adv-b", other);
    await docCitingWithEvent("Timeline C", "tl-adv-c", third, {
      id: "e-1",
      title: "Parked",
      date: "not-a-date",
      sources: [],
      tags: [],
    });
    await api.openTimelineTab();
    await hideViaSidebar("tl-adv-a");

    await clickRow(cited, "tl-adv-a");
    await Zotero.Promise.delay(800);
    assert.deepEqual(
      api.getCurrentTimeline().getSelection(),
      ["tl-adv-a:e-1"],
      `dated target, unrelated parked timeline loaded; visible=${api
        .getVisibleTimelines()
        .map((t: any) => t.doc.id)
        .join("+")} active=${api.getActiveTimeline()}`,
    );
  });

  it("SCOPE: sidebar toggle-on of a hidden parked timeline", async function () {
    const cited = await regularItem();
    const other = await regularItem("Other");
    await docCitingWithEvent("Timeline A", "tl-adv-a", cited, {
      id: "e-1",
      title: "Parked",
      date: "not-a-date",
      sources: [],
      tags: [],
    });
    await documentCitingWritten("Timeline B", "tl-adv-b", other);
    await api.openTimelineTab();
    await hideViaSidebar("tl-adv-a");

    const win = Zotero.getMainWindows()[0] as any;
    const checkbox = win.document.querySelector(
      '.zoterotimeline-sidebar-row[data-timeline-id="tl-adv-a"] .zoterotimeline-sidebar-row-visible',
    ) as HTMLInputElement;
    checkbox.click();
    await Zotero.Promise.delay(500);
    const rows = Array.from(
      win.document.querySelectorAll(".zoterotimeline-sidebar-row"),
    ).map(
      (r: any) =>
        `${r.getAttribute("data-timeline-id")}:checked=${
          (r.querySelector(".zoterotimeline-sidebar-row-visible") as any)
            ?.checked
        }`,
    );
    const drawnLanes = Array.from(
      win.document.querySelectorAll(
        ".zoterotimeline-canvas .vis-labelset .vis-label",
      ),
    ).map((l: any) => (l.textContent ?? "").trim());
    assert.deepEqual(
      api
        .getVisibleTimelines()
        .map((t: any) => t.doc.id)
        .sort(),
      ["tl-adv-a", "tl-adv-b"],
      `toggle-on of a parked timeline; rows=${rows.join(",")} lanes=${drawnLanes.join("|")}`,
    );
    assert.include(
      drawnLanes.join("|"),
      "Timeline A",
      `the toggled-on lane must be drawn; rows=${rows.join(",")} lanes=${drawnLanes.join("|")}`,
    );
  });
});
