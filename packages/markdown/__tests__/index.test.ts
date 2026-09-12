import { describe, expect, it } from 'vitest';
import { CURRENT_VERSION } from '@sigx/markdown';

describe('@sigx/markdown root entry', () => {
    it('declares the JSON document format version', () => {
        expect(CURRENT_VERSION).toBe(1);
    });
});
