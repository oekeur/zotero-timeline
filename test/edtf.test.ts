import { assert } from "chai";
import { toTimelineRange } from "../src/utils/edtfRange";

// The four uncertainty forms the product charter commits to. These run inside
// Zotero's privileged scope, which is the point: edtf pulls nearley at runtime
// and the charter's rendering path depends on both surviving there.
describe("edtf", function () {
  function iso(date: Date | undefined) {
    return date === undefined ? undefined : date.toISOString();
  }

  it("parses an uncertain year and spans it", function () {
    const range = toTimelineRange("1621?");
    assert.isTrue(range.uncertain);
    assert.isFalse(range.approximate);
    assert.equal(iso(range.start), "1621-01-01T00:00:00.000Z");
    assert.equal(iso(range.end), "1621-12-31T23:59:59.999Z");
  });

  it("parses an approximate year and spans it", function () {
    const range = toTimelineRange("1580~");
    assert.isTrue(range.approximate);
    assert.isFalse(range.uncertain);
    assert.equal(iso(range.start), "1580-01-01T00:00:00.000Z");
    assert.equal(iso(range.end), "1580-12-31T23:59:59.999Z");
  });

  it("spans a one-of set across every member, not just the first", function () {
    // Regression guard. edtf's own min/max on a Set describe only its first
    // member, so a naive mapping ends this range in 1580 and the event is
    // drawn eleven years too short.
    const range = toTimelineRange("[1580..1590]");
    assert.equal(iso(range.start), "1580-01-01T00:00:00.000Z");
    assert.equal(iso(range.end), "1590-12-31T23:59:59.999Z");
  });

  it("parses a month interval across both endpoints", function () {
    const range = toTimelineRange("1943-05/1943-06");
    assert.equal(iso(range.start), "1943-05-01T00:00:00.000Z");
    assert.equal(iso(range.end), "1943-06-30T23:59:59.999Z");
  });

  it("marks a plain year as neither uncertain nor approximate", function () {
    const range = toTimelineRange("1621");
    assert.isFalse(range.uncertain);
    assert.isFalse(range.approximate);
  });

  it("rejects a string EDTF does not accept", function () {
    assert.throws(() => toTimelineRange("not a date"));
  });
});
