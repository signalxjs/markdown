import { parseMarkdown } from '../../src/parser/index.js';
import { toHtml } from '../../src/testing/index.js';
import { loadCommonMark, loadKnownFailures } from '../helpers.js';
import { runConformance } from './suite.js';

runConformance({
    name: 'CommonMark',
    examples: loadCommonMark(),
    knownFailures: loadKnownFailures().commonmark,
    parse: (source) => parseMarkdown(source),
    render: (root) => toHtml(root),
});
