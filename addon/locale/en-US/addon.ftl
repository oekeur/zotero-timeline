timeline-tab-label = Timeline
timeline-spike-heading = Rendering spike
timeline-spike-note = A hardcoded two-timeline, four-event fixture. Click an event to select it first, then drag it: an event is not draggable until selected. The payload is written to Help > Debug Output.

# Shown in the Timeline tab when the open library can't be written. This is
# the reason in words the read-only rule requires: every control that would
# change a timeline is disabled at the same time, but a disabled control on
# its own does not say why.
timeline-read-only-banner = { $library } can't be edited. You can browse every timeline here, but nothing can be created, changed, or deleted.

# Shown when the plugin's own container item is moved to the trash. Trashing it
# hides every timeline in the library at once, and nothing in Zotero says so.
container-trashed-now = Zotero Timeline's data item was moved to the trash, so every timeline in this library is now hidden. Restore it from the trash to get them back.

timeline-trashed-now = The timeline "{ $name }" was moved to the trash. Restore it from the trash to get it back.

timeline-trashed-now-unnamed = A timeline was moved to the trash. Restore it from the trash to get it back.

# Shown instead of creating a library's first timeline when the tab opens.
# The library's storage note or container is only in the trash, so it looks
# empty rather than actually being empty; creating here would hand the user a
# blank timeline while the one they had sat unreachable.
timeline-data-trashed-open = Timeline data for this library is in the trash. Nothing new was created; restore it to get your timelines back.

# Shown after the link-type list was rebuilt from the defaults because the
# library had none. Naming the trash is what makes it actionable: the labels
# come back if the old note is restored, because links store type ids.
vocabulary-recovered = Zotero Timeline rebuilt this library's link types from the defaults, because it could not find the list. If you deleted it, the previous list is in the trash; restoring it brings your own labels back.

# Shown once per timeline per session as a document approaches the largest note
# Zotero's sync server will accept. Names the timeline and says what to do,
# because a number alone is not something the user can act on.
timeline-approaching-size-limit = The timeline "{ $name }" is getting close to the largest note Zotero will sync. Split it into two timelines to be safe.

# Shown before a timeline is deleted, naming it and how many events go with
# it. The erase goes through Zotero's trash rather than being permanent,
# which is worth saying here rather than leaving the user to hope.
timeline-delete-confirm-title = Delete timeline
timeline-delete-confirm-message =
    { $count ->
        [0] Delete "{ $name }"? It has no events. It will move to Zotero's trash, where it can be restored.
        [one] Delete "{ $name }"? It and its { $count } event will move to Zotero's trash, where they can be restored.
       *[other] Delete "{ $name }"? It and its { $count } events will move to Zotero's trash, where they can be restored.
    }

# The vocabulary editor in the preference pane. Its container is rebuilt from
# scratch on every state change, so its text is read through getString rather
# than data-l10n-id - see vocabularySettings.ts's top-of-file comment.
vocabulary-loading = Loading…
vocabulary-library-label = Library
vocabulary-not-yet-stored = These are the default link types. They have not been saved for this library yet; the first change you make here creates the list.
vocabulary-version-unsupported = This library's link types were saved by a newer version of Zotero Timeline and can't be edited here. Update the plugin to edit them.
vocabulary-unreadable = Zotero Timeline could not read this library's link types ({ $message }). It will not overwrite them; fix or restore the note from the trash.
vocabulary-add-button = Add
vocabulary-edit-button = Edit
vocabulary-delete-button = Delete
vocabulary-save-button = Save
vocabulary-cancel-button = Cancel
vocabulary-field-label = Label
vocabulary-delete-confirm-title = Delete link type
vocabulary-delete-confirm-used =
    { $count ->
        [0] Delete this link type? No source links use it.
        [one] Delete this link type? { $count } source link uses it and will show as "(unknown type)" there.
       *[other] Delete this link type? { $count } source links use it and will show as "(unknown type)" there.
    }
vocabulary-delete-confirm-unknown = Could not check how many source links use this type: the library's timeline data could not be read. Delete anyway?
vocabulary-error-not-writable = This library can't be edited, so the change was not saved.
vocabulary-error-empty = A library's link types can't be empty. Add another type before deleting the last one.
vocabulary-error-generic = Zotero Timeline could not save this change: { $message }

# The library context menu entries that attach the selection to an event that
# already exists. The flat form is generic because the library holds only one
# timeline when it shows, so nothing else needs naming; the submenu form
# completes with a timeline's own name, one per row.
context-add-sources-flat = Add as Sources to Timeline…
context-add-sources-submenu = Add as Sources to…

# The standalone "Add as sources" window opened from that menu. Its own text
# is read through getString rather than data-l10n-id, the same choice
# vocabularySettings.ts makes: the whole form is rebuilt from scratch once its
# data has loaded, so there is nothing for a static <linkset> to translate in
# place.
add-sources-dialog-title = Add as sources
add-sources-dialog-context =
    { $count ->
        [one] Add { $count } item as sources to an event in "{ $timeline }"
       *[other] Add { $count } items as sources to an event in "{ $timeline }"
    }
add-sources-dialog-empty = This timeline has no events yet.
add-sources-dialog-event-label = Event
add-sources-dialog-type-label = Type
add-sources-dialog-attach-button = Attach
add-sources-dialog-cancel-button = Cancel
add-sources-dialog-close-button = Close
add-sources-dialog-result-success =
    { $count ->
        [0] Nothing attached: every selected item was already cited under this type.
        [one] Attached { $count } source.
       *[other] Attached { $count } sources.
    }
add-sources-dialog-result-skipped = Already cited under this type, so not attached again: { $names }.
