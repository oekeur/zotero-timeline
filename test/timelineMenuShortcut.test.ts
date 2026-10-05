import { assert } from "chai";
import { eraseAllPluginItems } from "./support-pluginItems";
import { waitFor } from "./waitFor";

const MENU_ID = "zotero-timeline-menuitem-open-timeline";
const TAB_TYPE = "zoterotimeline-timeline";

describe("open the timeline tab from Tools and from Shift+T", function () {
  this.timeout(30000);

  let libraryID: number;
  let api: any;
  let firstWindow: any;

  before(function () {
    libraryID = Zotero.Libraries.userLibraryID;
    api = (Zotero as any).ZoteroTimeline.api;
    firstWindow = Zotero.getMainWindows()[0];
  });

  beforeEach(async function () {
    (Zotero as any).ZoteroTimeline.api.closeTimelineTab();
    await eraseAllPluginItems(libraryID);
  });

  afterEach(async function () {
    try {
      await eraseAllPluginItems(libraryID);
    } catch (error) {
      // A plain Error thrown in a hook reaches the reporter as a bare
      // `undefined`, and a hook that throws fails every spec in every file
      // that runs after it. Name it here or spend the run guessing.
      assert.fail(
        `erasing plugin items failed: ${(error as Error)?.message ?? String(error)} :: ${(error as Error)?.stack ?? ""}`,
      );
    }
  });

  function mainWindow(): any {
    return firstWindow;
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

    await waitFor(() => {
      const tab = timelineTab();
      return tab && api.getCurrentTimeline() ? tab : undefined;
    }, "the timeline tab to open");
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

    // A single synthetic press is dropped in some runs - the listener is
    // registered per window and the press can land before it is attached,
    // which no observable state here distinguishes from a press that simply
    // did nothing. Press on each poll instead of once up front: opening is
    // idempotent (openTimelineTab re-selects an existing tab rather than
    // adding one), and the tab count is asserted at the end, so a press that
    // arrives late cannot produce a second tab.
    const opened = await waitFor(
      () => {
        pressShiftT(win.document.documentElement);
        const tab = timelineTab();
        return tab && api.getCurrentTimeline() ? tab : undefined;
      },
      "the timeline tab to open from Shift+T",
      { timeout: 10000, interval: 250 },
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

  // The case the three elements above cannot express. Zotero's own text fields
  // are XUL custom elements holding their <input> in an open shadow root, and
  // an event crossing that boundary is retargeted to the host, so a guard
  // reading ev.target sees `search-textbox` and lets the keystroke through.
  // Typing a capital T in the quick-search box opened the tab until the guard
  // started reading composedPath()[0] instead. Dispatching at the inner input
  // with composed: true is what a real key press does.
  it("does not fire while focus is in a Zotero field that wraps its input in a shadow root", async function () {
    const win = mainWindow();
    const doc = win.document as Document;

    const host = doc.getElementById("zotero-tb-search-textbox") as any;
    assert.ok(
      host,
      "the quick-search field is missing; this spec proves nothing without it",
    );
    const inner = host.shadowRoot?.querySelector("input") as HTMLElement | null;
    assert.ok(
      inner,
      "the quick-search field no longer wraps an input in a shadow root; retarget this spec at one that does",
    );

    const options = { key: "T", shiftKey: true, bubbles: true, composed: true };
    inner!.dispatchEvent(new win.KeyboardEvent("keydown", options));
    inner!.dispatchEvent(new win.KeyboardEvent("keyup", options));

    await Zotero.Promise.delay(500);
    assert.notOk(
      timelineTab(),
      "Shift+T opened the tab while focus was in the quick-search field",
    );
  });

  // TASK-64. registerTimelineMenu ran once from onStartup and resolved the
  // Tools popup through Zotero.getMainWindow(), so only the windows that
  // existed at startup ever got an entry. Zotero's own UI never holds two
  // main windows at once (every caller of openMainWindow focuses an existing
  // one first), so the real case is macOS reopening a main window after the
  // last one closed. The specs below give the existing window what such a
  // window receives, the plugin's onMainWindowLoad, rather than opening a
  // second window: closing one leaves the first in modal state often enough
  // to stop its timers and cascade through every later file.
  describe("a main window loaded after the plugin started", function () {
    const onMainWindowLoad = (win: any) =>
      (Zotero as any).ZoteroTimeline.hooks.onMainWindowLoad(win);

    function toolsEntries(): NodeListOf<Element> {
      return mainWindow().document.querySelectorAll(
        `#menu_ToolsPopup #${MENU_ID}`,
      );
    }

    it("gives a freshly loaded window its Tools entry", async function () {
      mainWindow().document.getElementById(MENU_ID)?.remove();
      assert.lengthOf(toolsEntries(), 0, "the entry was not removed");

      await onMainWindowLoad(mainWindow());

      assert.lengthOf(
        toolsEntries(),
        1,
        "a freshly loaded window does not carry exactly one Tools > Timeline entry",
      );
    });

    it("does not stack a second Tools entry when the load hook runs again", async function () {
      await onMainWindowLoad(mainWindow());

      assert.lengthOf(
        toolsEntries(),
        1,
        "a second load stacked a duplicate Tools > Timeline entry",
      );
    });
  });
});
