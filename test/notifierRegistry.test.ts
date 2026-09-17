import { assert } from "chai";
import {
  CURRENT_SCHEMA_VERSION,
  type TimelineDocument,
} from "../src/modules/timeline/schema";
import { eraseAllPluginItems } from "./support-pluginItems";
import { waitFor } from "./waitFor";

/**
 * A leaked Zotero.Notifier observer and a stalled storage queue both surface
 * as "a write from the timeline tab's UI never lands", so the two need a
 * signal that tells them apart. api.liveNotifierObserversForTests() counts
 * only observers registered through notifierRegistry.ts; two of this suite's
 * own specs (pruneSourceRefs.test.ts, writePath.test.ts) register their own
 * Zotero.Notifier observers directly, outside the wrapper, so they never
 * move this count.
 */
describe("notifier registry: an observable leak signal", function () {
  this.timeout(60000);

  let libraryID: number;

  const api = () => (Zotero as any).ZoteroTimeline.api;

  before(function () {
    libraryID = Zotero.Libraries.userLibraryID;
  });

  beforeEach(async function () {
    api().closeTimelineTab();
    await eraseAllPluginItems(libraryID);
  });

  afterEach(async function () {
    api().closeTimelineTab();
    await api().storageQueueIdleForTests(15000);
    await eraseAllPluginItems(libraryID);
  });

  it("counts exactly the three startup observers with no tab open", function () {
    assert.equal(
      api().liveNotifierObserversForTests(),
      3,
      "expected the container guard, document cache and source prune observers, and nothing else",
    );
  });

  it("rises to four while the timeline tab is open, and drops back to three once it closes", async function () {
    assert.equal(api().liveNotifierObserversForTests(), 3);

    await api().openTimelineTab();
    await waitFor(() => api().getCurrentTimeline(), "the canvas to render");
    assert.equal(
      api().liveNotifierObserversForTests(),
      4,
      "opening the tab did not register its canvas-refresh observer through the wrapper",
    );

    api().closeTimelineTab();
    await waitFor(
      () => (api().liveNotifierObserversForTests() === 3 ? true : null),
      "the tab's observer to release when the tab closes",
    );
  });

  it("resolves true when the storage queue is idle", async function () {
    const idle = await api().storageQueueIdleForTests(2000);
    assert.isTrue(idle);
  });

  it("does not register an observer for a tab closed while it was still opening", async function () {
    const errorsBefore = new Set(Zotero.getErrors(true) as string[]);

    const open = api().openTimelineTab();
    api().closeTimelineTab();
    await open;
    await api().storageQueueIdleForTests(5000);
    await Zotero.Promise.delay(300);

    const newErrors = (Zotero.getErrors(true) as string[]).filter(
      (e) => !errorsBefore.has(e),
    );
    assert.isFalse(
      newErrors.some((e) => e.includes("[zoteroTimeline]")),
      `unexpected plugin error logged: ${newErrors.join(" | ")}`,
    );
    assert.equal(
      api().liveNotifierObserversForTests(),
      3,
      "a tab closed mid-open left its canvas-refresh observer registered",
    );

    await api().openTimelineTab();
    await waitFor(() => api().getCurrentTimeline(), "the canvas to render");
    assert.equal(api().liveNotifierObserversForTests(), 4);

    api().closeTimelineTab();
    await waitFor(
      () => (api().liveNotifierObserversForTests() === 3 ? true : null),
      "the tab's observer to release when the tab closes",
    );
  });

  it("resolves false while a write is in flight, then true once it settles", async function () {
    const doc: TimelineDocument = {
      version: CURRENT_SCHEMA_VERSION,
      id: "doc-queue-probe",
      name: "Queue probe",
      events: [],
    };

    const write = api().createDocumentNoteForTests(libraryID, doc);

    const busy = await api().storageQueueIdleForTests(1);
    assert.isFalse(
      busy,
      "the probe reported the queue idle while a write was still in flight",
    );

    await write;

    const idleAfter = await api().storageQueueIdleForTests(2000);
    assert.isTrue(
      idleAfter,
      "the probe never reported idle after the write settled",
    );
  });
});
