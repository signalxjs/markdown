import { expectTypeOf, test } from 'vitest';
import type * as mdast from 'mdast';
import type {
    Blockquote,
    Code,
    Definition,
    Heading,
    Image,
    ImageReference,
    Link,
    LinkReference,
    List,
    ListItem,
    Paragraph,
    Root,
    Table,
    Text,
} from '../../src/ast/index.js';

test('the AST is structurally assignable to mdast', () => {
    expectTypeOf<Root>().toExtend<mdast.Root>();
    expectTypeOf<Paragraph>().toExtend<mdast.Paragraph>();
    expectTypeOf<Heading>().toExtend<mdast.Heading>();
    expectTypeOf<Blockquote>().toExtend<mdast.Blockquote>();
    expectTypeOf<List>().toExtend<mdast.List>();
    expectTypeOf<ListItem>().toExtend<mdast.ListItem>();
    expectTypeOf<Code>().toExtend<mdast.Code>();
    expectTypeOf<Definition>().toExtend<mdast.Definition>();
    expectTypeOf<Table>().toExtend<mdast.Table>();
    expectTypeOf<Text>().toExtend<mdast.Text>();
    expectTypeOf<Link>().toExtend<mdast.Link>();
    expectTypeOf<Image>().toExtend<mdast.Image>();
    expectTypeOf<LinkReference>().toExtend<mdast.LinkReference>();
    expectTypeOf<ImageReference>().toExtend<mdast.ImageReference>();
});
