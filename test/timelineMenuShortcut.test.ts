import { assert } from "chai";
import { eraseAllPluginItems } from "./support-pluginItems";
import { waitFor } from "./waitFor";

const MENU_ID = "zotero-timeline-menuitem-open-timeline";
const TAB_TYPE = "zoterotimeline-timeline";

describe("open the timeline tab from Tools and from Shift+T", function () {
  this.timeout(30000);

  let libraryID: number;
  // Captured once, not read as getMainWindows()[0] on every call. The specs
  // below open a second main window, and nothing promises that array keeps
  // the original first: resolving it dynamically let later specs drive a
  // window that had already been closed.
  let firstWindow: any;

  before(function () {
    libraryID = Zotero.Libraries.userLibraryID;
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

  /**
   * Opens a second main window and waits for its pane to be usable.
   *
   * Zotero.openMainWindow returns before the window has a document worth
   * asking about, and the plugin's own onMainWindowLoad runs somewhere in
   * there too, so the wait is on the Tools popup existing rather than on the
   * window appearing.
   */
  async function openSecondWindow(): Promise<any> {
    const existing = new Set(Zotero.getMainWindows());
    (Zotero as any).openMainWindow();
    const opened = await waitFor(
      () => Zotero.getMainWindows().find((w: any) => !existing.has(w)),
      "a second main window to open",
      { timeout: 20000, interval: 250 },
    );
    await waitFor(
      () => (opened as any).document?.getElementById("menu_ToolsPopup"),
      "the second window's Tools menu to exist",
      { timeout: 20000, interval: 250 },
    );
    return opened;
  }

  function timelineTabsIn(win: any): any[] {
    return (win.Zotero_Tabs?._tabs ?? []).filter(
      (t: any) => t.type === TAB_TYPE,
    );
  }

  async function closeWindow(win: any): Promise<void> {
    if (!win || win.closed) {
      return;
    }
    win.close();
    await waitFor(
      () => !Zotero.getMainWindows().includes(win) || undefined,
      "the second main window to close",
      { timeout: 20000, interval: 250 },
    );
    // The rest of the suite drives one window and assumes it is the only one.
    // A second window surviving a spec makes every later canvas and sidebar
    // spec drive whichever window Zotero calls frontmost, which fails far from
    // here and says nothing about why. Asserted rather than hoped for.
    await waitFor(
      () => Zotero.getMainWindows().length === 1 || undefined,
      "exactly one main window to be left behind",
      { timeout: 20000, interval: 250 },
    );
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
        return timelineTab();
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
  // existed at startup ever got an entry.
  describe("a main window opened after the plugin started", function () {
    // Longer than the file's own 30s. Each spec here opens a main window and
    // closes it again, and the teardown waits for the close, for the window
    // count to settle and for the erase, none of which the single-window
    // specs above pay for. A hook that runs past the ceiling reports as a
    // bare `undefined` and fails every file that runs after it.
    this.timeout(120000);

    let second: any;

    afterEach(async function () {
      try {
        await tearDownWindows();
      } catch (error) {
        // The scaffold's reporter drops a plain Error's message and prints a
        // bare `undefined`, so a throw in here says nothing about what broke
        // while failing every spec in every file that runs after it.
        assert.fail(
          `second-window teardown failed: ${(error as Error)?.message ?? String(error)} :: ${(error as Error)?.stack ?? ""}`,
        );
      }
    });

    async function tearDownWindows(): Promise<void> {
      (Zotero as any).ZoteroTimeline.api.closeTimelineTab();
      // Waited for, not fired and forgotten. Zotero_Tabs.close() runs the
      // tab's onClose asynchronously, and that is what releases the canvas
      // refresh observer; erasing the notes while it is still registered
      // makes the observer rebuild against items that are going away.
      await waitFor(
        () =>
          (Zotero.getMainWindows() as any[]).every(
            (w) =>
              !(w.Zotero_Tabs?._tabs ?? []).some(
                (t: any) => t.type === TAB_TYPE,
              ),
          ) || undefined,
        "the timeline tab to be gone from every window",
        { timeout: 20000 },
      );
      // Every window that is not the first, rather than whatever `second`
      // holds: a spec that throws between opening a window and assigning it
      // would otherwise leak that window into the rest of the suite.
      for (const win of Zotero.getMainWindows() as any[]) {
        if (win !== firstWindow) {
          await closeWindow(win);
        }
      }
      second = undefined;
      // Erased here rather than left to the outer afterEach, which is not
      // wrapped: this is where it was actually throwing, and an unnamed throw
      // in a hook fails every spec in every file that runs after it while
      // saying nothing about why.
      await eraseAllPluginItems(libraryID);
    }

    // AC #1 and AC #4
    it("carries exactly one Tools entry, and does not add a second to the first window", async function () {
      second = await openSecondWindow();

      const entry = await waitFor(
        () =>
          second.document.querySelector(
            `#menu_ToolsPopup #${MENU_ID}`,
          ) as HTMLElement | null,
        "the Tools entry in the second window",
        { timeout: 20000, interval: 250 },
      );
      assert.ok(entry, "the second window carries no Tools > Timeline entry");

      for (const win of Zotero.getMainWindows() as any[]) {
        assert.lengthOf(
          win.document.querySelectorAll(`#menu_ToolsPopup #${MENU_ID}`),
          1,
          "a window carries more than one Tools > Timeline entry",
        );
      }
    });

    // AC #2
    it("opens the tab in that window, on that window's library", async function () {
      second = await openSecondWindow();
      const entry = (await waitFor(
        () => second.document.getElementById(MENU_ID),
        "the Tools entry in the second window",
        { timeout: 20000, interval: 250 },
      )) as any;

      second.focus();
      entry.dispatchEvent(new second.Event("command", { bubbles: true }));

      await waitFor(
        () => timelineTabsIn(second).length > 0 || undefined,
        "the timeline tab to open in the second window",
        { timeout: 20000 },
      );
      assert.lengthOf(
        timelineTabsIn(mainWindow()),
        0,
        "the tab opened in the first window instead of the one that asked for it",
      );
    });

    // AC #5. One tab for the process, not one per window: every piece of the
    // tab's state is module-level while Zotero_Tabs is per window, so a second
    // tab would overwrite the first one's canvas, observer and tag filter and
    // closing either would tear down the survivor. Asked from another window,
    // the tab is selected where it already is.
    it("selects the existing tab where it already is rather than opening a second", async function () {
      try {
        await selectsExistingTabElsewhere();
      } catch (error) {
        assert.fail(
          `second-window open failed: ${(error as Error)?.message ?? String(error)} :: ${(error as Error)?.stack ?? ""}`,
        );
      }
    });

    async function selectsExistingTabElsewhere(): Promise<void> {
      second = await openSecondWindow();
      const first = mainWindow();

      const firstEntry = first.document.getElementById(MENU_ID) as any;
      first.focus();
      firstEntry.dispatchEvent(new first.Event("command", { bubbles: true }));
      const opened = await waitFor(
        () => timelineTabsIn(first)[0],
        "the timeline tab to open in the first window",
        { timeout: 20000 },
      );

      first.Zotero_Tabs.select("zotero-pane");
      await waitFor(
        () => first.Zotero_Tabs.selectedID === "zotero-pane" || undefined,
        "the first window to move off the timeline tab",
        { timeout: 20000 },
      );

      // Waited for rather than queried: the window's Tools popup exists
      // before the plugin's onMainWindowLoad has put the entry into it, so a
      // direct lookup here is null on roughly a third of runs.
      const secondEntry = (await waitFor(
        () => second.document.getElementById(MENU_ID),
        "the Tools entry in the second window",
        { timeout: 20000, interval: 250 },
      )) as any;
      second.focus();
      secondEntry.dispatchEvent(new second.Event("command", { bubbles: true }));

      await waitFor(
        () => first.Zotero_Tabs.selectedID === opened.id || undefined,
        "the first window's timeline tab to be re-selected",
        { timeout: 20000 },
      );
      assert.lengthOf(
        timelineTabsIn(second),
        0,
        "opening from a second window built a second timeline tab over the first one's state",
      );
      assert.lengthOf(
        timelineTabsIn(first),
        1,
        "a second timeline tab appeared in the first window",
      );
    }

    // The teardown defect this block exposed - onMainWindowUnload released
    // the three database observers and the library-filter prototype patch,
    // all process-wide, so closing a second window left the surviving
    // window's canvas reading a cache nothing evicted - is guarded by
    // test/timelineRefresh.test.ts rather than by a spec here. Measured
    // 2026-09-07: with the teardown put back, four of that file's specs fail,
    // because the specs above put the plugin through a main-window open and
    // close before it runs. A spec here that opened the tab, wrote to a note
    // and then erased it left state the rest of the suite could not recover
    // from, which is a worse trade than borrowing the coverage.

    // AC #4's other half. onMainWindowUnload used to call
    // ztoolkit.unregisterAll(), which removes every element the toolkit made
    // in every window, so closing one window stripped the entry out of the
    // ones still open.
    it("leaves the first window's entry standing when it closes", async function () {
      second = await openSecondWindow();
      await waitFor(
        () => second.document.getElementById(MENU_ID),
        "the Tools entry in the second window",
        { timeout: 20000, interval: 250 },
      );

      await closeWindow(second);
      second = undefined;

      assert.lengthOf(
        mainWindow().document.querySelectorAll(`#menu_ToolsPopup #${MENU_ID}`),
        1,
        "closing the second window removed the first window's Tools entry",
      );
    });
  });
});
