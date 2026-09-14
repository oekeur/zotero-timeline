/**
 * Fixture seeder for the manual user-journey pass
 * (docs/contributing/user-journeys-howto.md).
 *
 * Puts a known set of items and one standalone note into the dev profile's
 * library so a journey run starts from the same library every time instead of
 * whatever the last session left behind. Idempotent: every object is keyed by
 * title inside the fixture collection, so re-running adds nothing and repairs a
 * partial seed.
 *
 * This is NOT a Node script. Zotero's data layer is only reachable from inside
 * a running Zotero, so there is nothing for `node` to attach to; the profile's
 * sqlite is Zotero's private schema plus a sync layer, and writing it from
 * outside is how you corrupt a profile. Run it one of two ways:
 *
 *   Agent:  on the MCP client for this checkout (the port in .env,
 *           ZOTERO_MCP_RDP_PORT), let Zotero read the file rather than pushing
 *           it through the call:  zotero_execute_js with
 *             const src = await Zotero.File.getContentsAsync("<abs path>");
 *             return await eval(src);
 *   Human:  Tools -> Developer -> Run JavaScript, paste, tick "async", Run.
 *
 * It seeds library material only, never timeline documents. The storage format
 * (a JSON blob in a tagged note under a tagged container) lives in
 * src/modules/timeline/storage.ts and a second copy of it here would drift the
 * first time the schema moves; and creating a timeline is the first thing the
 * journeys exercise, so seeding one would skip the interaction the checklist
 * exists to check. A journey that needs a timeline already built says so and
 * points at the step that builds it.
 *
 * Fixtures carry the `_zt-journey-fixture` tag, so a seeded object is always
 * identifiable and can be removed in one search. Titles are historical so the
 * dates on them read naturally on a canvas.
 */
(async () => {
  const COLLECTION_NAME = "Timeline Journeys";
  const TAG = "_zt-journey-fixture";
  const libraryID = Zotero.Libraries.userLibraryID;

  const created = [];
  const skipped = [];
  const failed = [];

  async function ensureCollection() {
    const existing = Zotero.Collections.getByLibrary(libraryID).find(
      (c) => c.name === COLLECTION_NAME,
    );
    if (existing) {
      skipped.push(`collection "${COLLECTION_NAME}"`);
      return existing;
    }
    const collection = new Zotero.Collection();
    collection.libraryID = libraryID;
    collection.name = COLLECTION_NAME;
    await collection.saveTx();
    created.push(`collection "${COLLECTION_NAME}"`);
    return collection;
  }

  const collection = await ensureCollection();

  // Reloaded rather than cached: getChildItems on a collection saved moments
  // ago returns [] until the collection object refreshes.
  function childItems() {
    return Zotero.Collections.get(collection.id).getChildItems();
  }

  function findByTitle(title) {
    return childItems().find((item) => item.getField("title") === title);
  }

  async function ensureRegularItem(itemType, title, fields, creators) {
    if (findByTitle(title)) {
      skipped.push(title);
      return;
    }
    try {
      const item = new Zotero.Item(itemType);
      item.libraryID = libraryID;
      item.setField("title", title);
      for (const [field, value] of Object.entries(fields)) {
        item.setField(field, value);
      }
      item.setCreators(
        creators.map(([lastName, firstName]) => ({
          creatorType: "author",
          lastName,
          firstName,
        })),
      );
      item.addTag(TAG);
      item.setCollections([collection.id]);
      await item.saveTx();
      created.push(title);
    } catch (error) {
      failed.push(`${title}: ${error.message}`);
    }
  }

  async function ensureStandaloneNote(title, body) {
    const existing = childItems().find(
      (item) => item.isNote() && item.getNoteTitle() === title,
    );
    if (existing) {
      skipped.push(`note "${title}"`);
      return;
    }
    try {
      const note = new Zotero.Item("note");
      note.libraryID = libraryID;
      note.setNote(`<h1>${title}</h1><p>${body}</p>`);
      note.addTag(TAG);
      note.setCollections([collection.id]);
      await note.saveTx();
      created.push(`note "${title}"`);
    } catch (error) {
      failed.push(`note "${title}": ${error.message}`);
    }
  }

  // Short names the journeys use are in brackets.
  await ensureRegularItem(
    "journalArticle",
    "The Fall of the Bastille and the Paris Crowd", // [Bastille]
    { date: "1989", publicationTitle: "Past & Present" },
    [["Lefebvre", "Georges"]],
  );
  await ensureRegularItem(
    "journalArticle",
    "Terror and the Committee of Public Safety", // [Terror]
    { date: "2001", publicationTitle: "French Historical Studies" },
    [["Palmer", "R. R."]],
  );
  await ensureRegularItem(
    "book",
    "Napoleon: A Life", // [Napoleon]
    { date: "2014", publisher: "Viking" },
    [["Roberts", "Andrew"]],
  );
  await ensureRegularItem(
    "journalArticle",
    "Lavoisier, Combustion and the Chemical Revolution", // [Lavoisier]
    { date: "1996", publicationTitle: "Isis" },
    [["Holmes", "Frederic L."]],
  );
  await ensureRegularItem(
    "journalArticle",
    "Reading the Principia in Its First Decade", // [Principia]
    { date: "2008", publicationTitle: "Notes and Records" },
    [["Guicciardini", "Niccolò"]],
  );
  await ensureRegularItem(
    "journalArticle",
    "Waterloo: The Hundred Days Reconsidered", // [Waterloo]
    { date: "2015", publicationTitle: "War in History" },
    [["Esdaile", "Charles"]],
  );
  await ensureStandaloneNote(
    "Reading notes on 1789", // [Notes]
    "A standalone note. It can be cited as a source too; the journeys use it to check that a note source shows its title rather than its body.",
  );

  const summary = {
    collection: COLLECTION_NAME,
    tag: TAG,
    created: created.length,
    skipped: skipped.length,
    failed,
    items: childItems().map((item) =>
      item.isNote() ? `note: ${item.getNoteTitle()}` : item.getField("title"),
    ),
  };
  Zotero.debug(`[zoteroTimeline] journey seed: ${JSON.stringify(summary)}`);
  return summary;
})();
