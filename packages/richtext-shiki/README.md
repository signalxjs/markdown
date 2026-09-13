# @sigx/richtext-shiki

[Shiki](https://shiki.style/) syntax highlighting for
[`@sigx/richtext`](../richtext)'s DOM view: a lazily-loaded, cached
highlighter behind the core's `CodeHighlighter` contract, shipped as a plugin
that contributes the highlighted `code` slot. The only richtext package that
imports `shiki`.

## Install

```bash
npm install @sigx/richtext @sigx/richtext-shiki shiki
```

Peers on `@sigx/richtext`, `shiki` and the sigx runtime (`@sigx/reactivity`,
`@sigx/runtime-core`, `@sigx/runtime-dom`) at the same minor as your app's
`sigx`.

## Use

```tsx
import { RichTextView } from '@sigx/richtext/dom';
import { markdownFormat } from '@sigx/richtext-markdown';
import { shikiPlugin } from '@sigx/richtext-shiki';

const plugins = [shikiPlugin({ themes: { light: 'github-light', dark: 'github-dark' } })];

<RichTextView value={source} format={markdownFormat} plugins={plugins} />
```

`shiki` loads on the first code block (pass `load` to bring your own
bundle); until then the block renders as plain tokens and swaps in place.
`createShikiHighlighter(options)` is the highlighter alone, for a custom
`highlightedCodeBlock()`.

## Documentation

Guides, API reference and live examples: **<https://sigx.dev/richtext/>**

## License

MIT © Andreas Ekdahl
