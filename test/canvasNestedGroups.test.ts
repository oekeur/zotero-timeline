import { assert } from "chai";
import {
  buildTimelineItem,
  parseGroupId,
  trackGroupId,
  tracksOf,
} from "../src/modules/timeline/canvas";
import {
  CURRENT_SCHEMA_VERSION,
  type Event,
  type TimelineDocument,
} from "../src/modules/timeline/schema";

function event(id: string, date: string, extra: Partial<Event> = {}): Event {
  return { id, title: id, date, sources: [], tags: [], ...extra };
}

function doc(id: string, events: Event[]): TimelineDocument {
  return { version: CURRENT_SCHEMA_VERSION, id, name: id, events };
}

/**
 * Sub-lanes within a timeline, via vis-timeline's nestedGroups (TASK-15).
 * These are the pure pieces: what a group id for a sub-lane is, how it comes
 * apart again, which tracks a document has, and which group id an event lands
 * in. Whether they actually make vis-timeline draw a nested row is a live
 * question, covered separately (test/timelineSubLanes.test.ts).
 */
describe("sub-lane group ids (TASK-15)", function () {
  describe("trackGroupId / parseGroupId", function () {
    it("round-trips a document id and a track through the group id", function () {
      const id = trackGroupId("doc-abc12345", "military");
      assert.equal(parseGroupId(id).documentId, "doc-abc12345");
      assert.equal(parseGroupId(id).track, "military");
    });

    it("parses a plain document id (no track) back unchanged", function () {
      const parsed = parseGroupId("doc-abc12345");
      assert.equal(parsed.documentId, "doc-abc12345");
      assert.isUndefined(parsed.track);
    });
  });

  describe("tracksOf", function () {
    it("lists every distinct track in first-seen order, once each", function () {
      const document = doc("doc-1", [
        event("ev-a", "1700", { track: "military" }),
        event("ev-b", "1701", { track: "diplomatic" }),
        event("ev-c", "1702", { track: "military" }),
      ]);
      assert.deepEqual(tracksOf(document), ["military", "diplomatic"]);
    });

    it("is empty for a document with no tracked events - the one-lane case", function () {
      const document = doc("doc-1", [event("ev-a", "1700")]);
      assert.deepEqual(tracksOf(document), []);
    });

    it("ignores untracked events mixed in with tracked ones", function () {
      const document = doc("doc-1", [
        event("ev-a", "1700"),
        event("ev-b", "1701", { track: "military" }),
      ]);
      assert.deepEqual(tracksOf(document), ["military"]);
    });
  });

  describe("buildTimelineItem's group routing", function () {
    it("routes an untracked event to the document's own group, unchanged", function () {
      const item = buildTimelineItem("doc-1", event("ev-a", "1700"));
      assert.equal(item.group, "doc-1");
    });

    it("routes a tracked event to its sub-lane's group, never the document's", function () {
      const item = buildTimelineItem(
        "doc-1",
        event("ev-a", "1700", { track: "military" }),
      );
      assert.equal(item.group, trackGroupId("doc-1", "military"));
    });

    it("routes a tracked but unreadable event to its sub-lane too", function () {
      const item = buildTimelineItem(
        "doc-1",
        event("ev-a", "not-a-date", { track: "military" }),
      );
      assert.equal(item.group, trackGroupId("doc-1", "military"));
    });
  });
});
