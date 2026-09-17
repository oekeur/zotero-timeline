/**
 * Wraps Zotero.Notifier.registerObserver/unregisterObserver behind one
 * counted registry, so a leaked observer is visible from a spec.
 *
 * Zotero's own unregisterObserver is a silent `delete _observers[id]`:
 * calling it with a hash that was never registered, or one already released,
 * does nothing and reports nothing. Keying this registry on the hash Zotero
 * RETURNED from registerObserver, rather than the id passed in, and only
 * decrementing the live set when that exact hash is still held, is what lets
 * a wrong or repeated release show up as a live count that fails to drop
 * instead of reading as a clean one.
 */
import { logTrace } from "../../utils/logging";

const liveHashes = new Set<string>();

export function registerNotifierObserver(
  ref: { notify: _ZoteroTypes.Notifier.Notify },
  types: _ZoteroTypes.Notifier.Type[],
  id: string,
): string {
  const hash = Zotero.Notifier.registerObserver(ref, types, id);
  liveHashes.add(hash);
  return hash;
}

/**
 * Always forwards to Zotero's own unregisterObserver, unchanged: behaviour
 * for a genuine caller does not depend on this registry's bookkeeping. Only
 * the live count depends on whether the hash was actually held.
 */
export function unregisterNotifierObserver(hash: string): void {
  Zotero.Notifier.unregisterObserver(hash);
  if (liveHashes.has(hash)) {
    liveHashes.delete(hash);
  } else {
    logTrace(
      `[zoteroTimeline] unregisterNotifierObserver: hash ${hash} was not live`,
    );
  }
}

export function liveNotifierObservers(): number {
  return liveHashes.size;
}

/** For diagnostics: which hashes this registry currently considers live. */
export function liveNotifierObserverIds(): string[] {
  return [...liveHashes];
}
