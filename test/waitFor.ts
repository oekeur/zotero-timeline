/**
 * Polls `get` until it returns something truthy, then hands that value back.
 *
 * Sleeping a flat number of milliseconds after a click encodes a guess about
 * how long the handler takes. The add-link form is where the guess broke:
 * with no mindmap in the library yet, opening it creates the container item
 * and the storage note before it renders, around 400ms on an idle machine
 * against a 600ms sleep, and a loaded CI runner closed the gap.
 *
 * Timing out throws and names the condition, so the failure points at what
 * never appeared instead of at whatever the caller asserted next.
 *
 * `get` may be async, for conditions that need a read (a write landing in a
 * mindmap document) rather than a DOM query. It must be cheap and free of
 * side effects: it runs every `interval` until it succeeds.
 *
 * This is the wrong tool for asserting that nothing happens. Waiting for the
 * absence of an effect has no condition to poll, and a fixed delay stays the
 * honest way to express it.
 */
/**
 * How long an effect is given before the wait is called a failure.
 *
 * Raised from 5000ms on 2026-08-28, on measurement rather than by reflex.
 * Adding TASK-15's sub-lane rows and TASK-50's tag control put more
 * Fluent-tagged nodes into every tab open, and resolution was measured at 3.7s
 * against the old 5s ceiling on an idle machine. On a busier one the same suite
 * produced 26 failures where it had produced 6, every one of them a timeout
 * rather than a wrong value.
 *
 * Why this does not weaken anything. These waits assert that a condition
 * EVENTUALLY holds; a longer ceiling changes nothing about a condition that
 * never holds, since the spec still fails and still names what it waited for.
 * The only cost is wall-clock on a run that was going to fail anyway, and the
 * only thing given up is using a timeout as a crude performance assertion,
 * which it was never a reliable one of: the same number passed or failed
 * depending on what else the machine was doing.
 *
 * A genuine performance budget belongs in its own spec, measured deliberately,
 * not smuggled into every effect wait in the suite.
 */
const DEFAULT_TIMEOUT_MS = 15000;

/**
 * An Error whose message survives the trip to the scaffold's reporter.
 *
 * The reporter prints `data?.error?.message`, and the Zotero side serialises
 * the error as JSON to get it there. `Error` defines `message` as a
 * non-enumerable own property, so `JSON.stringify(new Error("x"))` is `{}` and
 * every timeout arrived as a bare `undefined` next to the spec title, saying
 * nothing about what never happened. Chai's AssertionError survives only
 * because it never calls `super()`, so its assigned `message` is enumerable.
 *
 * Redefining the property here buys the same survival while staying a real
 * Error: `instanceof Error` still holds and the stack is untouched.
 */
function timeoutError(message: string): Error {
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
 * A key that exists in the built mainWindow bundle, used only to ask whether
 * Fluent is answering at all.
 *
 * The build prefixes every source key with the addon ref, so the source name
 * `timeline-chrome-zoom-in` resolves to nothing and a probe using it reports a
 * dead pipeline no matter what the pipeline is doing. That mistake cost a full
 * investigation on 2026-09-04.
 */
const L10N_PROBE_KEY = "zoterotimeline-timeline-chrome-zoom-in";

/**
 * What Fluent was doing at the moment a wait gave up.
 *
 * Most of this suite's intermittent failures are waits on Fluent-backed labels
 * that resolve in well under a second or never resolve at all, with nothing in
 * between. That shape says the resource stopped being answered rather than
 * that the render got slow, but a bare timeout cannot tell the two apart. This
 * asks directly: `formatMessages` returning a message means Fluent is alive
 * and the condition failed for its own reasons; `[null]` means the key is not
 * in any loaded bundle; a timeout on the probe itself means the pipeline is
 * wedged.
 *
 * Runs only on the failure path, and never throws: a diagnostic that can fail
 * replaces the real error with its own.
 */
async function l10nHealth(): Promise<string> {
  try {
    const win = Zotero.getMainWindow() as Window | undefined;
    const doc = win?.document;
    if (!doc) {
      return "l10n: no main window";
    }
    const links = Array.from(
      doc.querySelectorAll('link[rel="localization"]'),
    ).map((link) => (link as Element).getAttribute("href"));
    const inHead = doc.head
      ? doc.head.querySelectorAll('link[rel="localization"]').length
      : 0;
    const probe = await Promise.race([
      (doc as any).l10n
        .formatMessages([{ id: L10N_PROBE_KEY }])
        .then((messages: unknown) => JSON.stringify(messages)),
      Zotero.Promise.delay(2000).then(() => "PROBE ITSELF TIMED OUT"),
    ]);
    return (
      `l10n: probe=${probe}; head=${!!doc.head}; ` +
      `localizationLinks=${links.length} (${inHead} inside head): ${links.join(", ")}`
    );
  } catch (error) {
    return `l10n: probe threw ${String(error)}`;
  }
}

export async function waitFor<T>(
  get: () => T | null | undefined | Promise<T | null | undefined>,
  description: string,
  {
    timeout = DEFAULT_TIMEOUT_MS,
    interval = 20,
  }: { timeout?: number; interval?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const found = await get();
    if (found) {
      return found;
    }
    if (Date.now() >= deadline) {
      throw timeoutError(
        `waitFor: timed out after ${timeout}ms waiting for ${description}. ` +
          (await l10nHealth()),
      );
    }
    await Zotero.Promise.delay(interval);
  }
}
