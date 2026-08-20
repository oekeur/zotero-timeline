// Bundled UI libraries reference the global `console` at module top level,
// unguarded. Zotero's bootstrap sandbox does not provide one, so importing
// such a library throws and aborts plugin startup before anything runs.
//
// This must be imported before anything that (transitively) imports
// vis-timeline. It is the first statement of src/index.ts for that reason.
function emit(level: number, args: unknown[]): void {
  // Zotero is injected into the bootstrap scope, but this file evaluates very
  // early, so do not assume it is there yet.
  if (typeof Zotero === "undefined") {
    return;
  }
  Zotero.debug(`[ZoteroTimeline] ${args.join(" ")}`, level);
}

if (typeof console === "undefined") {
  (globalThis as any).console = {
    log: (...args: unknown[]) => emit(3, args),
    warn: (...args: unknown[]) => emit(2, args),
    error: (...args: unknown[]) => emit(1, args),
    info: (...args: unknown[]) => emit(3, args),
    debug: (...args: unknown[]) => emit(5, args),
    group: (...args: unknown[]) => emit(3, args),
    groupCollapsed: (...args: unknown[]) => emit(3, args),
    groupEnd: () => {},
    trace: () => {},
  };
}
