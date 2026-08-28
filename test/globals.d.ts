// Mocha's globals for the type-checker only. Declared as references rather
// than through tsconfig's `types` field, because setting `types` replaces the
// list inherited from zotero-types/entries/sandbox and takes every Zotero
// global with it (measured: 1118 errors, all "Cannot find name 'Zotero'").
//
// The runner and the assertions themselves come from the scaffold's own
// harness; nothing here is imported at runtime.
/// <reference types="mocha" />
/// <reference types="chai" />
