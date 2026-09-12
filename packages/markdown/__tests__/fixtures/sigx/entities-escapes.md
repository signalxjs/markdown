# Entities &amp; escapes

Copyright &copy; 2026 &mdash; all rights reserved&hellip; Prices in &euro; and
&pound;, temperatures in &deg;C, spacing with&nbsp;non-breaking&nbsp;spaces.
Arrows: &larr; &uarr; &rarr; &darr;, math: &sum; &ne; &infin;, Greek: &alpha;&beta;&gamma;.

Numeric forms: &#35; &#x23; &#X23; decode to the same `#`; &#0; and &#xD800;
become the replacement character; &#1114112; is out of range. Unknown names
such as &MadeUpEntity; and a bare &copy without a semicolon stay literal.

Backslash escapes keep punctuation literal: \*not emphasis\*, \_not either\_,
\# not a heading, \[not a link\](nope), \`not code\`, and a trailing backslash
before a newline is a hard break\
like this. A backslash before a letter is just a backslash: C:\Users\andy.

Inside code the rules are off: `&amp; \* stays as typed` and so does a fence:

```
&copy; \* &#35;
```

Autolinks keep their entities encoded: <https://example.com/?a=1&b=2&amp;c=3>.
