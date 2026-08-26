import { assert } from "chai";
import { assertEligible } from "../src/modules/timeline/sourcePicker";
import {
  CONTAINER_TAG,
  STORAGE_TAG,
  VOCABULARY_TAG,
  createTaggedNote,
  findOrCreateContainer,
} from "../src/modules/timeline/storage";
import { eraseAllPluginItems } from "./support-pluginItems";

/**
 * assertEligible is what pickSource calls on the item Zotero's own
 * selectItemsDialog hands back, so it is what this suite drives directly: the
 * dialog itself is modal and cannot be opened in an automated run. Which
 * outcome is "picked" vs "cancelled" for pickSource follows from its return
 * type (Zotero.Item vs null) and is otherwise covered by AC #6's human
 * verification.
 */
describe("sourcePicker: what an ineligible pick is rejected for", function () {
  this.timeout(60000);

  let libraryID: number;
  let extras: Zotero.Item[];

  before(function () {
    libraryID = Zotero.Libraries.userLibraryID;
  });

  beforeEach(async function () {
    await eraseAllPluginItems(libraryID);
    extras = [];
  });

  afterEach(async function () {
    for (const item of extras) {
      await item.eraseTx();
    }
    await eraseAllPluginItems(libraryID);
  });

  async function regularItem(): Promise<Zotero.Item> {
    const item = new Zotero.Item("document");
    item.libraryID = libraryID;
    item.setField("title", "A cited work");
    await item.saveTx();
    extras.push(item);
    return item;
  }

  async function standaloneNote(): Promise<Zotero.Item> {
    const note = new Zotero.Item("note");
    note.libraryID = libraryID;
    note.setNote("<p>a standalone note</p>");
    await note.saveTx();
    extras.push(note);
    return note;
  }

  async function childNote(parent: Zotero.Item): Promise<Zotero.Item> {
    const note = new Zotero.Item("note");
    note.libraryID = libraryID;
    note.parentItemID = parent.id;
    note.setNote("<p>a child note</p>");
    await note.saveTx();
    extras.push(note);
    return note;
  }

  async function linkedAttachment(parent: Zotero.Item): Promise<Zotero.Item> {
    const attachment = new Zotero.Item("attachment");
    attachment.libraryID = libraryID;
    attachment.attachmentLinkMode = Zotero.Attachments.LINK_MODE_LINKED_URL;
    attachment.setField("url", "https://example.com/paper");
    attachment.parentItemID = parent.id;
    await attachment.saveTx();
    extras.push(attachment);
    return attachment;
  }

  // AC #1
  it("returns a regular item unchanged", async function () {
    const item = await regularItem();
    assert.strictEqual(assertEligible(item, libraryID), item);
  });

  // AC #2
  it("accepts a standalone note", async function () {
    const note = await standaloneNote();
    assert.strictEqual(assertEligible(note, libraryID), note);
  });

  // AC #2
  it("accepts a child note", async function () {
    const parent = await regularItem();
    const note = await childNote(parent);
    assert.strictEqual(assertEligible(note, libraryID), note);
  });

  // AC #3
  it("rejects an attachment, naming why", async function () {
    const parent = await regularItem();
    const attachment = await linkedAttachment(parent);
    assert.throws(() => assertEligible(attachment, libraryID), /attachment/);
  });

  // AC #4
  it("rejects the container item, identified by tag rather than title", async function () {
    const container = await findOrCreateContainer(libraryID);
    assert.notEqual(
      container.getField("title"),
      undefined,
      "sanity: the container has a title, which the rejection must not rely on",
    );
    assert.throws(() => assertEligible(container, libraryID), /own items/);
  });

  // AC #4
  it("rejects a storage note, identified by tag", async function () {
    const note = await createTaggedNote(
      libraryID,
      STORAGE_TAG,
      "<p>a timeline</p>",
    );
    assert.throws(() => assertEligible(note, libraryID), /own items/);
  });

  // AC #4
  it("rejects the vocabulary note, identified by tag", async function () {
    const note = await createTaggedNote(
      libraryID,
      VOCABULARY_TAG,
      "<p>the vocabulary</p>",
    );
    assert.throws(() => assertEligible(note, libraryID), /own items/);
  });

  // AC #4, negative control: a plain note carrying none of the plugin's tags
  // is not rejected by the tag check.
  it("does not reject a note that happens to share no tag with the plugin's own", async function () {
    const note = await standaloneNote();
    assert.isFalse(
      [CONTAINER_TAG, STORAGE_TAG, VOCABULARY_TAG].some((tag) =>
        note.hasTag(tag),
      ),
    );
    assert.doesNotThrow(() => assertEligible(note, libraryID));
  });

  // AC #5
  it("rejects an item whose library does not match the event's", async function () {
    const item = await regularItem();
    assert.throws(
      () => assertEligible(item, libraryID + 999),
      /another library/,
    );
  });
});
