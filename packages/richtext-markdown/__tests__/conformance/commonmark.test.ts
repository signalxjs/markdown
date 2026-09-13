import { parseMarkdown } from '../../src/parser/index.js';
import { toHtml } from '@sigx/richtext-html';
import { loadCommonMark, loadKnownFailures } from '../helpers.js';
import { runConformance } from './suite.js';

runConformance({
    name: 'CommonMark',
    examples: loadCommonMark(),
    knownFailures: loadKnownFailures().commonmark,
    parse: (source) => parseMarkdown(source),
    // The conformance layout: no URL sanitising (the spec has javascript: examples).
    render: (root) => toHtml(root, { sanitize: false }),
});
