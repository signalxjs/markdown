# @sigx/richtext-html

HTML for [`@sigx/richtext`](../richtext) — a platform-free parser (no
`DOMParser`, so it runs on Lynx and in the terminal) that turns the markup
reaching a clipboard, a CMS field or an LLM answer into the standard tree, a
serializer with the CommonMark reference layout, `htmlFormat` (the
`DocumentFormat` a view or editor reads and writes with), the HTML slice
plugins fill under `formats.html`, and the `text/html` clipboard preset. Zero
dependencies beyond `@sigx/richtext`, no `node:` imports.

| Entry | What |
|---|---|
| `@sigx/richtext-html` | `htmlFormat`, `parseHtml`, `toHtml`, the `HtmlPluginSlice` contract (`elements`: tag → node rules, `serialize`: node → HTML rules), `mentionHtml`, the tokenizer and tree for custom tooling |
| `@sigx/richtext-html/editor` | `htmlPreset` — copying blocks puts `text/html` on the clipboard next to the primary format's flavour |

## Install

```bash
npm install @sigx/richtext @sigx/richtext-html
```

Peers on `@sigx/richtext` and on `@sigx/reactivity` / `@sigx/runtime-core`
at the same minor as your app's `sigx`.

## Taste

Markdown and HTML are the same tree, so converting is parse then serialize:

```ts
import { markdownFormat } from '@sigx/richtext-markdown';
import { htmlFormat, parseHtml, toHtml } from '@sigx/richtext-html';

toHtml(markdownFormat.parse('# Hi\n\nSome **markdown**.'));
// '<h1>Hi</h1>\n<p>Some <strong>markdown</strong>.</p>\n'

markdownFormat.serialize(parseHtml('<h1>Hi</h1><p>Some <b>html</b>.</p>'));
// '# Hi\n\nSome **html**.\n'
```

The parser repairs what browsers repair (an unclosed `<p>`, a bare `<li>`, a
table without `<tbody>`), keeps only `href` / `src` (through the core's
`sanitizeUrl`) and treats every unknown element as transparent — pasted
markup cannot smuggle handlers or styles into the document.

An editor that reads and writes both:

```tsx
import { RichTextEditor } from '@sigx/richtext/editor/dom';
import { markdownFormat } from '@sigx/richtext-markdown';
import { markdownPreset } from '@sigx/richtext-markdown/editor';
import { htmlFormat } from '@sigx/richtext-html';
import { htmlPreset } from '@sigx/richtext-html/editor';

<RichTextEditor format={markdownFormat} formats={[htmlFormat]} plugins={[markdownPreset, htmlPreset]} model:source={[note, 'md']} />
```

Pasting from a browser now parses the `text/html` flavour (specific flavours
win over `text/plain`), and copying a block selection writes `text/markdown`
and `text/html` side by side.

A plugin's HTML syntax is a slice keyed by tag (reading) and node type
(writing):

```ts
const mention: HtmlPluginSlice = {
    elements: { span: (el, ctx) => (el.attrs['data-mention'] ? { type: 'mention', id: el.attrs['data-mention'], label: ctx.text().slice(1) } : null) },
    serialize: { mention: (node, ctx) => `<span data-mention="${ctx.attr(node.id)}">@${ctx.escape(node.label)}</span>` },
};
```

(`mentionHtml` is exactly that.)

## Documentation

Guides, API reference and live examples: **<https://sigx.dev/richtext/>**

## License

MIT © Andreas Ekdahl
