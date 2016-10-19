/* @flow */

import rewriteCssWithIdMap from './rewriteCssWithIdMap';

import {getId} from './idMap';

test('rewrites single classname', () => {
  expect(rewriteCssWithIdMap(`
    .IDMAP_foo {
      color: red;
    }
  `)).toBe(`
    .${getId('IDMAP_foo')} {
      color: red;
    }
  `);
});

test('only rewrites IDMAP_ classnames', () => {
  expect(rewriteCssWithIdMap(`
    .blaaah {
      color: blue;
    }
    .foo .x.IDMAP_foo.y .blah .IDMAP_xyz-_def3, .x {
      color: red;
    }
    .xyz .IDMAP_foo::after {}
  `)).toBe(`
    .blaaah {
      color: blue;
    }
    .foo .x.${getId('IDMAP_foo')}.y .blah .${getId('IDMAP_xyz-_def3')}, .x {
      color: red;
    }
    .xyz .${getId('IDMAP_foo')}::after {}
  `);
});

test('name is not present in rewritten CSS', () => {
  const output = rewriteCssWithIdMap(`
    .IDMAP_foo3 {
      color: red;
    }
  `);
  expect(output.includes('foo3')).toBe(false);
});
