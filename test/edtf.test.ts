import { assert } from "chai";
import edtf from "edtf";
import {
  boundsOf,
  dateAtViewportPrecision,
  formOf,
  precisionForViewportSpan,
  shiftEdtfDate,
  toTimelineRange,
} from "../src/utils/edtfRange";

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

  it("spans a one-of set even when its parsed .type cannot be trusted", function () {
    // Regression guard for the bundler class-name mangling risk boundsOf()
    // used to carry: it must decide a Set is a Set from the "[...]" syntax of
    // the input string, not from `value.type`. Overriding just this instance's
    // own `.type` (not the shared Set.prototype getter, which edtf's own
    // constructor re-checks on every parse) simulates what esbuild renaming
    // the Set class would do to that value's `.type` without corrupting edtf
    // itself. A regression to a `value.type === "Set"` check fails this: it
    // would fall back to the plain min/max path and span only the first
    // member.
    const probe = edtf("[1580..1590]");
    Object.defineProperty(probe, "type", { configurable: true, value: "_Set" });
    const [min, max] = boundsOf("[1580..1590]", probe);
    assert.equal(iso(new Date(min)), "1580-01-01T00:00:00.000Z");
    assert.equal(iso(new Date(max)), "1590-12-31T23:59:59.999Z");
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

  describe("formOf", function () {
    it("names each of the seven forms", function () {
      assert.equal(toTimelineRange("1621").form, "plain");
      assert.equal(toTimelineRange("1621?").form, "uncertain");
      assert.equal(toTimelineRange("1580~").form, "approximate");
      assert.equal(toTimelineRange("1580/1590").form, "interval");
      assert.equal(toTimelineRange("[1580..1590]").form, "one-of");
      assert.equal(toTimelineRange("2001-21").form, "season");
      assert.equal(toTimelineRange("{1667,1668,1670}").form, "list");
    });

    it("tells a one-of and an interval apart even though they share a start/end pair", function () {
      const interval = toTimelineRange("1580/1590");
      const oneOf = toTimelineRange("[1580..1590]");
      assert.equal(interval.form, "interval");
      assert.equal(oneOf.form, "one-of");
      assert.equal(interval.start.getTime(), oneOf.start.getTime());
      assert.equal(interval.end?.getTime(), oneOf.end?.getTime());
    });

    it("derives interval and season correctly even when .type cannot be trusted", function () {
      // Regression guard for the same bundler class-name mangling risk
      // boundsOf's own test guards against: Interval's and Season's .type
      // getters derive from this.constructor.name, which esbuild's
      // scope-hoisting has been observed renaming. formOf must never consult
      // .type at all, so corrupting it here changes nothing.
      const intervalProbe = edtf("1580/1590");
      Object.defineProperty(intervalProbe, "type", {
        configurable: true,
        value: "_Interval",
      });
      assert.equal(
        formOf("1580/1590", intervalProbe, false, false),
        "interval",
      );

      const seasonProbe = edtf("2001-21");
      Object.defineProperty(seasonProbe, "type", {
        configurable: true,
        value: "_Season",
      });
      assert.equal(formOf("2001-21", seasonProbe, false, false), "season");
    });
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

  describe("precisionForViewportSpan", function () {
    it("picks year precision for a span wider than 20 years", function () {
      assert.equal(precisionForViewportSpan(21 * 365.25 * DAY), "year");
    });

    it("falls to month precision at exactly 20 years", function () {
      assert.equal(precisionForViewportSpan(20 * 365.25 * DAY), "month");
    });

    it("picks month precision for a span between 2 and 20 years", function () {
      assert.equal(precisionForViewportSpan(5 * 365.25 * DAY), "month");
    });

    it("falls to day precision at exactly 2 years", function () {
      assert.equal(precisionForViewportSpan(2 * 365.25 * DAY), "day");
    });

    it("picks day precision for a span of 2 years or less", function () {
      assert.equal(precisionForViewportSpan(30 * DAY), "day");
    });
  });

  describe("dateAtViewportPrecision", function () {
    it("formats a year-only date for a wide viewport", function () {
      const time = new Date(Date.UTC(1580, 6, 13));
      const window = {
        start: new Date(Date.UTC(1400, 0, 1)),
        end: new Date(Date.UTC(1900, 0, 1)),
      };
      assert.equal(dateAtViewportPrecision(time, window), "1580");
    });

    it("formats a month-precision date for a mid-width viewport", function () {
      const time = new Date(Date.UTC(1580, 6, 13));
      const window = {
        start: new Date(Date.UTC(1578, 0, 1)),
        end: new Date(Date.UTC(1583, 0, 1)),
      };
      assert.equal(dateAtViewportPrecision(time, window), "1580-07");
    });

    it("formats a day-precision date for a narrow viewport", function () {
      const time = new Date(Date.UTC(1580, 6, 13));
      const window = {
        start: new Date(Date.UTC(1580, 5, 1)),
        end: new Date(Date.UTC(1580, 7, 1)),
      };
      assert.equal(dateAtViewportPrecision(time, window), "1580-07-13");
    });
  });
});
