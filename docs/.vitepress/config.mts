import { defineConfig } from "vitepress";

const SITE_BASE = "/zotero-timeline/";
const SITE_URL = `https://oekeur.github.io${SITE_BASE}`;
const SITE_TITLE = "Zotero Timeline";
const SITE_DESCRIPTION =
  "A Zotero 7-10 plugin for authoring event timelines whose events cite sources from your own library.";

// https://vitepress.dev/reference/site-config
export default defineConfig({
  lang: "en-US",
  title: SITE_TITLE,
  titleTemplate: ":title | Zotero Timeline",
  description: SITE_DESCRIPTION,
  base: SITE_BASE,
  cleanUrls: true,
  lastUpdated: true,

  // The backfill queue is a working document that tracks which docs still need
  // writing. It describes the docs rather than the plugin, so it stays in the
  // repo and off the site.
  srcExclude: ["backfill-queue.md"],

  sitemap: { hostname: SITE_URL },

  head: [
    ["meta", { name: "author", content: "Oscar Keur" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:site_name", content: SITE_TITLE }],
    ["meta", { property: "og:title", content: SITE_TITLE }],
    ["meta", { property: "og:description", content: SITE_DESCRIPTION }],
    ["meta", { property: "og:url", content: SITE_URL }],
  ],

  themeConfig: {
    search: { provider: "local" },

    nav: [
      { text: "User guide", link: "/user-guide/getting-started" },
      { text: "Contributing", link: "/contributing/development-setup" },
      { text: "Internals", link: "/internals/storage-explanation" },
      {
        text: "Repository",
        link: "https://github.com/oekeur/zotero-timeline",
      },
    ],

    socialLinks: [
      {
        icon: "github",
        link: "https://github.com/oekeur/zotero-timeline",
      },
    ],

    editLink: {
      pattern: "https://github.com/oekeur/zotero-timeline/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },

    footer: {
      message: "Released under the AGPL-3.0-or-later license.",
      copyright: "Copyright © Oscar Keur",
    },

    outline: { level: [2, 3] },

    sidebar: {
      "/user-guide/": [
        {
          text: "Start here",
          items: [
            { text: "Getting started", link: "/user-guide/getting-started" },
          ],
        },
        {
          text: "Plugin data in your library",
          collapsed: false,
          items: [
            {
              text: "Recovering trashed plugin data",
              link: "/user-guide/plugin-data-howto",
            },
            {
              text: "What the plugin stores",
              link: "/user-guide/plugin-data-reference",
            },
            {
              text: "Why data lives in a note",
              link: "/user-guide/plugin-data-explanation",
            },
          ],
        },
      ],

      "/contributing/": [
        {
          text: "Contributing",
          items: [
            {
              text: "Development setup",
              link: "/contributing/development-setup",
            },
            {
              text: "npm scripts",
              link: "/contributing/npm-scripts-reference",
            },
            { text: "Running tests", link: "/contributing/testing-howto" },
            {
              text: "Why tests run against live Zotero",
              link: "/contributing/testing-explanation",
            },
            {
              text: "Debugging a running Zotero",
              link: "/contributing/mcp-observability-howto",
            },
            {
              text: "Why the MCP observability rig was adopted",
              link: "/contributing/mcp-observability-explanation",
            },
          ],
        },
      ],

      "/internals/": [
        {
          text: "Storage and data model",
          collapsed: false,
          items: [
            { text: "Storage design", link: "/internals/storage-explanation" },
          ],
        },
      ],
    },
  },
});
