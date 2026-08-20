# Zotero Timeline

Author event timelines inside Zotero, where every event cites sources from your
own library.

An event is an authored object with its own title, date, description, tags, and
a list of links to items in your library. Each link carries a named type from a
vocabulary you control, so "this source supports the event" and "this source
contradicts it" stay distinguishable. Several timelines can be drawn together on
one chronological axis.

**Status: pre-release. Nothing is installable yet.** The repository currently
holds the plugin skeleton, the build and test tooling, and the design documents.
No feature is implemented.

## What this is not

- Not a restoration of Zotero's removed Create Timeline. That plotted _items_ by
  publication date. This places _events_, which are authored objects with their
  own dates and citations.
- Events are not Zotero items. Hundreds of non-bibliographic items would land in
  your collections and exports, and Zotero's relations are symmetric and untyped,
  so the distinction between supporting and contradicting a claim collapses.
- Events are not notes parented to a source item. Parenting implies one owning
  source, which blocks the many-to-many item-to-event links this is built for.
- Not an exporter or a bridge to an external timeline application. Reintroducing
  a second app is the thing this exists to avoid.

## How events are stored

One JSON document per timeline, held in the content of a Zotero note item,
parented to a plugin-owned container item per library and marked with a storage
tag. Note content is a native item field, so the data rides Zotero's existing
item sync with no WebDAV or file-sync setup.

The accepted cost: events are invisible to Zotero's own search, tags and saved
searches, and cannot be cited.

Dates are [EDTF](https://www.loc.gov/standards/datetime/) (ISO 8601-2), so
uncertainty is representable: `1621?`, `1580~`, `[1580..1590]`, `1943-05/1943-06`.

## Compatibility

Zotero 7 through 10 (`strict_min_version` 6.999, `strict_max_version` 10.\*).

## Development

```bash
npm install
npm run build        # bundles, packs the .xpi, then runs tsc --noEmit
npm run lint:check
npm start            # launches Zotero against the dev profile named in .env
npm test
```

Copy `.env.example` to `.env` and fill in the Zotero binary path plus a profile
and data dir dedicated to this plugin before running `npm start`.

`CONTRIBUTING.md` covers reporting a bug, the pull request checklist, and the
manual verification steps a plugin needs because a plugin that fails to load
does so quietly.

## License

AGPL-3.0-or-later. See `LICENSE`.
