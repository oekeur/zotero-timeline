import { assert } from "chai";
import { type TimelineDocument } from "../src/modules/timeline/schema";
import {
  NOTE_SIZE_BUDGET,
  NOTE_SIZE_CEILING,
  STORAGE_TAG,
  buildNoteHtml,
  clearSizeWarnings,
  listTimelines,
  updateTimelineDocument,
  whenStorageIdle,
} from "../src/modules/timeline/storage";
import {
  createDocumentNote,
  documentNamed,
  eraseAllPluginItems,
} from "./support-pluginItems";

/**
 * An event whose title is `count` astral characters. Each one is a single code
 * point and two UTF-16 code units, which is what separates a correct
 * measurement from a code-point count.
 */
function astralEvent(id: string, count: number) {
  return {
    id,
    title: "\u{1F5FF}".repeat(count),
    date: "1863-07-01",
    sources: [],
    tags: [],
  };
}

describe("storage: the note size ceiling", function () {
  this.timeout(120000);

  let libraryID: number;

  before(function () {
    libraryID = Zotero.Libraries.userLibraryID;
  });

  beforeEach(async function () {
    await eraseAllPluginItems(libraryID);
    clearSizeWarnings();
  });

  afterEach(async function () {
    await whenStorageIdle();
    await eraseAllPluginItems(libraryID);
    clearSizeWarnings();
  });

  /**
   * A document sized so a UTF-16 count crosses the budget while a code-point
   * count of the same content does not. Built deliberately around that gap:
   * this is the fixture that catches the wrong measurement.
   */
  function overBudgetByUtf16Only(): TimelineDocument {
    const doc = documentNamed("A very long chronology", "tl-big");
    // Each astral char is 2 UTF-16 units and 1 code point, so a title of N of
    // them sits at 2N units and N points. Aim between the two.
    // 12 x 20,000 astral chars = 240,000 code points and 480,000 UTF-16 units,
    // which sits above the budget and below the ceiling on the right count and
    // below both on the wrong one.
    const perEvent = 20000;
    const events = [];
    for (let i = 0; i < 12; i += 1) {
      events.push(astralEvent(`e-${i}`, perEvent));
    }
    doc.events = events;
    return doc;
  }

  it("measures the final note content in UTF-16 code units, wrapper included", function () {
    const doc = overBudgetByUtf16Only();
    const html = buildNoteHtml(doc);

    const codePoints = [...html].length;

    assert.isAbove(
      html.length,
      NOTE_SIZE_BUDGET,
      "the fixture is not over budget by a UTF-16 count",
    );
    assert.isBelow(
      codePoints,
      NOTE_SIZE_BUDGET,
      "the fixture does not distinguish a UTF-16 count from a code-point count",
    );
    assert.isBelow(html.length, NOTE_SIZE_CEILING);
  });

  // AC #1 and AC #2
  it("warns once per document per session, however many writes", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      documentNamed("A very long chronology", "tl-big"),
    );
    const big = overBudgetByUtf16Only();

    const warned: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      await updateTimelineDocument(
        () => big,
        "tl-big",
        libraryID,
        (doc) => warned.push(doc.id),
      );
    }

    assert.lengthOf(
      warned,
      1,
      "an oversized document warned on every write rather than once",
    );
  });

  // AC #3
  it("still writes the document it warned about", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      documentNamed("A very long chronology", "tl-big"),
    );
    const big = overBudgetByUtf16Only();

    let warned = 0;
    await updateTimelineDocument(
      () => big,
      "tl-big",
      libraryID,
      () => {
        warned += 1;
      },
    );

    assert.equal(warned, 1);
    const { timelines } = await listTimelines(libraryID);
    assert.lengthOf(timelines, 1);
    assert.lengthOf(
      timelines[0].doc.events,
      big.events.length,
      "the oversized write was blocked or truncated",
    );
  });

  it("says nothing about a document comfortably under the budget", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      documentNamed("Short", "tl-small"),
    );

    let warned = 0;
    await updateTimelineDocument(
      (doc) => ({ ...doc, name: "Still short" }),
      "tl-small",
      libraryID,
      () => {
        warned += 1;
      },
    );

    assert.equal(warned, 0);
  });

  it("keeps the budget below the measured ceiling", function () {
    assert.isBelow(NOTE_SIZE_BUDGET, NOTE_SIZE_CEILING);
  });
});
