/**
 * The save-friendly document format: the `Root` itself, as plain JSON, with
 * `data.version` for forward compatibility and `data.format` naming the
 * source format it was parsed from (informational — the tree is the same
 * whatever the format).
 *
 * `toJSON()` deep-clones and strips what is transient (reconciliation keys,
 * the streaming `open` flag, and — by default — positions); `fromJSON()`
 * validates the shape and version and re-assigns keys so the tree is ready to
 * render or edit.
 */

import { assignKeys, standardSchema, type Schema } from '../schema/index.js';
import type { Node, Root, RootData } from '../ast/index.js';

/** The JSON document format version `toJSON()` writes. */
export const CURRENT_VERSION = 1;

/** A `Root` whose `data.version` is set — what `toJSON()` returns. */
export interface RichTextDocument extends Root {
    data: RootData & { version: number };
}

export type DocumentFormatErrorCode = 'invalid-shape' | 'unsupported-version';

export class DocumentFormatError extends Error {
    readonly code: DocumentFormatErrorCode;
    constructor(code: DocumentFormatErrorCode, message: string) {
        super(message);
        this.name = 'DocumentFormatError';
        this.code = code;
    }
}

export interface FromJSONOptions {
    /** Decides which nodes get keys. Default: the standard schema (unknown types are keyed). */
    schema?: Schema;
}

export interface ToJSONOptions {
    /** Keep `position` on every node. Default `false`. */
    position?: boolean;
    /** Record the source format's id in `data.format`. */
    format?: string;
}

/** Serialize a tree to the JSON document format (a deep clone; the input is untouched). */
export function toJSON(root: Root, options?: ToJSONOptions): RichTextDocument {
    const keepPosition = options?.position === true;
    const clone = (node: Node): Node => {
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(node)) {
            if (key === 'key' || key === 'open') continue;
            if (key === 'position' && !keepPosition) continue;
            const value = (node as unknown as Record<string, unknown>)[key];
            if (key === 'children' && Array.isArray(value)) {
                out.children = value.map((c) => clone(c as Node));
            } else {
                out[key] = cloneValue(value);
            }
        }
        return out as unknown as Node;
    };
    const doc = clone(root) as RichTextDocument;
    doc.data = { ...doc.data, version: CURRENT_VERSION };
    if (options?.format) doc.data.format = options.format;
    return doc;
}

function cloneValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(cloneValue);
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = cloneValue(v);
        return out;
    }
    return value;
}

/**
 * Parse the JSON document format back into a keyed `Root`. Accepts the parsed
 * object (or a JSON string). Throws `DocumentFormatError` on a wrong shape or
 * a version newer than this package understands.
 */
export function fromJSON(input: unknown, options?: FromJSONOptions): Root {
    const json = typeof input === 'string' ? JSON.parse(input) : input;
    if (!isRecord(json) || json.type !== 'root' || !Array.isArray(json.children)) {
        throw new DocumentFormatError('invalid-shape', 'Expected a root node with a children array.');
    }
    const data = isRecord(json.data) ? json.data : undefined;
    const version = data?.version;
    if (version !== undefined) {
        if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
            throw new DocumentFormatError('invalid-shape', `Invalid document version: ${String(version)}.`);
        }
        if (version > CURRENT_VERSION) {
            throw new DocumentFormatError(
                'unsupported-version',
                `Document version ${version} is newer than the supported version ${CURRENT_VERSION}.`,
            );
        }
    }
    if (data?.format !== undefined && typeof data.format !== 'string') {
        throw new DocumentFormatError('invalid-shape', 'data.format must be a string.');
    }
    validateNodes(json.children, 'children');
    const root = cloneValue(json) as Root;
    return assignKeys(root, options?.schema ?? standardSchema);
}

function validateNodes(nodes: unknown[], path: string): void {
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (!isRecord(node) || typeof node.type !== 'string') {
            throw new DocumentFormatError('invalid-shape', `Node at ${path}[${i}] has no string type.`);
        }
        if (node.children !== undefined) {
            if (!Array.isArray(node.children)) {
                throw new DocumentFormatError('invalid-shape', `Node at ${path}[${i}] has non-array children.`);
            }
            validateNodes(node.children, `${path}[${i}].children`);
        }
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
