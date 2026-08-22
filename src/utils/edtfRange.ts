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

export interface EdtfShiftDelta {
  /** Applied to the instant itself, or to an Interval's lower bound, in ms. */
  start?: number;
  /** Applied to an Interval's upper bound only, in ms. */
  end?: number;
}

/**
 * Shifts a single EDTF instant by `deltaMs`, keeping its precision (a
 * year-only string stays year-only) and its uncertain/approximate qualifiers.
 *
 * Rebuilds the value from date parts rather than formatting a string by hand:
 * edtf's own `Date` constructor already knows how to reattach a bitmask
 * qualifier to a set of values, which is the part a hand-rolled formatter
 * would otherwise have to reimplement.
 */
function shiftInstant(value: string, deltaMs: number): string {
  const parsed = edtf(value);
  const shifted = new Date(parsed.min + deltaMs);
  const precision = parsed.precision ?? 3;
  const values =
    precision <= 1
      ? [shifted.getUTCFullYear()]
      : precision === 2
        ? [shifted.getUTCFullYear(), shifted.getUTCMonth()]
        : [
            shifted.getUTCFullYear(),
            shifted.getUTCMonth(),
            shifted.getUTCDate(),
          ];
  return edtf({
    values,
    uncertain: parsed.uncertain,
    approximate: parsed.approximate,
  }).edtf;
}

/**
 * Re-serialises an EDTF string after a drag moves it by `delta`, without
 * silently sharpening its precision or dropping a qualifier - the rewrite a
 * mouse movement must never cause (project/backlog/plans, m-2 decisions).
 *
 * An Interval's two endpoints move independently: `delta.start` shifts the
 * lower bound, `delta.end` the upper, and the other endpoint's own substring
 * is left exactly as authored when its delta is omitted - a resize on one
 * edge must not touch the other. A one-of Set has no separate endpoints to
 * resize, so every member shifts by whichever single delta is given
 * (`delta.start` preferred, `delta.end` as a fallback), which is the only
 * reading that leaves the set meaning what it meant. Anything else - a plain
 * instant - shifts by that same single delta.
 *
 * Branches on the input string's own syntax ("/" for an Interval, "[...]"
 * for a Set) rather than on a parsed value's `.type`. Verified against a real
 * built test bundle: `edtf`'s classes are named at runtime through
 * `this.constructor.name`, and esbuild renamed `Interval` to `_Interval` to
 * dodge a collision elsewhere in the bundle - `value.type === "Interval"`
 * silently never matched. EDTF's grammar reserves both characters for
 * exactly these two constructs, so the string itself is the one signal
 * bundling cannot rename out from under this.
 */
export function shiftEdtfDate(input: string, delta: EdtfShiftDelta): string {
  if (input.includes("/")) {
    const separator = input.indexOf("/");
    const lower = input.slice(0, separator);
    const upper = input.slice(separator + 1);
    return [
      delta.start !== undefined ? shiftInstant(lower, delta.start) : lower,
      delta.end !== undefined ? shiftInstant(upper, delta.end) : upper,
    ].join("/");
  }

  if (input.startsWith("[") && input.endsWith("]")) {
    const shift = delta.start ?? delta.end;
    const value = edtf(input);
    if (shift === undefined || !value.values) {
      return input;
    }
    const members = value.values.map((member) =>
      Array.isArray(member)
        ? `${shiftInstant(member[0].edtf, shift)}..${shiftInstant(member[1].edtf, shift)}`
        : shiftInstant(member.edtf, shift),
    );
    return `[${members.join(",")}]`;
  }

  const shift = delta.start ?? delta.end;
  return shift === undefined ? input : shiftInstant(input, shift);
}
