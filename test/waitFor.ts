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
export async function waitFor<T>(
  get: () => T | null | undefined | Promise<T | null | undefined>,
  description: string,
  {
    timeout = 5000,
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
      throw new Error(
        `waitFor: timed out after ${timeout}ms waiting for ${description}`,
      );
    }
    await Zotero.Promise.delay(interval);
  }
}
