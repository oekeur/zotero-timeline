import { assert } from "chai";
import { eraseAllPluginItems } from "./support-pluginItems";
import { waitFor } from "./waitFor";

const MENU_ID = "zotero-timeline-menuitem-open-timeline";
const TAB_TYPE = "zoterotimeline-timeline";

describe("open the timeline tab from Tools and from Shift+T", function () {
  this.timeout(30000);

  let libraryID: number;

  before(function () {
    libraryID = Zotero.Libraries.userLibraryID;
  });

  beforeEach(async function () {
    (Zotero as any).ZoteroTimeline.api.closeTimelineTab();
    await eraseAllPluginItems(libraryID);
  });

  afterEach(async function () {
    await eraseAllPluginItems(libraryID);
  });

  function mainWindow(): any {
    return Zotero.getMainWindows()[0];
  }

  function timelineTab(): any {
    return mainWindow().Zotero_Tabs._tabs.find((t: any) => t.type === TAB_TYPE);
  }

  // ztoolkit.Keyboard resolves the pressed combination on keyup, not keydown
  // (keydown callbacks receive no `keyboard` field at all), so a real key
  // press has to be simulated as both events in sequence.
  function pressShiftT(target: EventTarget): void {
    const win = mainWindow();
    const options = { key: "T", shiftKey: true, bubbles: true };
    target.dispatchEvent(new win.KeyboardEvent("keydown", options));
    target.dispatchEvent(new win.KeyboardEvent("keyup", options));
  }

  it("registers the menu entry under Tools, not File", function () {
    const doc = mainWindow().document as Document;
    assert.ok(
      doc.querySelector(`#menu_ToolsPopup #${MENU_ID}`),
      "no timeline menu item under Tools",
    );
    assert.isNull(
      doc.querySelector(`#menu_FilePopup #${MENU_ID}`),
      "the timeline menu item is still registered under File",
    );
  });

  it("opens the tab on the current library from the Tools menu entry", async function () {
    const win = mainWindow();
    const entry = win.document.getElementById(MENU_ID) as any;
    assert.ok(entry, "menu entry missing");

    entry.dispatchEvent(new win.Event("command", { bubbles: true }));

    await waitFor(() => timelineTab(), "the timeline tab to open");
  });

  it("opens the tab from Shift+T and re-selects it on a second press rather than adding a second", async function () {
    // The scaffold's reporter drops a plain Error's message and shows a bare
    // `undefined`, while a chai AssertionError survives with its text. waitFor
    // throws a plain Error, so a timeout here is otherwise unreadable: rethrow
    // as an assertion so the condition that never held is named in the output.
    try {
      await shiftTOpensThenReselects();
    } catch (error) {
      assert.fail(
        `Shift+T re-select failed: ${(error as Error)?.message ?? String(error)}`,
      );
    }
  });

  async function shiftTOpensThenReselects(): Promise<void> {
    const win = mainWindow();

    pressShiftT(win.document.documentElement);
    const opened = await waitFor(
      () => timelineTab(),
      "the timeline tab to open from Shift+T",
      { timeout: 10000 },
    );
    // Let the async render settle before switching away, the same margin
    // timelineTab.test.ts gives vis-timeline elsewhere in this suite.
    await Zotero.Promise.delay(1500);

    // Zotero_Tabs.select does not land synchronously, and pressing again
    // mid-transition is dropped rather than queued: wait for the switch to
    // take before asking the shortcut to undo it.
    win.Zotero_Tabs.select("zotero-pane");
    await waitFor(
      () => win.Zotero_Tabs.selectedID === "zotero-pane",
      "the library tab to become selected before the second press",
      { timeout: 10000 },
    );
    assert.notEqual(win.Zotero_Tabs.selectedID, opened.id);

    pressShiftT(win.document.documentElement);
    await waitFor(
      () => win.Zotero_Tabs.selectedID === opened.id,
      "Shift+T to re-select the existing timeline tab",
      { timeout: 10000 },
    );

    const matching = win.Zotero_Tabs._tabs.filter(
      (t: any) => t.type === TAB_TYPE,
    );
    assert.lengthOf(
      matching,
      1,
      "a second Shift+T press must not add a second tab",
    );
  }

  it("does not fire while focus is in an input, a textarea or a contenteditable", async function () {
    const win = mainWindow();
    const doc = win.document as Document;

    const input = doc.createElement("input");
    const textarea = doc.createElement("textarea");
    const editable = doc.createElement("div");
    editable.setAttribute("contenteditable", "true");
    doc.documentElement!.appendChild(input);
    doc.documentElement!.appendChild(textarea);
    doc.documentElement!.appendChild(editable);

    try {
      for (const target of [input, textarea, editable]) {
        pressShiftT(target);
      }
      await Zotero.Promise.delay(500);
      assert.notOk(
        timelineTab(),
        "Shift+T opened the tab while focus was in a text-entry target",
      );
    } finally {
      input.remove();
      textarea.remove();
      editable.remove();
    }
  });
});
