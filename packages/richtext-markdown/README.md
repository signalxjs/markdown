# @sigx/richtext-markdown

Markdown for [`@sigx/richtext`](../richtext) — a CommonMark + GFM parser that
keeps finalized blocks stable while a source string grows (built for
token-by-token AI output), a serializer, `markdownFormat` (the
`DocumentFormat` a view or editor reads and writes with), the node specs
markdown adds to the standard vocabulary, the markdown syntax-extension
contract plugins fill under `formats.markdown`, and the editor preset (the
CommonMark conformance suite renders through `@sigx/richtext-html`). Zero
dependencies beyond `@sigx/richtext`, no `node:` imports.

| Entry | What |
|---|---|
| `@sigx/richtext-markdown` | `markdownFormat`, `parseMarkdown`, `createIncrementalEngine`, `toMarkdown`, `markdownNodes` / `markdownSchema`, `collectDefinitions`, the `MarkdownPluginSlice` contract (`block`, `inline`, `serialize`, `entities`, `transformBlock`, `transformDocument`), `mentionPlugin` / `mentionMarkdown` |
| `@sigx/richtext-markdown/editor` | `markdownPreset` — the input rules (`# `, `- `, `**bold**`), Enter rules (```` ``` ````, `---`) and the `text/markdown` clipboard flavour that make a `@sigx/richtext` editor a markdown editor |

## Install

```bash
npm install @sigx/richtext @sigx/richtext-markdown
```

Peers on `@sigx/richtext` and on `@sigx/reactivity` / `@sigx/runtime-core`
at the same minor as your app's `sigx`.

## Taste

```ts
import { createIncrementalEngine, parseMarkdown, toMarkdown } from '@sigx/richtext-markdown';

const root = parseMarkdown('# Hi\n\nSome **markdown**.');   // an mdast Root, keyed and positioned
toMarkdown(root);                                            // '# Hi\n\nSome **markdown**.\n'

const engine = createIncrementalEngine();
const a = engine.parse('# Hi\n\nSome **mark');
const b = engine.parse('# Hi\n\nSome **markdown**.');
a.children[0] === b.children[0];                             // true: finalized blocks keep identity
```

The same machinery as a format — what `<RichTextView>` and `createEditor()`
take:

```tsx
import { RichTextView } from '@sigx/richtext/dom';
import { markdownFormat } from '@sigx/richtext-markdown';

<RichTextView value={source} format={markdownFormat} />
```

Extending the syntax is a slice of a `RichTextPlugin`:

```ts
import type { RichTextPlugin } from '@sigx/richtext';

const mention: RichTextPlugin = {
    name: 'mention',
    nodes: [mentionNode],
    formats: {
        markdown: {
            inline: [{ name: 'mention', triggerChars: ['@'], match: (text, pos, ctx) => /* … */ }],
            serialize: { mention: (node) => `@[${node.label}](${node.id})` },
        },
    },
};
```

(`mentionPlugin` is exactly that, shipped as the reference plugin.)

## Documentation

Guides, API reference and live examples: **<https://sigx.dev/richtext/>**

## License

MIT © Andreas Ekdahl
