import { assert } from "chai";
import { eraseAllPluginItems } from "./support-pluginItems";
import { waitFor } from "./waitFor";

// The entry carries no id; its Fluent id is what names it.
const MENU_L10N_ID = "zoterotimeline-menu-tools-timeline";
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

  /**
   * Builds the Tools menu the way opening it does: Zotero's own popupshowing
   * handler on #menu_ToolsPopup is what has Zotero.MenuManager insert the
   * plugin's entry.
   */
  function buildMenu(popupID: string): Element {
    const win = mainWindow();
    const popup = win.document.getElementById(popupID);
    popup.dispatchEvent(new win.Event("popupshowing"));
    popup.dispatchEvent(new win.Event("popuphidden"));
    return popup;
  }

  function entriesIn(popup: Element): NodeListOf<Element> {
    return popup.querySelectorAll(`:scope > [data-l10n-id="${MENU_L10N_ID}"]`);
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
    assert.lengthOf(
      entriesIn(buildMenu("menu_ToolsPopup")),
      1,
      "no timeline menu item under Tools",
    );
    assert.lengthOf(
      entriesIn(buildMenu("menu_FilePopup")),
      0,
      "the timeline menu item is registered under File",
    );
  });

  it("opens the tab on the current library from the Tools menu entry", async function () {
    const win = mainWindow();
    // Built and left showing: Zotero removes the entry's command listener
    // once the popup hides.
    const popup = win.document.getElementById("menu_ToolsPopup");
    popup.dispatchEvent(new win.Event("popupshowing"));
    const entry = entriesIn(popup)[0] as any;
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

  // TASK-64 was a window opened after startup getting no Tools entry. Zotero
  // builds the entry into whichever main window opens its Tools menu, so the
  // existing window stands in for a freshly loaded one: closing a window
  // leaves the first in modal state often enough to stop its timers and
  // cascade through every later file.
  describe("a main window loaded after the plugin started", function () {
    it("carries exactly one Tools entry, however often the load hook runs", async function () {
      await (Zotero as any).ZoteroTimeline.hooks.onMainWindowLoad(mainWindow());
      await (Zotero as any).ZoteroTimeline.hooks.onMainWindowLoad(mainWindow());

      assert.lengthOf(
        entriesIn(buildMenu("menu_ToolsPopup")),
        1,
        "the window does not carry exactly one Tools > Timeline entry",
      );
    });
  });
});
