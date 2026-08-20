# Storage design

The user-facing version of this argument is
[Why data lives in a note](/user-guide/plugin-data-explanation). This page is
the implementation view: what the constraints are, what follows from them, and
which decisions are load-bearing.

## Constraints

**Sync is required, configuration is not.** A timeline authored on one machine
opens on another with the user having set nothing up.

**`Zotero.SyncedSettings` is unavailable.** The data server whitelists setting
names, so a plugin key is rejected, and values are capped at 30,000 characters.
Neither limit is negotiable from the client.

**File sync covers attachments, not plugin files.** Anything written into the
data directory needs WebDAV or an external cloud folder, per machine.

**Note content is a native item field.** It rides item sync, which the user has
already configured, with no second channel to fail independently.

That leaves note content. Everything below follows from taking it.

## The shape

One container item per library, plugin-owned and top-level. One note per
timeline, parented to it, holding a JSON document. One further note for the
link-type vocabulary, parented to the same container.

The container does two jobs. It collapses any number of plugin notes into a
single visible row, and it keeps them out of Zotero's native link-target
picker, which offers top-level items.

**Notes are told apart by tag, not by order or position.** The timeline
documents carry a storage tag; the vocabulary note carries a different one.
Listing timelines filters on the storage tag, so the vocabulary can never be
parsed as a timeline and a new note kind can be added later without changing
the read path.

## Consequences of last-write-wins

Zotero syncs note content wholesale. There is no field-level merge, so two
offline edits to one note end with the later sync winning outright. Three
decisions exist to bound that.

**One document per edit.** Moving an event dirties exactly one timeline
document, and exactly one note is written. This is finer-grained than
rewriting a single whole-library document, and it means a conflict costs one
timeline rather than all of them.

**A newer version is refused, not partly read.** Both stored shapes carry a
`version`. Reading one the code does not know means neither parsing nor
writing it: the timeline appears in the list as unreadable, naming both
versions, and everything else carries on. The alternative is the real hazard.
A partial parse drops the fields the reader does not know about; the next save
writes that reduced document back; last-write-wins makes it authoritative. The
loss is silent and happens on a machine nobody is watching.

**Type ids, never labels.** A source link stores the link type's `id`. Renaming
a type touches only the vocabulary note, with no migration pass over every
timeline. Deleting a type leaves the links that used it holding an id that
resolves to nothing, rendered as unknown, because a vocabulary edit must not
destroy authored work.

## References into the library

A source reference is `{kind, libraryID, key}`. Numeric item ids are
device-local and mean nothing after a sync; keys are what Zotero syncs by, and
a key is only unique within its library. Identity needs all three.

## Namespaced vis ids

The items DataSet handed to `vis-timeline` is keyed by id, and two timeline
documents will each contain locally-unique event ids. Items are therefore
keyed `${documentId}:${eventId}`.

That namespace is also the write-back route. `onMove` returns the moved item,
whose documented fields are `content`, `start` and optionally `end`; the group
is not guaranteed to be present. **Never decide which note to write from
`item.group`.** Derive the document from the namespaced id. Getting this wrong
lands an edit in the wrong timeline and looks like it worked.

## Recovery

A missing vocabulary note is recreated from the defaults on the next read, with
a warning naming what happened and saying the old note is in the trash and
restorable. It is not recreated silently: every source link in the library
would begin rendering as an unknown type with no explanation. Because links
store ids rather than labels, restoring the trashed note reattaches every label
at once.

A trashed container is reported rather than worked around, since recreating it
would orphan the notes still parented to the old one.

## Where this came from

Lifted from
[zotero-linked-mindmaps](https://github.com/oekeur/zotero-linked-mindmaps)
rather than designed fresh. The constraints are identical and that plugin has
already run into the failure modes. Deviating from it needs a reason.
