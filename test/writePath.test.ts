import { assert } from "chai";
import { CURRENT_SCHEMA_VERSION } from "../src/modules/timeline/schema";
import {
  STORAGE_TAG,
  StorageError,
  listTimelines,
  updateTimelineDocument,
  whenStorageIdle,
} from "../src/modules/timeline/storage";
import {
  createDocumentNote,
  documentNamed,
  eraseAllPluginItems,
} from "./support-pluginItems";

/** Collects the item ids Zotero reports as modified while `run` executes. */
async function collectModifiedIds(run: () => Promise<void>): Promise<number[]> {
  const seen: number[] = [];
  const observerID = Zotero.Notifier.registerObserver(
    {
      notify(
        event: _ZoteroTypes.Notifier.Event,
        type: _ZoteroTypes.Notifier.Type,
        ids: string[] | number[],
      ): void {
        if (event === "modify" && type === "item") {
          seen.push(...ids.map(Number));
        }
      },
    },
    ["item"],
    "zoterotimeline-write-path-spec",
  );
  try {
    await run();
    await whenStorageIdle();
  } finally {
    Zotero.Notifier.unregisterObserver(observerID);
  }
  return seen;
}

describe("storage: the write path", function () {
  this.timeout(60000);

  let libraryID: number;
  let noteA: Zotero.Item;
  let noteB: Zotero.Item;

  before(function () {
    libraryID = Zotero.Libraries.userLibraryID;
  });

  beforeEach(async function () {
    await eraseAllPluginItems(libraryID);
    noteA = await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      documentNamed("Timeline A", "tl-a"),
    );
    noteB = await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      documentNamed("Timeline B", "tl-b"),
    );
  });

  afterEach(async function () {
    await whenStorageIdle();
    await eraseAllPluginItems(libraryID);
  });

  async function documentById(id: string) {
    const { timelines } = await listTimelines(libraryID);
    return timelines.find((t) => t.doc.id === id)?.doc;
  }

  // AC #1. Asserted on the SET of modified ids, not a count: Zotero fires
  // modify twice per save, once inside the transaction and again after commit.
  it("writes one note per edit and leaves the other alone", async function () {
    const modified = await collectModifiedIds(async () => {
      await updateTimelineDocument(
        (doc) => ({ ...doc, name: "Timeline A, edited" }),
        "tl-a",
        libraryID,
      );
    });

    assert.include(modified, noteA.id);
    assert.notInclude(
      modified,
      noteB.id,
      "editing one timeline dirtied the other",
    );
    assert.equal((await documentById("tl-a"))?.name, "Timeline A, edited");
    assert.equal((await documentById("tl-b"))?.name, "Timeline B");
  });

  // AC #2. A bare read/write pair loses the first change here; the queue keeps
  // both, because each mutation reads the document as it stands at write time.
  it("reads the document as it stands at write time, not as a caller saw it", async function () {
    const first = updateTimelineDocument(
      (doc) => ({ ...doc, name: `${doc.name} + first` }),
      "tl-a",
      libraryID,
    );
    const second = updateTimelineDocument(
      (doc) => ({ ...doc, name: `${doc.name} + second` }),
      "tl-a",
      libraryID,
    );
    await Promise.all([first, second]);

    assert.equal(
      (await documentById("tl-a"))?.name,
      "Timeline A + first + second",
      "one of the two concurrent edits was built on a stale read",
    );
  });

  // AC #3
  it("does not interleave concurrent writes to different timelines", async function () {
    await Promise.all([
      updateTimelineDocument(
        (doc) => ({ ...doc, name: "A only" }),
        "tl-a",
        libraryID,
      ),
      updateTimelineDocument(
        (doc) => ({ ...doc, name: "B only" }),
        "tl-b",
        libraryID,
      ),
    ]);

    assert.equal((await documentById("tl-a"))?.name, "A only");
    assert.equal((await documentById("tl-b"))?.name, "B only");
  });

  // AC #4. Written the wrong way this hangs rather than fails, which is
  // exactly the production symptom: the queue wedges for the session with no
  // error thrown and nothing in the debug log.
  it("keeps the queue draining when a write is started from an observer", async function () {
    let started: Promise<unknown> | null = null;
    const observerID = Zotero.Notifier.registerObserver(
      {
        notify(
          event: _ZoteroTypes.Notifier.Event,
          type: _ZoteroTypes.Notifier.Type,
        ): void {
          if (event !== "modify" || type !== "item" || started !== null) {
            return;
          }
          // The shape every observer in this plugin has to use: start the
          // work, return nothing, never await it here.
          started = updateTimelineDocument(
            (doc) => ({ ...doc, name: "written from a notifier" }),
            "tl-b",
            libraryID,
          );
        },
      },
      ["item"],
      "zoterotimeline-observer-write-spec",
    );

    try {
      await updateTimelineDocument(
        (doc) => ({ ...doc, name: "A, edited" }),
        "tl-a",
        libraryID,
      );
      await whenStorageIdle();
      if (started !== null) {
        await started;
      }
    } finally {
      Zotero.Notifier.unregisterObserver(observerID);
    }

    assert.isNotNull(started, "the observer never ran");
    assert.equal((await documentById("tl-b"))?.name, "written from a notifier");
  });

  it("writes nothing when the mutation returns null", async function () {
    const modified = await collectModifiedIds(async () => {
      const result = await updateTimelineDocument(
        () => null,
        "tl-a",
        libraryID,
      );
      assert.isNull(result);
    });

    assert.notInclude(
      modified,
      noteA.id,
      "a no-op edit dirtied the note anyway",
    );
  });

  it("refuses to write a document the mutation made invalid", async function () {
    let threw: unknown;
    try {
      await updateTimelineDocument(
        (doc) => ({ ...doc, name: "" }),
        "tl-a",
        libraryID,
      );
    } catch (err) {
      threw = err;
    }

    assert.instanceOf(threw, StorageError);
    assert.equal((await documentById("tl-a"))?.name, "Timeline A");
  });

  it("never mutates a document it could not fully read", async function () {
    await eraseAllPluginItems(libraryID);
    const future = await createDocumentNote(libraryID, STORAGE_TAG, {
      ...documentNamed("From the future", "tl-future"),
      version: CURRENT_SCHEMA_VERSION + 1,
    });
    const before = future.getNote();

    let mutateRan = false;
    let threw: unknown;
    try {
      await updateTimelineDocument(
        (doc) => {
          mutateRan = true;
          return doc;
        },
        "tl-future",
        libraryID,
      );
    } catch (err) {
      threw = err;
    }

    assert.isFalse(mutateRan, "mutate ran on a document from a newer plugin");
    assert.instanceOf(threw, StorageError);
    await future.reload(["note"], true);
    assert.equal(
      future.getNote(),
      before,
      "the refused document was rewritten",
    );
  });

  it("reports an unknown document id rather than writing somewhere else", async function () {
    let threw: unknown;
    try {
      await updateTimelineDocument((doc) => doc, "tl-missing", libraryID);
    } catch (err) {
      threw = err;
    }

    assert.instanceOf(threw, StorageError);
    assert.equal((threw as StorageError).reason, "not-found");
  });
});
