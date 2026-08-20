import edtf from "edtf";

/**
 * An EDTF value reduced to what vis-timeline needs to draw it.
 *
 * `end` is present whenever the value covers more than one instant, which for
 * EDTF is almost always: "1621" is a whole year, not a point. vis-timeline
 * draws an item with a start and an end as a range and one with only a start
 * as a point, so the distinction is what decides how an event looks.
 */
export interface TimelineRange {
  start: Date;
  end?: Date;
  /** "1621?" - the date is asserted but doubted. */
  uncertain: boolean;
  /** "1580~" - the date is deliberately imprecise. */
  approximate: boolean;
}

function qualifierIsSet(
  qualifier: { value: number } | boolean | undefined,
): boolean {
  if (typeof qualifier === "boolean") return qualifier;
  return qualifier !== undefined && qualifier.value !== 0;
}

/**
 * Bounds of an EDTF value in epoch milliseconds.
 *
 * A Set's own `min`/`max` describe only its first member: parsing
 * "[1580..1590]" yields max 1580-12-31, not 1590-12-31. Iterating gives the
 * real span. Verified against edtf@4.11.1.
 */
function boundsOf(value: ReturnType<typeof edtf>): [number, number] {
  if (value.type === "Set") {
    const members = [...value];
    if (members.length > 0) {
      return [members[0].min, members[members.length - 1].max];
    }
  }
  return [value.min, value.max];
}

/**
 * Parses an EDTF string and maps it onto a vis-timeline start/end pair.
 *
 * Throws whatever edtf throws on an unparseable string; callers validating
 * user input should catch rather than pre-check, since edtf's grammar is the
 * only authority on what is legal.
 */
export function toTimelineRange(input: string): TimelineRange {
  const value = edtf(input);
  const [min, max] = boundsOf(value);

  return {
    start: new Date(min),
    end: max > min ? new Date(max) : undefined,
    uncertain: qualifierIsSet(value.uncertain),
    approximate: qualifierIsSet(value.approximate),
  };
}
