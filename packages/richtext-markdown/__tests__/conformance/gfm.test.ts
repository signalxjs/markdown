import { parseMarkdown } from '../../src/parser/index.js';
import { toHtml } from '@sigx/richtext-html';
import { loadGfm, loadKnownFailures } from '../helpers.js';
import { runConformance } from './suite.js';

runConformance({
    name: 'GFM',
    examples: loadGfm(),
    knownFailures: loadKnownFailures().gfm,
    parse: (source) => parseMarkdown(source),
    // The conformance layout: no URL sanitising (the spec has javascript: examples).
    render: (root) => toHtml(root, { sanitize: false }),
});
