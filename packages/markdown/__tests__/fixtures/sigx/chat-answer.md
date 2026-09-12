# How the incremental engine keeps blocks stable

Short version: a block that has **closed** never changes again, even as the
source string keeps growing behind it. Here is the whole idea in three parts.

## 1. The block tree

The parser walks the source line by line and keeps an *open* block at the
end of the tree. Everything before it is final:

- Top-level blocks get keys `b-0`, `b-1`, `b-2`, …
  - Children get `<parent>.<i>`, so a list item is `b-3.0`
  - Nested lists keep nesting: `b-3.0.1`
    1. keys never change once a block closes
    2. the renderer reconciles on the key, not on the index
- A paragraph stays open while lines keep arriving
- A fenced code block stays open until its closing fence

## 2. The code

```ts
import { createIncrementalEngine } from '@sigx/markdown';

const engine = createIncrementalEngine();

export function onToken(chunk: string): void {
    // append, never replace — the engine diffs against its own state
    const tree = engine.append(chunk);

    for (const block of tree.children) {
        if (block.key === undefined) continue;
        render(block.key, block);
    }
}

function render(key: string, block: unknown): void {
    console.log(key, block);
}
```

## 3. What you get

| Operation | Cost | Notes |
|:----------|-----:|:------|
| append a token | O(open block) | re-parses only the tail |
| close a block | O(1) | assigns the key |
| render | O(changed) | keys drive reconciliation |

> A quick checklist before you rely on it:
>
> - `key` is only set on block-level nodes
> - `open` is only present on an unterminated `code` node
> - positions are exact — tabs are never expanded

See the [README](https://github.com/signalxjs/markdown#readme) and the mdast
[node reference](https://github.com/syntax-tree/mdast) for the field names;
`parseMarkdown()` and `createIncrementalEngine()` share the same plugin list.
