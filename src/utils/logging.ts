/**
 * Zotero.debug is only captured once debug logging is already enabled (Help
 * -> Debug Output Logging), so anything logged through it alone is gone by the
 * time a bug is reported. Zotero.logError additionally reaches the Mozilla
 * error console (Zotero.getErrors()), which Zotero records unconditionally -
 * that's the channel failures need to survive on.
 */

/**
 * Logs a genuine failure through Zotero.logError. `message` should already
 * carry the `[zoteroTimeline]` prefix and any relevant detail, matching the
 * convention at existing call sites. Zotero.logError only forwards
 * `err.message` to the error console, not `err.stack`, so the stack is folded
 * into the message here rather than left on the Error object.
 */
export function logFailure(message: string, err?: unknown): void {
  const stack = (err instanceof Error && err.stack) || new Error().stack;
  Zotero.logError(new Error(stack ? `${message}\n${stack}` : message));
}

/**
 * Traces an expected-and-handled condition at Zotero's default debug level.
 * Only visible while debug logging is already enabled.
 */
export function logTrace(message: string, level?: number): void {
  Zotero.debug(message, level);
}
