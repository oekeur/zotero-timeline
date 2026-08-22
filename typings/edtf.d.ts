// edtf@4.11.1 ships no type declarations and there is no @types/edtf on npm
// (checked 2026-08-20). This covers only the surface the plugin uses.
//
// `min` and `max` are epoch milliseconds bounding the value. `max` is the last
// millisecond inside the value, not one past it: parsing "1621" gives a max of
// 1621-12-31T23:59:59.999Z.
declare module "edtf" {
  interface EdtfQualifier {
    value: number;
  }

  interface EdtfValue {
    /** "Date", "Interval", "Set", "Season", "List". */
    readonly type: string;
    readonly edtf: string;
    readonly min: number;
    readonly max: number;
    readonly uncertain?: EdtfQualifier | boolean;
    readonly approximate?: EdtfQualifier | boolean;
    /** Present on a "Date" value: 1 = year, 2 = year-month, 3 = year-month-day. */
    readonly precision?: number;
    /**
     * Present on a "Set" (and "List"): each entry is either one member, or a
     * `[from, to]` pair for a consecutive sub-range within the set.
     */
    readonly values?: (EdtfValue | [EdtfValue, EdtfValue])[];
    /**
     * Sets and Intervals iterate their members. A Set's own min/max cover only
     * its first member, so a span has to come from the members themselves.
     */
    [Symbol.iterator](): Iterator<EdtfValue>;
  }

  export default function edtf(input: string): EdtfValue;
  /**
   * Builds a "Date" value from explicit components rather than parsing a
   * string - the re-serialisation path after a drag, which computes new date
   * parts and needs to reattach the original qualifiers rather than reparse
   * text.
   */
  export default function edtf(input: {
    values: number[];
    uncertain?: EdtfQualifier | boolean;
    approximate?: EdtfQualifier | boolean;
  }): EdtfValue;
}
