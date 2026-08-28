// No Zotero.* call and no window access anywhere in this file - these
// mutations are pure, and this spec is what proves it, even though it still
// runs inside this project's Zotero-hosted Mocha suite (there is no separate
// non-Zotero runner here). Every source below is built from plain data - kind,
// libraryID, key, typeId, name - never a Zotero.Item, because addSource and
// updateSource never ask for one.
import { assert } from "chai";
import {
  CURRENT_SCHEMA_VERSION,
  serializeDocument,
  type TimelineDocument,
} from "../src/modules/timeline/schema";
import {
  addEvent,
  addSource,
  mintEventId,
  removeEvent,
  removeSource,
  updateEvent,
  updateSource,
} from "../src/modules/timeline/mutations";

function fixtureDocument(): TimelineDocument {
  return {
    version: CURRENT_SCHEMA_VERSION,
    id: "tl-1",
    name: "Abolition in the Dutch Caribbean",
    events: [
      {
        id: "e-1",
        title: "Emancipation",
        date: "1863-07-01",
        sources: [],
        tags: ["legal"],
      },
      {
        id: "e-2",
        title: "Compensation paid to enslavers",
        date: "1863",
        sources: [],
        tags: [],
      },
    ],
  };
}

describe("mutations", function () {
  describe("mintEventId / addEvent", function () {
    it("mints an id that does not collide with one already in the document", function () {
      // The fixture's first event carries whatever id the first draw from
      // Math.random would produce, so mintEventId is forced to retry.
      const collidingDraw = 0.123456789;
      const colliding = `ev-${collidingDraw.toString(36).slice(2, 10)}`;
      const doc: TimelineDocument = {
        ...fixtureDocument(),
        events: [
          { ...fixtureDocument().events[0], id: colliding },
          fixtureDocument().events[1],
        ],
      };

      const original = Math.random;
      let calls = 0;
      Math.random = () => {
        calls += 1;
        return calls === 1 ? collidingDraw : 0.987654321;
      };
      try {
        const id = mintEventId(doc);
        assert.equal(calls, 2, "did not retry past the collision");
        assert.notEqual(id, colliding);
        assert.isFalse(doc.events.some((event) => event.id === id));
      } finally {
        Math.random = original;
      }
    });

    it("adds the new event under its minted id, sources empty, other events untouched", function () {
      const doc = fixtureDocument();
      const before = serializeDocument(doc);

      const result = addEvent(doc, {
        title: "Slavery Remembrance Day instituted",
        date: "1954",
        tags: ["commemoration"],
      });

      assert.lengthOf(result.events, 3);
      const added = result.events[2];
      assert.equal(added.title, "Slavery Remembrance Day instituted");
      assert.equal(added.date, "1954");
      assert.deepEqual(added.sources, []);
      assert.deepEqual(added.tags, ["commemoration"]);
      assert.isString(added.id);
      assert.notInclude(["e-1", "e-2"], added.id);

      // The input document is untouched: addEvent is pure.
      assert.equal(serializeDocument(doc), before);
      assert.deepEqual(result.events.slice(0, 2), doc.events);
    });

    it("omits an unset optional field rather than writing it as undefined", function () {
      const result = addEvent(fixtureDocument(), {
        title: "No description or endDate",
        date: "1900",
      });
      const added = result.events[2];
      assert.notProperty(added, "description");
      assert.notProperty(added, "endDate");
      assert.notProperty(added, "track");
      assert.deepEqual(added.tags, []);
    });

    // TASK-15
    it("writes track when the input names one", function () {
      const result = addEvent(fixtureDocument(), {
        title: "Compensation paid to enslavers",
        date: "1863",
        track: "economic",
      });
      assert.equal(result.events[2].track, "economic");
    });
  });

  describe("updateEvent", function () {
    it("changes only the named event's named fields; every other event is byte-identical", function () {
      const doc = fixtureDocument();

      const result = updateEvent(doc, "e-1", {
        title: "Emancipation Day",
        tags: ["legal", "holiday"],
      });

      assert.isNotNull(result);
      if (result === null) return;
      const updated = result.events.find((event) => event.id === "e-1");
      assert.isDefined(updated);
      assert.equal(updated!.title, "Emancipation Day");
      assert.deepEqual(updated!.tags, ["legal", "holiday"]);
      // Untouched field on the same event.
      assert.equal(updated!.date, "1863-07-01");

      // The other event is byte-identical under serializeDocument.
      const untouched = result.events.find((event) => event.id === "e-2");
      assert.equal(
        serializeDocument({ ...doc, events: [untouched!] }),
        serializeDocument({ ...doc, events: [doc.events[1]] }),
      );
    });

    it("clears an optional field when it is present with value undefined", function () {
      const doc = fixtureDocument();
      doc.events[0].description = "Set at first.";

      const result = updateEvent(doc, "e-1", { description: undefined });

      assert.isNotNull(result);
      if (result === null) return;
      const updated = result.events.find((event) => event.id === "e-1");
      assert.notProperty(updated, "description");
    });

    it("returns null for an event id the document does not have", function () {
      const result = updateEvent(fixtureDocument(), "no-such-event", {
        title: "Should not apply",
      });
      assert.isNull(result);
    });

    it("returns null when the change is a no-op, so the write path can skip it", function () {
      const doc = fixtureDocument();
      const result = updateEvent(doc, "e-1", { title: doc.events[0].title });
      assert.isNull(result);
    });

    // TASK-15
    it("sets and clears track the same way as every other optional field", function () {
      const doc = fixtureDocument();

      const tracked = updateEvent(doc, "e-1", { track: "legal" });
      assert.isNotNull(tracked);
      assert.equal(tracked!.events.find((e) => e.id === "e-1")!.track, "legal");

      const cleared = updateEvent(tracked!, "e-1", { track: undefined });
      assert.isNotNull(cleared);
      assert.notProperty(
        cleared!.events.find((e) => e.id === "e-1"),
        "track",
      );
    });
  });

  describe("removeEvent", function () {
    it("drops that event and nothing else", function () {
      const doc = fixtureDocument();

      const result = removeEvent(doc, "e-1");

      assert.isNotNull(result);
      if (result === null) return;
      assert.lengthOf(result.events, 1);
      assert.equal(result.events[0].id, "e-2");
      assert.deepEqual(result.events[0], doc.events[1]);
    });

    it("returns null for an event id the document does not have", function () {
      const result = removeEvent(fixtureDocument(), "no-such-event");
      assert.isNull(result);
    });
  });

  describe("addSource", function () {
    it("appends a SourceRef and returns a new document, leaving the input untouched", function () {
      const doc = fixtureDocument();
      const before = serializeDocument(doc);

      const result = addSource(doc, "e-1", {
        kind: "item",
        libraryID: 1,
        key: "ABCD1234",
        typeId: "supports",
        name: "Primary account",
      });

      assert.isNotNull(result);
      if (result === null) return;
      const event = result.events.find((e) => e.id === "e-1");
      assert.deepEqual(event!.sources, [
        {
          kind: "item",
          libraryID: 1,
          key: "ABCD1234",
          typeId: "supports",
          name: "Primary account",
        },
      ]);

      // The input document is untouched: addSource is pure.
      assert.equal(serializeDocument(doc), before);
      assert.deepEqual(
        result.events.find((e) => e.id === "e-2"),
        doc.events[1],
      );
    });

    it("returns null for an event id the document does not have", function () {
      const result = addSource(fixtureDocument(), "no-such-event", {
        kind: "item",
        libraryID: 1,
        key: "ABCD1234",
        typeId: "supports",
      });
      assert.isNull(result);
    });

    it("refuses an exact duplicate, but accepts one differing in typeId or in name", function () {
      const doc = fixtureDocument();
      const ref = {
        kind: "item" as const,
        libraryID: 1,
        key: "ABCD1234",
        typeId: "supports",
        name: "Primary account",
      };
      const withFirst = addSource(doc, "e-1", ref);
      assert.isNotNull(withFirst);
      if (withFirst === null) return;

      // Same kind, key, typeId and name: refused.
      assert.isNull(addSource(withFirst, "e-1", { ...ref }));

      // Differs in typeId only: accepted.
      const differentType = addSource(withFirst, "e-1", {
        ...ref,
        typeId: "contradicts",
      });
      assert.isNotNull(differentType);

      // Differs in name only: accepted.
      const differentName = addSource(withFirst, "e-1", {
        ...ref,
        name: "Secondary account",
      });
      assert.isNotNull(differentName);
    });
  });

  describe("updateSource", function () {
    function fixtureWithSource(): TimelineDocument {
      const withSource = addSource(fixtureDocument(), "e-1", {
        kind: "item",
        libraryID: 1,
        key: "ABCD1234",
        typeId: "supports",
        name: "Primary account",
      });
      if (withSource === null) throw new Error("fixture setup failed");
      return withSource;
    }

    it("changes typeId and name on the addressed source only", function () {
      const doc = fixtureWithSource();

      const result = updateSource(doc, "e-1", 0, {
        typeId: "contradicts",
        name: "Revised account",
      });

      assert.isNotNull(result);
      if (result === null) return;
      const source = result.events.find((e) => e.id === "e-1")!.sources[0];
      assert.equal(source.typeId, "contradicts");
      assert.equal(source.name, "Revised account");
      assert.equal(source.kind, "item");
      assert.equal(source.key, "ABCD1234");
    });

    it("returns null when nothing changed", function () {
      const doc = fixtureWithSource();
      const result = updateSource(doc, "e-1", 0, {
        typeId: "supports",
        name: "Primary account",
      });
      assert.isNull(result);
    });

    it("returns null for an event id the document does not have", function () {
      const result = updateSource(fixtureWithSource(), "no-such-event", 0, {
        typeId: "contradicts",
      });
      assert.isNull(result);
    });

    it("returns null for an index the event does not have", function () {
      const result = updateSource(fixtureWithSource(), "e-1", 1, {
        typeId: "contradicts",
      });
      assert.isNull(result);
    });

    it("omits a cleared name rather than setting it to undefined", function () {
      const doc = fixtureWithSource();

      const result = updateSource(doc, "e-1", 0, { name: undefined });

      assert.isNotNull(result);
      if (result === null) return;
      const changedEvent = result.events.find((e) => e.id === "e-1")!;
      // Literal that never mentions "name" at all - a key the parser would
      // treat differently from one present with value undefined.
      assert.equal(
        serializeDocument({ ...result, events: [changedEvent] }),
        serializeDocument({
          ...result,
          events: [
            {
              ...changedEvent,
              sources: [
                {
                  kind: "item",
                  libraryID: 1,
                  key: "ABCD1234",
                  typeId: "supports",
                },
              ],
            },
          ],
        }),
      );
      assert.notProperty(changedEvent.sources[0], "name");
    });
  });

  describe("removeSource", function () {
    function fixtureWithSource(): TimelineDocument {
      const withSource = addSource(fixtureDocument(), "e-1", {
        kind: "item",
        libraryID: 1,
        key: "ABCD1234",
        typeId: "supports",
      });
      if (withSource === null) throw new Error("fixture setup failed");
      return withSource;
    }

    it("drops the addressed source and nothing else", function () {
      const doc = fixtureWithSource();

      const result = removeSource(doc, "e-1", 0);

      assert.isNotNull(result);
      if (result === null) return;
      assert.deepEqual(result.events.find((e) => e.id === "e-1")!.sources, []);
      assert.deepEqual(
        result.events.find((e) => e.id === "e-2"),
        doc.events[1],
      );
    });

    it("returns null when the index names none", function () {
      const doc = fixtureWithSource();
      assert.isNull(removeSource(doc, "e-1", 1));
      assert.isNull(removeSource(doc, "e-1", -1));
    });

    it("returns null for an event id the document does not have", function () {
      const result = removeSource(fixtureWithSource(), "no-such-event", 0);
      assert.isNull(result);
    });
  });
});
