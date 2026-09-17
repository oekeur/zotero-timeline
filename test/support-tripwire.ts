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

/**
 * One failed spec, plus what would otherwise have been lost about it.
 *
 * `messageWasEnumerable` records whether the error the spec threw would have
 * survived the scaffold's own JSON-serialising reporter (see
 * `survivableError` above); a `false` here is itself grounds for
 * zzz-tripwire-report.test.ts to fail, since it means the spec's own line in
 * the run reported `undefined` and this catalogue entry is the only place the
 * real text still exists. `newPluginErrors` is whatever the plugin logged to
 * `Zotero.getErrors()` while this spec's root beforeEach, body and afterEach
 * ran, which is where a detached async failure the spec itself never awaited
 * shows up.
 */
export interface CatalogueEntry {
  title: string;
  name: string;
  message: string;
  stackHead: string;
  messageWasEnumerable: boolean;
  newPluginErrors: string[];
}

const CATALOGUE_KEY = "__zoteroTimelineFailureCatalogue";

export function recordCatalogueEntry(entry: CatalogueEntry): void {
  const scope = globalThis as any;
  if (!Array.isArray(scope[CATALOGUE_KEY])) {
    scope[CATALOGUE_KEY] = [];
  }
  scope[CATALOGUE_KEY].push(entry);
}

export function getFailureCatalogue(): CatalogueEntry[] {
  return (
    ((globalThis as any)[CATALOGUE_KEY] as CatalogueEntry[] | undefined) ?? []
  );
}

const RAW_ERROR_KEY = "__zoteroTimelineRawTestErrors";

function rawErrorMap(): WeakMap<object, unknown> {
  const scope = globalThis as any;
  if (!(scope[RAW_ERROR_KEY] instanceof WeakMap)) {
    scope[RAW_ERROR_KEY] = new WeakMap<object, unknown>();
  }
  return scope[RAW_ERROR_KEY] as WeakMap<object, unknown>;
}

/**
 * Patches `Mocha.Runner.prototype.fail` so a root afterEach can recover the
 * real Error a spec threw, keyed by the Test instance.
 *
 * This harness's own reporter (generated into index.xhtml by
 * zotero-plugin-scaffold) never sets `test.err`: it only listens for the
 * runner's `"fail"` event and forwards its own `error` argument straight to
 * the node-side harness over HTTP, the same trip that drops a non-enumerable
 * `message` (see `survivableError` above). It never assigns anything back
 * onto the Test instance the way `Mocha.reporters.Base`'s constructor does
 * (mocha.js: `test.err = err` inside its `EVENT_TEST_FAIL` listener), so
 * `this.currentTest.err` stays undefined for the whole run and a root
 * afterEach reading it gets nothing to catalogue. `Runner.prototype.fail` is
 * the one place upstream of every reporter that always sees the real thrown
 * value, so this captures it there instead.
 *
 * Idempotent and safe to call once per bundle: each test/*.test.ts file is
 * bundled into its own esbuild output and loaded as a sibling <script> tag
 * (see support-tripwire.test.ts's file comment), so this can run at every
 * bundle's load time against the one real `Mocha.Runner.prototype` all of
 * them share, guarded so only the first call actually patches it.
 */
export function installRawErrorCapture(): void {
  const runnerCtor = (globalThis as any).Mocha?.Runner;
  if (!runnerCtor || runnerCtor.prototype.__zoteroTimelinePatched) {
    return;
  }
  runnerCtor.prototype.__zoteroTimelinePatched = true;
  const originalFail = runnerCtor.prototype.fail;
  runnerCtor.prototype.fail = function (
    test: object,
    err: unknown,
    ...rest: unknown[]
  ) {
    rawErrorMap().set(test, err);
    return originalFail.apply(this, [test, err, ...rest]);
  };
}

export function getRawError(test: object | undefined): unknown {
  return test === undefined ? undefined : rawErrorMap().get(test);
}

const ERROR_SNAPSHOT_KEY = "__zoteroTimelineErrorSnapshot";
const MAX_ERROR_TEXT_LENGTH = 400;

function errorSnapshot(): Set<string> {
  const scope = globalThis as any;
  if (!(scope[ERROR_SNAPSHOT_KEY] instanceof Set)) {
    scope[ERROR_SNAPSHOT_KEY] = new Set<string>();
  }
  return scope[ERROR_SNAPSHOT_KEY] as Set<string>;
}

/**
 * Diffs `Zotero.getErrors(true)` against the snapshot the last call to this
 * function left behind, then advances the snapshot to the current log.
 *
 * Called once per root `afterEach` regardless of whether the just-finished
 * spec passed, so a passing spec's own log entries never get attributed to
 * whichever later spec happens to fail first.
 */
export function diffNewPluginErrors(): string[] {
  const previous = errorSnapshot();
  const current = (Zotero.getErrors(true) as string[]) ?? [];
  const fresh = current.filter((entry) => !previous.has(entry));
  previous.clear();
  for (const entry of current) {
    previous.add(entry);
  }
  return fresh.map((entry) =>
    entry.length > MAX_ERROR_TEXT_LENGTH
      ? `${entry.slice(0, MAX_ERROR_TEXT_LENGTH)}…`
      : entry,
  );
}
