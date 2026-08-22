import { assert } from "chai";
import { shiftEdtfDate, toTimelineRange } from "../src/utils/edtfRange";

const DAY = 24 * 60 * 60 * 1000;
// Five Gregorian years from 1621-01-01, leap days included - the plan's own
// worked example shifts by exactly this.
const FIVE_YEARS = 1826 * DAY;

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

  describe("shiftEdtfDate", function () {
    it("shifts a day-precision date and keeps day precision", function () {
      assert.equal(
        shiftEdtfDate("1579-01-23", { start: 10 * DAY }),
        "1579-02-02",
      );
    });

    it("shifts a year-only date and keeps year-only precision", function () {
      // The plan's own worked example: five years right, no month or day appears.
      assert.equal(shiftEdtfDate("1621?", { start: FIVE_YEARS }), "1626?");
    });

    it("preserves an uncertain qualifier", function () {
      const result = shiftEdtfDate("1621?", { start: FIVE_YEARS });
      assert.match(result, /\?$/);
      assert.isTrue(toTimelineRange(result).uncertain);
    });

    it("preserves an approximate qualifier", function () {
      const result = shiftEdtfDate("1580~", { start: FIVE_YEARS });
      assert.match(result, /~$/);
      assert.isTrue(toTimelineRange(result).approximate);
    });

    it("shifts every member of a one-of set by the same delta", function () {
      assert.equal(
        shiftEdtfDate("[1667,1668,1670]", { start: DAY }),
        "[1667,1668,1670]", // a one-day shift never crosses a year boundary
      );
      assert.equal(
        shiftEdtfDate("[1667,1668,1670]", { start: 365 * DAY }),
        "[1668,1668,1671]", // 1668 is a leap year, so +365d from its Jan 1 stays in 1668
      );
    });

    it("shifts a consecutive sub-range within a one-of set at both ends", function () {
      assert.equal(
        shiftEdtfDate("[1580..1590]", { start: 365 * DAY }),
        "[1580..1591]", // 1580 is a leap year, so +365d from its Jan 1 stays in 1580
      );
    });

    it("resizes only the dragged endpoint of an interval, start handle", function () {
      assert.equal(
        shiftEdtfDate("1607-04/1609-04", { start: 60 * DAY }),
        "1607-05/1609-04",
      );
    });

    it("resizes only the dragged endpoint of an interval, end handle", function () {
      assert.equal(
        shiftEdtfDate("1607-04/1609-04", { end: 60 * DAY }),
        "1607-04/1609-05",
      );
    });

    it("moves both endpoints of an interval on a body drag", function () {
      assert.equal(
        shiftEdtfDate("1607-04/1609-04", { start: 60 * DAY, end: 60 * DAY }),
        "1607-05/1609-05",
      );
    });

    it("leaves the string alone when no delta is given", function () {
      assert.equal(shiftEdtfDate("1579-01-23", {}), "1579-01-23");
      assert.equal(shiftEdtfDate("1607-04/1609-04", {}), "1607-04/1609-04");
    });
  });
});
