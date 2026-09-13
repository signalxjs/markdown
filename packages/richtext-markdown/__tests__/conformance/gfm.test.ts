import { parseMarkdown } from '../../src/parser/index.js';
import { toHtml } from '../../src/testing/html.js';
import { loadGfm, loadKnownFailures } from '../helpers.js';
import { runConformance } from './suite.js';

runConformance({
    name: 'GFM',
    examples: loadGfm(),
    knownFailures: loadKnownFailures().gfm,
    parse: (source) => parseMarkdown(source),
    render: (root) => toHtml(root),
});
