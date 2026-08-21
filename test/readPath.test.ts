import { assert } from "chai";
import {
  STORAGE_TAG,
  VOCABULARY_TAG,
  buildNoteHtml,
  findContainers,
  findOrCreateContainer,
  listTimelines,
  readDocumentFromNote,
} from "../src/modules/timeline/storage";
import {
  createDocumentNote,
  createRawNote,
  documentNamed,
  eraseAllPluginItems,
} from "./support-pluginItems";

describe("storage: the read path", function () {
  this.timeout(60000);

  let libraryID: number;

  before(function () {
    libraryID = Zotero.Libraries.userLibraryID;
  });

  beforeEach(async function () {
    await eraseAllPluginItems(libraryID);
  });

  afterEach(async function () {
    await eraseAllPluginItems(libraryID);
  });

  // AC #4: the fixture is a container holding a timeline, a vocabulary note
  // and an unrelated note the user filed there themselves.
  it("returns every valid timeline and nothing else", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      documentNamed("Abolition"),
    );
    await createRawNote(libraryID, VOCABULARY_TAG, "<p>the vocabulary</p>");
    const container = await findOrCreateContainer(libraryID);
    const plain = new Zotero.Item("note");
    plain.libraryID = libraryID;
    plain.parentItemID = container.id;
    plain.setNote("<p>a note the user wrote</p>");
    await plain.saveTx();

    const { timelines, unreadable } = await listTimelines(libraryID);

    assert.lengthOf(timelines, 1);
    assert.equal(timelines[0].doc.name, "Abolition");
    assert.isEmpty(unreadable);
  });

  // AC #2
  it("lists the readable timelines even when one is corrupt", async function () {
    await createDocumentNote(libraryID, STORAGE_TAG, documentNamed("Good"));
    const bad = await createRawNote(
      libraryID,
      STORAGE_TAG,
      "<p>note</p><pre>{not json at all</pre>",
    );

    const { timelines, unreadable } = await listTimelines(libraryID);

    assert.lengthOf(timelines, 1, "the corrupt document sank the good one");
    assert.equal(timelines[0].doc.name, "Good");
    assert.lengthOf(unreadable, 1);
    assert.equal(unreadable[0].noteItemID, bad.id);
    assert.equal(unreadable[0].reason, "parse-failed");
  });

  it("reports a storage note with no data block rather than skipping it", async function () {
    await createRawNote(libraryID, STORAGE_TAG, "<p>somebody emptied this</p>");

    const { timelines, unreadable } = await listTimelines(libraryID);

    assert.isEmpty(timelines);
    assert.lengthOf(unreadable, 1);
    assert.equal(unreadable[0].reason, "block-missing");
  });

  it("reports a document that parses but does not validate", async function () {
    await createDocumentNote(libraryID, STORAGE_TAG, {
      version: 1,
      id: "tl-2",
      name: "",
      events: [],
    });

    const { unreadable } = await listTimelines(libraryID);

    assert.lengthOf(unreadable, 1);
    assert.equal(unreadable[0].reason, "invalid-schema");
  });

  // AC #3
  it("lists a library with no container as empty rather than creating one", async function () {
    const { timelines, unreadable } = await listTimelines(libraryID);

    assert.isEmpty(timelines);
    assert.isEmpty(unreadable);
    assert.lengthOf(
      await findContainers(libraryID),
      0,
      "listing created a container",
    );
  });

  it("carries date issues out with the document rather than on it", async function () {
    const doc = documentNamed("Dates");
    doc.events[0].date = "notadate";
    await createDocumentNote(libraryID, STORAGE_TAG, doc);

    const { timelines } = await listTimelines(libraryID);

    assert.lengthOf(timelines, 1);
    assert.lengthOf(timelines[0].dateIssues, 1);
    assert.equal(timelines[0].dateIssues[0].eventId, "e-1");
    assert.equal(
      timelines[0].doc.events[0].date,
      "notadate",
      "the unreadable date was rewritten",
    );
  });

  // The <pre> id is dropped by Zotero's own re-serialisation, so the parse
  // must match the tag only. This is the regression that broke silently in
  // mindmap.
  it("reads the data block back after Zotero has re-serialised the note", async function () {
    const note = await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      documentNamed("Round trip"),
    );

    await note.reload(["note"], true);
    const stored = note.getNote();
    assert.notInclude(
      stored,
      'id="zoterotimeline',
      "the fixture is anchoring on an id, which Zotero drops",
    );
    assert.equal(readDocumentFromNote(note).doc.name, "Round trip");
  });

  it("escapes and unescapes a document containing HTML", async function () {
    const doc = documentNamed('A <b>bold</b> & "quoted" title');
    const note = await createDocumentNote(libraryID, STORAGE_TAG, doc);

    await note.reload(["note"], true);

    assert.equal(
      readDocumentFromNote(note).doc.name,
      'A <b>bold</b> & "quoted" title',
    );
  });

  it("wraps a document with a warning a human can read", function () {
    const html = buildNoteHtml(documentNamed("Warned"));

    assert.include(html, "Zotero Timeline");
    assert.include(html, "<pre>");
  });
});
