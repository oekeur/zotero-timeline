# Why data lives in a note

Plugin data has to be somewhere. This one puts it in the content of Zotero note
items, parented to a container item the plugin owns. That looks odd the first
time you see it in your library, so here is the reasoning.

## The requirement that decides it

Timelines have to sync. A chronology built over months on a laptop and then
opened on a desktop must be the same chronology, without the user configuring
anything.

That single requirement rules out most of the obvious places.

## What was ruled out

**A file in the Zotero data directory.** It does not sync. Zotero's file sync
covers attachments, not arbitrary plugin files, so this would need WebDAV or a
cloud folder, configured per machine, with no conflict handling.

**`Zotero.SyncedSettings`.** This is the API that looks purpose-built for it,
and it is not usable here. The data server whitelists setting names, so a
plugin's own key is not accepted, and values are capped at 30,000 characters.
One timeline of any size exceeds that.

**Events as Zotero items.** Hundreds of non-bibliographic items would land in
your collections, your exports, and your citation picker. Zotero's relations
between items are also symmetric and untyped, so "this source supports the
event" and "this source contradicts it" would collapse into one
indistinguishable edge. That distinction is the whole point.

**Events as notes parented to their source item.** Parenting implies one owning
source. An event usually has several, and one source is usually cited by
several events, so this blocks the many-to-many structure before it starts.

## What is left

Note content is a native item field. It rides Zotero's existing item sync with
no configuration, no size cap worth worrying about, and no second sync channel
to fail independently.

So each timeline is one JSON document in one note. The container item exists to
keep those notes out of the way: any number of them collapse into a single
top-level row, and Zotero's native link picker does not offer them as targets.

## What you pay for it

**Your plugin data is visible and deletable.** It appears in your library as
items, and ordinary library operations apply to it. A stray delete puts your
timelines in the trash. That is recoverable, and
[the how-to](/user-guide/plugin-data-howto) covers it, but it is a real failure
mode that a private file would not have.

**Events are invisible to Zotero.** They are not items, so they do not appear
in search, in the tag selector, in saved searches, or in a bibliography.

**Last-write-wins.** Zotero syncs note content wholesale. Two machines editing
the same timeline while both offline means the second sync wins outright.
Writes are scoped to one document per edit rather than rewriting everything, so
the blast radius of that is a single timeline instead of your whole library.
And a document written by a newer plugin version is refused rather than partly
read, because a partial parse followed by a save is how last-write-wins turns
into silent data loss.

## Where this design came from

It is lifted from
[zotero-linked-mindmaps](https://github.com/oekeur/zotero-linked-mindmaps),
deliberately rather than reinvented. That plugin solved the same storage
problem against the same constraints, and the argument for note-backed storage
applies here unchanged.
