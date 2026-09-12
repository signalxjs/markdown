# Vendored spec examples

`spec.json` in this folder is derived from the **CommonMark Spec, version
0.31.2** by John MacFarlane — <https://spec.commonmark.org/0.31.2/> — which is
licensed under the [Creative Commons Attribution-ShareAlike 4.0 International
License](https://creativecommons.org/licenses/by-sa/4.0/) (CC-BY-SA 4.0).

It was fetched from <https://spec.commonmark.org/0.31.2/spec.json> on
2026-09-12 and filtered to the examples whose `section` is one of: Tabs,
Backslash escapes, Entity and numeric character references, Thematic breaks,
ATX headings, Setext headings, Indented code blocks, Fenced code blocks, Link
reference definitions, Paragraphs, Blank lines, Block quotes, List items,
Lists, Code spans, Emphasis and strong emphasis, Links, Images, Autolinks,
Hard line breaks, Soft line breaks, Textual content (586 of the 652 examples;
the HTML blocks, Raw HTML, Precedence and Inlines sections are left out). Each
entry keeps the spec's `example` number, `section`, `markdown` and `html`
fields unchanged.

The hand-written cases under `../gfm/` take their expected HTML from the
[GitHub Flavored Markdown Spec](https://github.github.com/gfm/), version
0.29-gfm, also CC-BY-SA 4.0, where a matching example exists.

Copyright (c) 2014-2024 John MacFarlane. Redistributed under CC-BY-SA 4.0;
these fixtures are test data and do not change the license of the
`@sigx/markdown` source code.
