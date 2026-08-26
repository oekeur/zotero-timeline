import { assert } from "chai";
import { addSource } from "../src/modules/timeline/mutations";
import { CURRENT_SCHEMA_VERSION } from "../src/modules/timeline/schema";
import {
  STORAGE_TAG,
  listTimelines,
  updateTimelineDocument,
  whenStorageIdle,
} from "../src/modules/timeline/storage";
import {
  observerForTesting,
  registerSourcePruneObserver,
  unregisterSourcePruneObserver,
} from "../src/modules/timeline/sourcePrune";
import {
  createDocumentNote,
  documentNamed,
  eraseAllPluginItems,
} from "./support-pluginItems";

describe("source prune", function () {
  this.timeout(60000);

  describe("what a delete notification actually carries", function () {
    let libraryID: number;

    before(function () {
      libraryID = Zotero.Libraries.userLibraryID;
    });

    afterEach(async function () {
      await whenStorageIdle();
    });

    // The probe TASK-35 opens with. deletionCleanup.ts claims extraData is
    // keyed by the deleted item's numeric id and carries {libraryID, key} for
    // it; zoteroMindmap's own project memory claims the opposite, that
    // extraData carries numeric ids only. This is a live measurement on the
    // Zotero version this worktree actually runs, settling it before anything
    // is built against either claim.
    it("carries {libraryID, key} keyed by the deleted item's numeric id", async function () {
      const item = new Zotero.Item("note");
      item.libraryID = libraryID;
      item.setNote("<p>probe target</p>");
      await item.saveTx();
      const id = item.id;
      const key = item.key;

      let captured: { [key: string]: any } | null = null;
      const observerID = Zotero.Notifier.registerObserver(
        {
          notify(
            event: _ZoteroTypes.Notifier.Event,
            type: _ZoteroTypes.Notifier.Type,
            ids: string[] | number[],
            extraData: { [key: string]: any },
          ): void {
            if (event === "delete" && type === "item") {
              captured = extraData;
            }
          },
        },
        ["item"],
        "zoterotimeline-probe-extradata",
      );

      try {
        await item.eraseTx();
      } finally {
        Zotero.Notifier.unregisterObserver(observerID);
      }

      assert.isNotNull(captured, "no delete/item notification arrived");
      const entry = (captured as { [key: string]: any })[id];
      assert.isDefined(
        entry,
        `extraData had no entry keyed by the deleted item's numeric id (${id}); ` +
          `saw keys: ${Object.keys(captured as object).join(", ")}`,
      );
      assert.equal(entry.libraryID, libraryID);
      assert.equal(entry.key, key);
    });
  });

  describe("reconciliation on erase", function () {
    let libraryID: number;
    let cited: Zotero.Item;
    let observerID: string;

    before(function () {
      libraryID = Zotero.Libraries.userLibraryID;
    });

    beforeEach(async function () {
      await eraseAllPluginItems(libraryID);
      observerID = registerSourcePruneObserver();
      cited = new Zotero.Item("note");
      cited.libraryID = libraryID;
      cited.setNote("<p>cited note</p>");
      await cited.saveTx();
    });

    afterEach(async function () {
      unregisterSourcePruneObserver(observerID);
      await whenStorageIdle();
      await eraseAllPluginItems(libraryID);
    });

    async function documentWithSource(
      name: string,
      id: string,
      cite: Zotero.Item,
    ) {
      const base = documentNamed(name, id);
      const doc = addSource(base, base.events[0].id, {
        kind: "note",
        libraryID,
        key: cite.key,
        typeId: "supports",
      })!;
      return createDocumentNote(libraryID, STORAGE_TAG, doc);
    }

    async function documentById(documentId: string) {
      const { timelines } = await listTimelines(libraryID);
      return timelines.find((t) => t.doc.id === documentId)?.doc;
    }

    /**
     * Erases `item` and waits for the prune it drives to finish.
     *
     * eraseTx() resolving is not enough: the delete notification arrives
     * asynchronously afterward, not merely unawaited but not yet scheduled
     * when the call returns, so whenStorageIdle() called immediately can see
     * an empty queue the observer has not reached yet. The delay gives the
     * notification and the deferred work up to its own enqueue() a turn
     * before whenStorageIdle() waits out the write itself.
     */
    async function eraseAndWaitForPrune(item: Zotero.Item): Promise<void> {
      await item.eraseTx();
      await Zotero.Promise.delay(200);
      await whenStorageIdle();
    }

    // AC #2
    it("removes the ref from every event in every timeline that cited it, and leaves the rest", async function () {
      await documentWithSource("Timeline A", "tl-a", cited);
      const otherItem = new Zotero.Item("note");
      otherItem.libraryID = libraryID;
      otherItem.setNote("<p>survives</p>");
      await otherItem.saveTx();
      const base = documentNamed("Timeline B", "tl-b");
      const withBoth = addSource(
        addSource(base, base.events[0].id, {
          kind: "note",
          libraryID,
          key: cited.key,
          typeId: "supports",
        })!,
        base.events[0].id,
        { kind: "note", libraryID, key: otherItem.key, typeId: "contradicts" },
      )!;
      await createDocumentNote(libraryID, STORAGE_TAG, withBoth);

      await eraseAndWaitForPrune(cited);

      const docA = await documentById("tl-a");
      assert.lengthOf(docA!.events[0].sources, 0);

      const docB = await documentById("tl-b");
      assert.lengthOf(docB!.events[0].sources, 1);
      assert.equal(docB!.events[0].sources[0].key, otherItem.key);
    });

    // AC #3
    it("prunes nothing on trash, and the ref still resolves", async function () {
      await documentWithSource("Timeline A", "tl-a", cited);

      cited.deleted = true;
      await cited.saveTx();
      await whenStorageIdle();

      const doc = await documentById("tl-a");
      assert.lengthOf(doc!.events[0].sources, 1);
    });

    // AC #4. Written the wrong way this hangs rather than fails: the queue
    // wedges for the session with no error and nothing in the debug log.
    it("returns void, and a write started from inside the observer still lands", async function () {
      await documentWithSource("Timeline A", "tl-a", cited);

      // The registered observer (from beforeEach) fires for real here; the
      // erase both drives the prune's own deferred write and, if that write
      // were mistakenly awaited inside the commit, would wedge the queue for
      // the rest of the session with no error and nothing in the debug log.
      const returned = observerForTesting.notify("delete", "item", [cited.id], {
        [cited.id]: { libraryID, key: cited.key },
      });
      assert.isUndefined(returned, "the observer returned a promise");

      await eraseAndWaitForPrune(cited);

      const laterWrite = await updateTimelineDocument(
        (doc) => ({ ...doc, name: "still writable" }),
        "tl-a",
        libraryID,
      );
      assert.isNotNull(
        laterWrite,
        "a write started after the erase did not land",
      );
      const { timelines } = await listTimelines(libraryID);
      assert.equal(
        timelines.find((t) => t.doc.id === "tl-a")?.doc.name,
        "still writable",
      );
    });

    // AC #5
    it("writes nothing when the erased item was cited by no event", async function () {
      const note = await createDocumentNote(
        libraryID,
        STORAGE_TAG,
        documentNamed("Untouched", "tl-untouched"),
      );
      const before = note.getNote();

      const uncited = new Zotero.Item("note");
      uncited.libraryID = libraryID;
      uncited.setNote("<p>never cited</p>");
      await uncited.saveTx();

      await eraseAndWaitForPrune(uncited);

      await note.reload(["note"], true);
      assert.equal(
        note.getNote(),
        before,
        "an unrelated erase rewrote the note",
      );
    });

    // AC #6. The unreadable document sits alongside a prunable one in the same
    // library, so listTimelines already excludes it from the candidates - the
    // case this guards is the loop over the rest not stopping when one document
    // in the batch cannot be updated.
    it("skips a timeline that will not parse without stopping the prune of the others", async function () {
      await documentWithSource("Timeline A", "tl-a", cited);
      await createDocumentNote(libraryID, STORAGE_TAG, {
        ...documentNamed("Broken", "tl-broken"),
        version: CURRENT_SCHEMA_VERSION + 1,
      });

      await eraseAndWaitForPrune(cited);

      const doc = await documentById("tl-a");
      assert.lengthOf(doc!.events[0].sources, 0);
    });

    // AC #8. A fake libraryID rather than the real user library: the write
    // queue this prune goes through is process-wide, and swapping
    // Zotero.Libraries.get for the library eraseTx itself depends on would risk
    // breaking the erase this test needs to fire the observer at all.
    it("skips a library the user cannot write to, and logs the skip rather than staying silent", async function () {
      const unwritableLibraryID = -999;
      const originalGet = Zotero.Libraries.get;
      Zotero.Libraries.get = ((id: number) =>
        id === unwritableLibraryID
          ? ({ editable: false } as unknown as ReturnType<
              typeof Zotero.Libraries.get
            >)
          : originalGet.call(
              Zotero.Libraries,
              id,
            )) as typeof Zotero.Libraries.get;

      const debugCalls: string[] = [];
      const originalDebug = Zotero.debug;
      Zotero.debug = ((message: unknown) => {
        debugCalls.push(String(message));
      }) as typeof Zotero.debug;

      try {
        const returned = observerForTesting.notify("delete", "item", [999999], {
          999999: { libraryID: unwritableLibraryID, key: "FAKE1234" },
        });
        assert.isUndefined(returned, "the observer returned a promise");
        // The not-writable path returns before ever touching the write queue,
        // so whenStorageIdle cannot be used to wait for it the way the other
        // tests here do.
        await Zotero.Promise.delay(200);
      } finally {
        Zotero.Libraries.get = originalGet;
        Zotero.debug = originalDebug;
      }

      assert.isTrue(
        debugCalls.some((line) => line.includes(String(unwritableLibraryID))),
        "the skip was not logged",
      );
    });
  });
});
