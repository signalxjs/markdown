Thanks @[Andy](u1) — good question. cc @[Maria](u2) since she wrote the
renderer.

:::note
The `:::note` container is a plugin block: without the plugin the lines are a
plain paragraph, with it they become a `note` node with the paragraphs below as
children.

- it can hold lists
- and **inline** formatting, including a mention of @[Andy](u1)
:::

A mention inside other inline content works too: *ask @[Andy](u1) first*, or
in a list:

1. @[Maria](u2) reviews the renderer
2. @[Andy](u1) merges

:::warning
An unterminated container at the end of a streamed answer stays open until its
closing fence arrives.
:::
