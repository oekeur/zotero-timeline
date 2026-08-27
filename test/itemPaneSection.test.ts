import { assert } from "chai";
import { addSource } from "../src/modules/timeline/mutations";
import { UNKNOWN_TYPE_LABEL } from "../src/modules/timeline/vocabulary";
import { clearCache, parsesSoFar } from "../src/modules/timeline/documentCache";
import {
  CONTAINER_TAG,
  STORAGE_TAG,
  VOCABULARY_TAG,
  findContainers,
  searchVocabularyNotes,
  whenStorageIdle,
} from "../src/modules/timeline/storage";
import {
  EMPTY_CLASS,
  GROUP_CLASS,
  GROUP_HEADING_CLASS,
  ROW_META_CLASS,
  ROW_TITLE_CLASS,
  UNREADABLE_NOTE_CLASS,
  findCitingEvents,
  isEligibleItem,
  renderCitingEventsContent,
} from "../src/modules/timeline/itemPaneSection";
import {
  createDocumentNote,
  createRawNote,
  documentNamed,
  eraseAllPluginItems,
} from "./support-pluginItems";

describe("item-pane section: which events cite this item", function () {
  this.timeout(60000);

  let libraryID: number;
  let extras: Zotero.Item[];

  before(function () {
    libraryID = Zotero.Libraries.userLibraryID;
  });

  beforeEach(async function () {
    await eraseAllPluginItems(libraryID);
    clearCache();
    extras = [];
  });

  afterEach(async function () {
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

  async function documentCiting(
    name: string,
    id: string,
    item: Zotero.Item,
    typeId = "cites",
  ) {
    const base = documentNamed(name, id);
    const doc = addSource(base, base.events[0].id, {
      kind: "item",
      libraryID,
      key: item.key,
      typeId,
    })!;
    return createDocumentNote(libraryID, STORAGE_TAG, doc);
  }

  function container(): HTMLElement {
    const win = Zotero.getMainWindows()[0] as any;
    return win.document.createElement("div");
  }

  describe("eligibility", function () {
    // AC #5
    it("is eligible for a regular item", async function () {
      assert.isTrue(isEligibleItem(await regularItem()));
    });

    it("is not eligible for an attachment", async function () {
      const parent = await regularItem();
      assert.isFalse(isEligibleItem(await linkedAttachment(parent)));
    });

    it("is not eligible for the plugin's own container, storage or vocabulary note", function () {
      for (const tag of [CONTAINER_TAG, STORAGE_TAG, VOCABULARY_TAG]) {
        const item = new Zotero.Item("note");
        item.libraryID = libraryID;
        item.addTag(tag);
        assert.isFalse(isEligibleItem(item), `tag ${tag} was not rejected`);
      }
    });
  });

  describe("findCitingEvents", function () {
    // AC #1, #7
    it("groups matching events by timeline, and names type and reference", async function () {
      const cited = await regularItem();
      await documentCiting("Timeline A", "tl-a", cited, "cites");
      await documentCiting("Timeline B", "tl-b", cited, "supports");

      const { groups, unreadable } = await findCitingEvents(cited);

      assert.isFalse(unreadable);
      assert.lengthOf(groups, 2);
      const ids = groups.map((g) => g.timelineId).sort();
      assert.deepEqual(ids, ["tl-a", "tl-b"]);
      for (const group of groups) {
        assert.lengthOf(group.entries, 1);
        assert.lengthOf(group.entries[0].sources, 1);
      }
    });

    // AC #2
    it("reports cited-by-nothing distinctly from unreadable, when every document reads fine", async function () {
      const cited = await regularItem();
      const other = await regularItem("Not cited");
      await documentCiting("Timeline A", "tl-a", other);

      const { groups, unreadable } = await findCitingEvents(cited);

      assert.isEmpty(groups);
      assert.isFalse(unreadable);
    });

    // AC #2, #3
    it("reports unreadable rather than cited-by-nothing when a document will not parse", async function () {
      const cited = await regularItem();
      await createRawNote(libraryID, STORAGE_TAG, "<p>no data block here</p>");

      const { groups, unreadable } = await findCitingEvents(cited);

      assert.isEmpty(groups);
      assert.isTrue(unreadable);
    });

    // AC #4
    it("parses each document at most once across several selections in the same library", async function () {
      const first = await regularItem("First");
      const second = await regularItem("Second");
      await documentCiting("Timeline A", "tl-a", first);
      await documentCiting("Timeline B", "tl-b", second);

      const before = parsesSoFar();
      await findCitingEvents(first);
      const afterFirst = parsesSoFar();
      assert.equal(
        afterFirst - before,
        2,
        "the first selection did not parse both documents",
      );

      // Arrow-keying to a second item in the same, unchanged library must not
      // re-parse either document.
      await findCitingEvents(second);
      const afterSecond = parsesSoFar();
      assert.equal(
        afterSecond - afterFirst,
        0,
        "selecting a second item re-parsed the library",
      );
    });

    // AC #6
    it("creates neither a container nor a vocabulary note in a library with none", async function () {
      const item = await regularItem();

      await findCitingEvents(item);

      assert.isEmpty(await findContainers(libraryID));
      assert.isEmpty(await searchVocabularyNotes(libraryID));
    });
  });

  describe("renderCitingEventsContent", function () {
    // AC #1, #2
    it("shows the empty state when nothing cites the item", async function () {
      const item = await regularItem();
      const body = container();

      await renderCitingEventsContent(body, item);

      assert.isNotNull(body.querySelector(`.${EMPTY_CLASS}`));
      assert.isNull(body.querySelector(`.${GROUP_CLASS}`));
    });

    // AC #3
    it("shows the unreadable state, not the empty state, when a document will not parse", async function () {
      const item = await regularItem();
      await createRawNote(libraryID, STORAGE_TAG, "<p>no data block here</p>");
      const body = container();

      await renderCitingEventsContent(body, item);

      const empty = body.querySelector(`.${EMPTY_CLASS}`);
      assert.isNotNull(empty);
      assert.equal(
        empty!.getAttribute("data-l10n-id"),
        "zoterotimeline-item-citing-events-unreadable-state",
      );
    });

    // AC #1, #7
    it("renders a group per timeline with the event title and its type", async function () {
      const cited = await regularItem();
      await documentCiting("Timeline A", "tl-a", cited, "cites");
      const body = container();

      await renderCitingEventsContent(body, cited);

      const headings = Array.from(
        body.querySelectorAll(`.${GROUP_HEADING_CLASS}`),
      ).map((el) => el.textContent);
      assert.deepEqual(headings, ["Timeline A"]);
      assert.equal(
        body.querySelector(`.${ROW_TITLE_CLASS}`)!.textContent,
        "Emancipation",
      );
      assert.include(
        body.querySelector(`.${ROW_META_CLASS}`)!.textContent,
        "cites",
      );
    });

    // AC #7
    it("renders the unknown-type label for a typeId that resolves to nothing", async function () {
      const cited = await regularItem();
      await documentCiting("Timeline A", "tl-a", cited, "not-a-real-type");
      const body = container();

      await renderCitingEventsContent(body, cited);

      assert.include(
        body.querySelector(`.${ROW_META_CLASS}`)!.textContent,
        UNKNOWN_TYPE_LABEL,
      );
    });

    // A document unreadable alongside others that resolved: the note still
    // has to say so, not just when it is the reason for an empty state.
    it("adds the unreadable note beside a populated list, not only in place of an empty one", async function () {
      const cited = await regularItem();
      await documentCiting("Timeline A", "tl-a", cited);
      await createRawNote(libraryID, STORAGE_TAG, "<p>no data block here</p>");
      const body = container();

      await renderCitingEventsContent(body, cited);

      assert.isNotNull(body.querySelector(`.${GROUP_CLASS}`));
      assert.isNotNull(body.querySelector(`.${UNREADABLE_NOTE_CLASS}`));
    });
  });
});
