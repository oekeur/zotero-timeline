import { assert } from "chai";
import {
  EMPTY_NOTE_LABEL,
  MISSING_ITEM_LABEL,
  UNTITLED_ITEM_LABEL,
  labelForItem,
  labelForSource,
} from "../src/modules/timeline/sourceLabels";
import { eraseAllPluginItems } from "./support-pluginItems";

describe("sourceLabels: naming a picked source", function () {
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

  async function regularItem(title: string): Promise<Zotero.Item> {
    const item = new Zotero.Item("document");
    item.libraryID = libraryID;
    item.setField("title", title);
    await item.saveTx();
    extras.push(item);
    return item;
  }

  async function note(
    html: string,
    parent?: Zotero.Item,
  ): Promise<Zotero.Item> {
    const item = new Zotero.Item("note");
    item.libraryID = libraryID;
    if (parent) {
      item.parentItemID = parent.id;
    }
    item.setNote(html);
    await item.saveTx();
    extras.push(item);
    return item;
  }

  it("labels a regular item by its title", async function () {
    const item = await regularItem("Union of Utrecht");
    assert.equal(labelForItem(item), "Union of Utrecht");
  });

  it("names a regular item with no title rather than rendering it blank", async function () {
    const item = await regularItem("");
    assert.equal(item.getDisplayTitle(), "");
    assert.equal(labelForItem(item), UNTITLED_ITEM_LABEL);
  });

  it("labels a standalone note by a preview of its content, not its derived title", async function () {
    const item = await note("<p>The first line is blank on purpose</p>");
    assert.equal(labelForItem(item), "The first line is blank on purpose");
  });

  it("strips tags and decodes entities in the preview", async function () {
    const item = await note("<p>Q&amp;A</p><p>with a &nbsp;gap</p>");
    assert.equal(labelForItem(item), "Q&A with a gap");
  });

  it("truncates a long note to a fixed preview length", async function () {
    const long = "x".repeat(120);
    const item = await note(`<p>${long}</p>`);
    const label = labelForItem(item);
    assert.isAtMost(label.length, 61); // 60 chars plus the ellipsis
    assert.isTrue(label.endsWith("…"));
  });

  it("names an empty note rather than returning an empty label", async function () {
    const item = await note("<p></p>");
    assert.equal(labelForItem(item), EMPTY_NOTE_LABEL);
  });

  it("shows a child note's parent title after its preview", async function () {
    const parent = await regularItem("Truce negotiations");
    const item = await note("<p>a note under the parent</p>", parent);
    assert.equal(
      labelForItem(item),
      "a note under the parent — Truce negotiations",
    );
  });

  describe("labelForSource: resolving a stored ref", function () {
    it("resolves a ref to the item it points at, the same as labelForItem", async function () {
      const item = await regularItem("Union of Utrecht");
      assert.equal(
        labelForSource({
          kind: "item",
          libraryID,
          key: item.key,
          typeId: "cites",
        }),
        "Union of Utrecht",
      );
    });

    it("names a ref whose item is gone as missing", async function () {
      assert.equal(
        labelForSource({
          kind: "item",
          libraryID,
          key: "MISSING1",
          typeId: "cites",
        }),
        MISSING_ITEM_LABEL,
      );
    });
  });
});
