import { assert } from "chai";
import {
  CURRENT_SCHEMA_VERSION,
  type TimelineDocument,
} from "../src/modules/timeline/schema";
import { buildNoteHtml, STORAGE_TAG } from "../src/modules/timeline/storage";
import {
  SIDEBAR_CREATE_BUTTON_CLASS,
  SIDEBAR_CREATE_NAME_INPUT_CLASS,
  SIDEBAR_ROW_CLASS,
  SIDEBAR_ROW_RENAME_CLASS,
  SIDEBAR_ROW_RENAME_FORM_CLASS,
  SIDEBAR_ROW_RENAME_NAME_INPUT_CLASS,
  SIDEBAR_ROW_UNREADABLE_CLASS,
} from "../src/modules/timeline/timelineTab";
import {
  createDocumentNote,
  createRawNote,
  eraseAllPluginItems,
} from "./support-pluginItems";
import { waitFor } from "./waitFor";

/**
 * The sidebar's unreadable list used to be read once when the tab opened.
 * Corrupting a held note's storage after that point never marked it, and
 * repairing a note corrupted earlier in the same tab session never cleared
 * the mark, because rebuildCanvas's two early returns - the previous-render-
 * standing return for a note that stopped parsing, and the drawnMatches
 * return for a note repaired back to what is already drawn - both left the
 * tab's unreadable list exactly as it was when the tab opened.
 */
describe("the sidebar's unreadable list follows every rebuild pass", function () {
  this.timeout(60000);

  let libraryID: number;

  const api = () => (Zotero as any).ZoteroTimeline.api;

  function doc(id: string, name: string): TimelineDocument {
    return {
      version: CURRENT_SCHEMA_VERSION,
      id,
      name,
      events: [
        {
          id: "e-1",
          title: "First",
          date: "1700",
          sources: [],
          tags: [],
        },
      ],
    };
  }

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

  // Only one note in this fixture ever goes unreadable at a time, so a count
  // of the marker rows is as specific as matching by note id: the
  // Unreadable-timeline label carries no per-note text of its own, and its
  // tooltip cannot be relied on either, since Fluent's DOM overlay treats
  // `title` as one of its own controlled attributes and strips whatever a
  // caller set once the message it applies defines no `title` of its own.
  function unreadableRowCount(): number {
    const win = Zotero.getMainWindows()[0] as any;
    const sidebar = win.document.getElementById("zoterotimeline-sidebar");
    if (!sidebar) {
      return 0;
    }
    return sidebar.querySelectorAll(`.${SIDEBAR_ROW_UNREADABLE_CLASS}`).length;
  }

  function sidebarEl(): HTMLElement | null {
    const win = Zotero.getMainWindows()[0] as any;
    return win.document.getElementById("zoterotimeline-sidebar");
  }

  function createNameInput(): HTMLInputElement | null {
    return (
      (sidebarEl()?.querySelector(
        `.${SIDEBAR_CREATE_NAME_INPUT_CLASS}`,
      ) as HTMLInputElement | null) ?? null
    );
  }

  function openCreateFormAndType(text: string): void {
    (
      sidebarEl()?.querySelector(
        `.${SIDEBAR_CREATE_BUTTON_CLASS}`,
      ) as HTMLButtonElement
    ).click();
    const input = createNameInput()!;
    input.value = text;
    input.dispatchEvent(new Event("input"));
  }

  it("marks a held note unreadable when it stops parsing with the tab open, and clears the mark on repair", async function () {
    await createDocumentNote(libraryID, STORAGE_TAG, doc("doc-kept", "Kept"));
    const corruptedNote = await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      doc("doc-corrupted", "Corrupted"),
    );

    await api().openTimelineTab();
    await waitFor(
      () => (api().getVisibleTimelines() ?? []).length === 2,
      "both fixture timelines to render before either is touched",
    );

    const original = corruptedNote.getNote();

    // Malformed JSON inside the data block, written the way an outside sync
    // or a hand-edit would: the note is saved directly, never through the
    // canvas or storage's own writer.
    await Zotero.DB.executeTransaction(async () => {
      corruptedNote.setNote("<p>corrupt</p><pre>{not valid json</pre>");
      await corruptedNote.save();
    });
    api().refreshObserverForTesting()?.("modify", "item", [corruptedNote.id]);

    await waitFor(
      () => unreadableRowCount() === 1,
      `a diagnostic pass counter of ${api().rebuildPassesSoFar()} at wait start: the sidebar to mark the corrupted note unreadable without reopening the tab`,
    );
    assert.ok(
      (api().getVisibleTimelines() ?? []).some(
        (t: any) => t.doc.id === "doc-corrupted",
      ),
      "the corrupted timeline's lane vanished instead of the previous render standing",
    );

    // Repaired back to exactly what is still drawn - the drawnMatches early
    // return, which redraws nothing at all.
    await Zotero.DB.executeTransaction(async () => {
      corruptedNote.setNote(original);
      await corruptedNote.save();
    });
    api().refreshObserverForTesting()?.("modify", "item", [corruptedNote.id]);

    await waitFor(
      () => unreadableRowCount() === 0,
      "the sidebar to clear the corrupted note's unreadable mark once it parses again",
    );
  });

  it("clears the marker for a note that was already unreadable at tab open once it is erased outright, without reopening the tab", async function () {
    await createDocumentNote(libraryID, STORAGE_TAG, doc("doc-kept", "Kept"));
    const bad = await createRawNote(
      libraryID,
      STORAGE_TAG,
      "<p>x</p><pre>{not valid json</pre>",
    );

    await api().openTimelineTab();
    await waitFor(
      () => unreadableRowCount() === 1,
      "the marker to appear for the note that was already unreadable at open",
    );

    await bad.eraseTx();

    await waitFor(
      () => unreadableRowCount() === 0,
      "the marker to clear once the unreadable note is erased outright, without reopening the tab",
    );
  });

  it("keeps a half-typed create-form name across a stopped-parsing early-return rebuild", async function () {
    await createDocumentNote(libraryID, STORAGE_TAG, doc("doc-kept", "Kept"));
    const held = await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      doc("doc-held", "Held"),
    );

    await api().openTimelineTab();
    await waitFor(
      () => (api().getVisibleTimelines() ?? []).length === 2,
      "both fixture timelines to render before either is touched",
    );

    openCreateFormAndType("half typed");

    await Zotero.DB.executeTransaction(async () => {
      held.setNote("<p>corrupt</p><pre>{not valid json</pre>");
      await held.save();
    });
    api().refreshObserverForTesting()?.("modify", "item", [held.id]);

    await waitFor(
      () => unreadableRowCount() === 1,
      "the marker to appear for the held note that stopped parsing (the stopped-parsing early return)",
    );
    await Zotero.Promise.delay(1500);

    const input = createNameInput();
    assert.ok(
      input,
      "the create form closed on the stopped-parsing early return's renderSidebar",
    );
    assert.equal(
      input!.value,
      "half typed",
      "the half-typed name was lost on the stopped-parsing early return",
    );
  });

  it("keeps a half-typed create-form name across an ordinary full-path rebuild", async function () {
    await createDocumentNote(libraryID, STORAGE_TAG, doc("doc-kept", "Kept"));
    const held = await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      doc("doc-held", "Held"),
    );

    await api().openTimelineTab();
    await waitFor(
      () => (api().getVisibleTimelines() ?? []).length === 2,
      "both fixture timelines to render before either is touched",
    );

    openCreateFormAndType("half typed");
    const before = api().rebuildsSoFar();

    await Zotero.DB.executeTransaction(async () => {
      held.setNote(buildNoteHtml(doc("doc-held", "Renamed")));
      await held.save();
    });
    api().refreshObserverForTesting()?.("modify", "item", [held.id]);

    await waitFor(
      () => api().rebuildsSoFar() > before,
      "a full rebuild triggered by an ordinary readable edit",
    );

    const input = createNameInput();
    assert.ok(input, "the create form closed on the full-path renderSidebar");
    assert.equal(
      input!.value,
      "half typed",
      "the half-typed name was lost on the full path",
    );
  });

  it("seeds a switched rename target's own name rather than the previous row's draft", async function () {
    await createDocumentNote(libraryID, STORAGE_TAG, doc("doc-a", "Alpha"));
    await createDocumentNote(libraryID, STORAGE_TAG, doc("doc-b", "Beta"));

    await api().openTimelineTab();
    await waitFor(
      () => (api().getVisibleTimelines() ?? []).length === 2,
      "both fixture timelines to render",
    );

    (
      sidebarEl()!
        .querySelector('[data-timeline-id="doc-a"]')!
        .querySelector(`.${SIDEBAR_ROW_RENAME_CLASS}`) as HTMLButtonElement
    ).click();
    const inputA = sidebarEl()!.querySelector(
      `.${SIDEBAR_ROW_RENAME_NAME_INPUT_CLASS}`,
    ) as HTMLInputElement;
    inputA.value = "Alpha draft";
    inputA.dispatchEvent(new Event("input"));

    (
      sidebarEl()!
        .querySelector('[data-timeline-id="doc-b"]')!
        .querySelector(`.${SIDEBAR_ROW_RENAME_CLASS}`) as HTMLButtonElement
    ).click();
    const formB = sidebarEl()!.querySelector(
      `.${SIDEBAR_ROW_RENAME_FORM_CLASS}`,
    ) as HTMLElement;
    assert.equal(formB.getAttribute("data-timeline-id"), "doc-b");
    const inputB = formB.querySelector(
      `.${SIDEBAR_ROW_RENAME_NAME_INPUT_CLASS}`,
    ) as HTMLInputElement;
    assert.equal(
      inputB.value,
      "Beta",
      `Beta's rename form opened seeded with "${inputB.value}" instead of its own name`,
    );
  });

  it("opens a rename form for a document id containing a double quote and keeps rendering afterward", async function () {
    const quotedId = 'q"x';
    await createDocumentNote(libraryID, STORAGE_TAG, doc(quotedId, "Quoted"));
    const held = await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      doc("doc-held", "Held"),
    );

    await api().openTimelineTab();
    await waitFor(
      () => (api().getVisibleTimelines() ?? []).length === 2,
      "both fixture timelines to render",
    );

    const errorsBefore = new Set(Zotero.getErrors(true) as string[]);

    const quotedRow = Array.from(
      sidebarEl()!.querySelectorAll(`.${SIDEBAR_ROW_CLASS}`) as Element[],
    ).find((row) => row.getAttribute("data-timeline-id") === quotedId) as
      HTMLElement | undefined;
    assert.ok(quotedRow, "the quoted-id row did not render");
    (
      quotedRow!.querySelector(
        `.${SIDEBAR_ROW_RENAME_CLASS}`,
      ) as HTMLButtonElement
    ).click();

    const forms = sidebarEl()!.querySelectorAll(
      `.${SIDEBAR_ROW_RENAME_FORM_CLASS}`,
    );
    assert.lengthOf(forms, 1, "the rename form did not open for the quoted id");
    const input = forms[0].querySelector(
      `.${SIDEBAR_ROW_RENAME_NAME_INPUT_CLASS}`,
    ) as HTMLInputElement;
    assert.equal(input.value, "Quoted");

    // A held note corrupted while the quoted-id rename form is open still
    // has to reach the sidebar: a selector built from the quoted id must not
    // wedge every later render.
    await Zotero.DB.executeTransaction(async () => {
      held.setNote("<p>corrupt</p><pre>{not valid json</pre>");
      await held.save();
    });
    api().refreshObserverForTesting()?.("modify", "item", [held.id]);

    await waitFor(
      () => unreadableRowCount() === 1,
      "the marker for the held note to appear after the quoted-id rename form opened",
    );

    const newErrors = (Zotero.getErrors(true) as string[]).filter(
      (e) => !errorsBefore.has(e),
    );
    assert.isFalse(
      newErrors.some((e) => e.includes("is not a valid selector")),
      `an invalid-selector error leaked into the console: ${newErrors.join(" | ")}`,
    );
  });
});
