Setext headings and indented code
=================================

An older style, still common in READMEs pasted into a chat. The heading above
is level one; the one below is level two.

Installing
----------

Indent by four spaces for a code block, no fence needed:

    pnpm add @sigx/markdown
    pnpm add -D vitest

    # a blank line inside the block is kept

The block ends at the first non-indented line. A paragraph that is followed by
a line of dashes becomes a heading, so this
is a heading too
----------------

And a line of dashes on its own is a thematic break:

---

Last paragraph, with trailing `code` and a soft
break before the end.
