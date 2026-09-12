## Reading list

The [CommonMark spec][spec] is the ground truth, the [GFM spec][gfm] adds
tables and task lists, and [mdast] names the node types. For the streaming
design see [the engine notes][engine] and the [collapsed reference][], which is
resolved by label.

Some references are used before their definition arrives, which is the normal
case when an answer is streamed: the definition comes at the end. An image
reference works the same way: ![sigx logo][logo].

A reference with no definition, like [this one][missing], stays literal, and
so does an [undefined shortcut].

[spec]: https://spec.commonmark.org/0.31.2/ "CommonMark 0.31.2"
[gfm]: https://github.github.com/gfm/
[mdast]: https://github.com/syntax-tree/mdast
[engine]: ./engine.md 'Engine notes'
[collapsed reference]: ./collapsed.md
[logo]: https://sigx.dev/logo.png (The logo)
