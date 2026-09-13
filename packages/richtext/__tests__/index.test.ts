import { describe, expect, it } from 'vitest';
import { CURRENT_VERSION } from '../src/index.js';

describe('@sigx/richtext root entry', () => {
    it('declares the JSON document format version', () => {
        expect(CURRENT_VERSION).toBe(1);
    });
});
