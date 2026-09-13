Sure — here is a minimal example. First install the package:

```sh
pnpm add @sigx/markdown
```

Then wire the stream into a view:

1. create the engine
2. feed it tokens as they arrive
3. render the tree after every step

Notes so far:

- the tree after step *n* is a prefix-stable extension of step *n − 1*
- nothing before the open block moves

The component looks like this:

```tsx
import { createTextStream } from '@sigx/markdown';

export function Answer(props: { text: () => string }) {
    const stream = createTextStream(props.text);

    return (
        <article>
            {stream.blocks().map((block) => (
                <Block key={block.key} node={block} />
            ))}
        </article>
    );
}

function Block(props: { node: unknown }) {
    // still streaming: the closing fence has not arrived
    return <pre>{JSON.stringify(props.node)}</pre>
