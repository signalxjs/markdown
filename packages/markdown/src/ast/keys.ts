/**
 * Reconciliation keys.
 *
 * A top-level block is `b-<absolute index>`; every keyed descendant is
 * `<parent key>.<index in parent>` (a list `b-2` → item `b-2.1` → its
 * paragraph `b-2.1.0`; a table `b-4` → row `b-4.0` → cell `b-4.0.2`). Keys
 * are content- and offset-independent and unique per document, so a block
 * keeps its key when it moves from the live tail to the finalized prefix.
 * Which types carry a key is the schema's call (`schema.isKeyed`).
 */

export function topKey(index: number): string {
    return `b-${index}`;
}

export function childKey(parentKey: string, index: number): string {
    return `${parentKey}.${index}`;
}
