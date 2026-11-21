import assert from 'node:assert/strict';
import { test } from 'node:test';
import { levelFromXp, xpForLevel, xpToNext } from '../shared/levels.ts';
import { validatePrefix } from '../shared/validators/prefix.ts';

test('level math round-trips', () => {
  for (const l of [0, 1, 5, 20, 100]) assert.equal(levelFromXp(xpForLevel(l)), l);
});
test('one XP short of a level stays below it', () => {
  assert.equal(levelFromXp(xpForLevel(10) - 1), 9);
  assert.equal(levelFromXp(xpForLevel(10) + xpToNext(10) - 1), 10);
});
test('multiplier scales the curve', () => assert.ok(xpForLevel(10, 2) > xpForLevel(10, 1)));
test('prefix validation', () => {
  assert.equal(validatePrefix('!'), null);
  assert.equal(validatePrefix('?!'), null);
  for (const bad of ['', 'abcd', 'a b', '/', '@', '<']) assert.notEqual(validatePrefix(bad), null);
});
