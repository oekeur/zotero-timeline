/**
 * The suite baseline tripwire's diagnosis, shared between the tripwire's own
 * root hook (support-tripwire.test.ts) and the report spec that closes the
 * run (zzz-tripwire-report.test.ts).
 *
 * Backed by `globalThis`, not by this module's own top-level state. The
 * scaffold bundles every test/*.test.ts file into its own esbuild output and
 * loads each as a sibling <script> tag (see support-tripwire.test.ts's file
 * comment); esbuild's default browser output for that shape is a
 * self-contained IIFE per entry point, confirmed by bundling two files that
 * import a shared module and inspecting the output directly: each entry gets
 * its own inlined copy of the shared module, with its own independent copy of
 * any module-level variable. A plain exported `let` here would let the
 * tripwire's bundle write to its copy and the report's bundle read its own,
 * untouched one, and the report would pass no matter what the tripwire found.
 * `globalThis` is the one object both bundles' <script> tags actually share,
 * because it is the page's real global rather than something esbuild inlines
 * a copy of.
 */

export interface TripwireRecord {
  specTitle: string;
  message: string;
  index: number;
}

const GLOBAL_KEY = "__zoteroTimelineTripwireRecord";

/** Stores `record` only if no violation has been recorded yet this run. */
export function recordTripwireViolation(record: TripwireRecord): void {
  const scope = globalThis as any;
  if (scope[GLOBAL_KEY] === undefined) {
    scope[GLOBAL_KEY] = record;
  }
}

export function getTripwireRecord(): TripwireRecord | undefined {
  return (globalThis as any)[GLOBAL_KEY];
}

/**
 * An Error whose message survives the trip to the scaffold's reporter.
 *
 * The reporter prints `data?.error?.message` after JSON-serialising the
 * error to get it there, and `Error` defines `message` as a non-enumerable
 * own property, so `JSON.stringify(new Error("x"))` is `{}` and the
 * diagnosis would arrive as a bare `undefined` next to the spec title (see
 * waitFor.ts's `timeoutError`, which the same trap forced onto this file
 * too).
 */
export function survivableError(message: string): Error {
  const error = new Error(message);
  Object.defineProperty(error, "message", {
    value: message,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return error;
}
