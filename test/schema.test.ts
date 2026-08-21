import { assert } from "chai";
import {
  CURRENT_SCHEMA_VERSION,
  serializeDocument,
  type TimelineDocument,
} from "../src/modules/timeline/schema";
import {
  parseTimelineDocument,
  parseVocabulary,
} from "../src/modules/timeline/validate";

function validDocument(): TimelineDocument {
  return {
    version: CURRENT_SCHEMA_VERSION,
    id: "tl-1",
    name: "Abolition in the Dutch Caribbean",
    events: [
      {
        id: "e-1",
        title: "Emancipation",
        date: "1863-07-01",
        sources: [
          {
            kind: "item",
            libraryID: 1,
            key: "ABCD2345",
            typeId: "primary-source-for",
          },
        ],
        tags: ["legal"],
      },
    ],
  };
}

describe("schema and validation", function () {
  it("accepts a valid document and reports no date issues", function () {
    const result = parseTimelineDocument(validDocument());

    assert.isTrue(result.ok);
    if (!result.ok) return;
    assert.equal(result.doc.name, "Abolition in the Dutch Caribbean");
    assert.lengthOf(result.doc.events, 1);
    assert.isEmpty(result.dateIssues);
  });

  it("round-trips a document through parse and serialise byte-identically", function () {
    const original = validDocument();
    const result = parseTimelineDocument(JSON.parse(JSON.stringify(original)));

    assert.isTrue(result.ok);
    if (!result.ok) return;
    assert.equal(serializeDocument(result.doc), serializeDocument(original));
  });

  // The optional-key discipline the cache's echo suppression rests on: an
  // absent key must stay absent rather than becoming an explicit undefined.
  it("leaves an absent optional key absent rather than undefined", function () {
    const result = parseTimelineDocument(validDocument());

    assert.isTrue(result.ok);
    if (!result.ok) return;
    assert.notProperty(result.doc.events[0], "description");
    assert.notProperty(result.doc.events[0], "endDate");
    assert.notProperty(result.doc.events[0].sources[0], "name");
  });

  it("keeps an optional key that is present", function () {
    const doc = validDocument();
    doc.events[0].description = "The law took effect.";
    doc.events[0].endDate = "1873";
    doc.events[0].sources[0].name = "the proclamation itself";

    const result = parseTimelineDocument(doc);

    assert.isTrue(result.ok);
    if (!result.ok) return;
    assert.equal(result.doc.events[0].description, "The law took effect.");
    assert.equal(result.doc.events[0].endDate, "1873");
    assert.equal(
      result.doc.events[0].sources[0].name,
      "the proclamation itself",
    );
  });

  // AC #2
  it("names the field that failed", function () {
    const missingName = validDocument() as Record<string, unknown>;
    delete missingName.name;
    const nameResult = parseTimelineDocument(missingName);
    assert.isFalse(nameResult.ok);
    if (nameResult.ok) return;
    assert.include(nameResult.error, "name");

    const badEvents = validDocument() as unknown as Record<string, unknown>;
    badEvents.events = {};
    const eventsResult = parseTimelineDocument(badEvents);
    assert.isFalse(eventsResult.ok);
    if (eventsResult.ok) return;
    assert.include(eventsResult.error, "events");

    const doc = validDocument() as unknown as Record<string, unknown>;
    (doc.events as Record<string, unknown>[])[0].sources = [
      { kind: "item", libraryID: 1, typeId: "cites" },
    ];
    const sourcesResult = parseTimelineDocument(doc);
    assert.isFalse(sourcesResult.ok);
    if (sourcesResult.ok) return;
    assert.include(sourcesResult.error, "events");
  });

  it("rejects an empty name, which the timeline list cannot render", function () {
    const doc = validDocument();
    doc.name = "   ";

    const result = parseTimelineDocument(doc);

    assert.isFalse(result.ok);
    if (result.ok) return;
    assert.include(result.error, "empty");
  });

  // AC #4, and the check the version refusal is built on: version before shape.
  it("checks the version before any shape check", function () {
    const fromTheFuture = {
      version: CURRENT_SCHEMA_VERSION + 1,
      // Every shape below is wrong as well. The version is what gets reported.
      id: 42,
      events: "not an array",
    };

    const result = parseTimelineDocument(fromTheFuture);

    assert.isFalse(result.ok);
    if (result.ok) return;
    assert.include(result.error, "unsupported version");
    assert.include(result.error, String(CURRENT_SCHEMA_VERSION + 1));
    assert.include(result.error, String(CURRENT_SCHEMA_VERSION));
    assert.equal(result.documentVersion, CURRENT_SCHEMA_VERSION + 1);
  });

  // AC #5
  it("marks the event whose date will not parse and keeps the document", function () {
    const doc = validDocument();
    doc.events = [
      { ...doc.events[0], id: "e-1", date: "1863-07-01" },
      { ...doc.events[0], id: "e-2", date: "notadate" },
      { ...doc.events[0], id: "e-3", date: "1873" },
    ];

    const result = parseTimelineDocument(doc);

    assert.isTrue(result.ok, "one bad date sank the whole document");
    if (!result.ok) return;
    assert.lengthOf(result.doc.events, 3);
    assert.lengthOf(result.dateIssues, 1);
    assert.equal(result.dateIssues[0].eventId, "e-2");
    assert.equal(result.dateIssues[0].field, "date");
  });

  it("keeps an unreadable date verbatim rather than rewriting it", function () {
    const doc = validDocument();
    doc.events[0].date = "notadate";

    const result = parseTimelineDocument(doc);

    assert.isTrue(result.ok);
    if (!result.ok) return;
    assert.equal(result.doc.events[0].date, "notadate");
  });

  it("reports an unreadable endDate against its own field", function () {
    const doc = validDocument();
    doc.events[0].endDate = "notadate";

    const result = parseTimelineDocument(doc);

    assert.isTrue(result.ok);
    if (!result.ok) return;
    assert.lengthOf(result.dateIssues, 1);
    assert.equal(result.dateIssues[0].field, "endDate");
  });

  it("accepts EDTF beyond a plain date", function () {
    const doc = validDocument();
    doc.events = [
      { ...doc.events[0], id: "e-1", date: "1863?" },
      { ...doc.events[0], id: "e-2", date: "1580~" },
      { ...doc.events[0], id: "e-3", date: "1863-07" },
    ];

    const result = parseTimelineDocument(doc);

    assert.isTrue(result.ok);
    if (!result.ok) return;
    assert.isEmpty(result.dateIssues);
  });

  describe("the vocabulary note", function () {
    it("accepts a valid vocabulary", function () {
      const result = parseVocabulary({
        version: CURRENT_SCHEMA_VERSION,
        types: [{ id: "cites", label: "Cites" }],
      });

      assert.isTrue(result.ok);
      if (!result.ok) return;
      assert.lengthOf(result.doc.types, 1);
      assert.equal(result.doc.types[0].id, "cites");
    });

    // AC #4 of the version-refusal task, from the same constant.
    it("refuses a vocabulary from a newer plugin", function () {
      const result = parseVocabulary({
        version: CURRENT_SCHEMA_VERSION + 1,
        types: [],
      });

      assert.isFalse(result.ok);
      if (result.ok) return;
      assert.include(result.error, "unsupported version");
    });

    it("rejects a link type missing its label", function () {
      const result = parseVocabulary({
        version: CURRENT_SCHEMA_VERSION,
        types: [{ id: "cites" }],
      });

      assert.isFalse(result.ok);
      if (result.ok) return;
      assert.include(result.error, "types");
    });
  });
});
