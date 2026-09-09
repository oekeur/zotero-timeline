import { assert } from "chai";
import {
  STORAGE_TAG,
  createTimeline,
  deleteTimeline,
  onStorageWrite,
  renameTimeline,
  updateTimelineDocument,
  whenStorageIdle,
} from "../src/modules/timeline/storage";
import {
  createDocumentNote,
  documentNamed,
  eraseAllPluginItems,
} from "./support-pluginItems";
import { waitFor } from "./waitFor";

describe("storage: the write signal", function () {
  this.timeout(60000);

  let libraryID: number;
  let unsubscribers: Array<() => void>;

  before(function () {
    libraryID = Zotero.Libraries.userLibraryID;
  });

  beforeEach(async function () {
    await eraseAllPluginItems(libraryID);
    unsubscribers = [];
  });

  afterEach(async function () {
    unsubscribers.forEach((off) => off());
    await whenStorageIdle();
    await eraseAllPluginItems(libraryID);
  });

  function listen(): { calls: number[][]; off: () => void } {
    const calls: number[][] = [];
    const off = onStorageWrite((id) => calls.push([id]));
    unsubscribers.push(off);
    return { calls, off };
  }

  it("emits once, carrying the library id, when a timeline is created", async function () {
    const { calls } = listen();

    await createTimeline("A new timeline", libraryID);

    assert.deepEqual(calls, [[libraryID]]);
  });

  it("emits once, carrying the library id, when a timeline is renamed", async function () {
    const { doc } = await createTimeline("Original name", libraryID);
    const { calls } = listen();

    await renameTimeline(doc.id, libraryID, "Renamed");

    assert.deepEqual(calls, [[libraryID]]);
  });

  it("emits once, carrying the library id, when an event edit lands through updateTimelineDocument", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      documentNamed("Edited timeline", "tl-edit"),
    );
    const { calls } = listen();

    await updateTimelineDocument(
      (doc) => ({ ...doc, name: "Edited timeline, changed" }),
      "tl-edit",
      libraryID,
    );

    assert.deepEqual(calls, [[libraryID]]);
  });

  it("emits nothing when updateTimelineDocument's mutate returns null", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      documentNamed("Untouched", "tl-noop"),
    );
    const { calls } = listen();

    const result = await updateTimelineDocument(
      () => null,
      "tl-noop",
      libraryID,
    );

    assert.isNull(result);
    assert.deepEqual(calls, []);
  });

  it("stops notifying once the returned unsubscribe function is called", async function () {
    const { calls, off } = listen();

    await createTimeline("First", libraryID);
    assert.deepEqual(calls, [[libraryID]]);

    off();
    await createTimeline("Second", libraryID);
    assert.deepEqual(
      calls,
      [[libraryID]],
      "the unsubscribed listener fired again",
    );
  });

  it("logs and continues past a listener that throws, without blocking the others", async function () {
    const order: string[] = [];
    unsubscribers.push(
      onStorageWrite(() => {
        order.push("first");
        throw new Error("listener boom");
      }),
    );
    unsubscribers.push(onStorageWrite(() => order.push("second")));

    await createTimeline("Faulty listeners", libraryID);

    assert.deepEqual(order, ["first", "second"]);
  });

  it("is a no-op when no listener is registered", async function () {
    // Nothing subscribed at all; the write still has to resolve normally.
    await createTimeline("No listeners", libraryID);
  });

  it("emits once, carrying the library id, when a timeline is deleted", async function () {
    const { doc } = await createTimeline("To delete", libraryID);
    const { calls } = listen();

    await deleteTimeline(doc.id, libraryID);

    assert.deepEqual(calls, [[libraryID]]);
  });

  it("does not re-invoke a listener that unsubscribes and resubscribes itself inside its own handler", async function () {
    let calls = 0;
    let off: () => void = () => undefined;
    const handler = () => {
      calls += 1;
      off();
      off = onStorageWrite(handler);
      unsubscribers.push(off);
    };
    off = onStorageWrite(handler);
    unsubscribers.push(off);

    await createTimeline("Resubscribing listener", libraryID);

    assert.equal(calls, 1, "the resubscribed listener ran more than once");
  });

  it("logs an async listener's rejection through logFailure, without blocking the others", async function () {
    // Gecko's Error#stack, unlike V8's, carries only frames and never the
    // message text, so a marker embedded in the rejected error's message is
    // not recoverable from the composed log line. Assert on the fixed prefix
    // logFailure is called with instead, isolated to this test by stubbing
    // Zotero.logError only for its duration.
    const order: string[] = [];
    const loggedErrors: Error[] = [];
    const originalLogError = Zotero.logError;
    Zotero.logError = (err: Error) => {
      loggedErrors.push(err);
    };

    try {
      unsubscribers.push(
        onStorageWrite(async () => {
          order.push("first");
          throw new Error("listener boom (async)");
        }),
      );
      unsubscribers.push(onStorageWrite(() => order.push("second")));

      await createTimeline("Async faulty listener", libraryID);

      assert.deepEqual(order, ["first", "second"]);

      await waitFor(
        () => (loggedErrors.length > 0 ? true : null),
        "logFailure to be called for the rejected listener",
      );
      assert.lengthOf(loggedErrors, 1);
      assert.include(
        loggedErrors[0].message,
        "[zoteroTimeline] a storage write listener threw",
      );
    } finally {
      Zotero.logError = originalLogError;
    }
  });
});
