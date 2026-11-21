import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAllowed } from '../shared/permissions/engine.ts';

const base = { isOwner: false, isServerOwner: false, kinds: [], overrides: {} } as const;

test('owner can do everything, including owner-only modules', () => {
  assert.equal(isAllowed({ ...base, isOwner: true, module: 'trustedbots' }), true);
});
test('admin cannot manage trusted bots', () => {
  assert.equal(isAllowed({ ...base, kinds: ['admin'], module: 'trustedbots' }), false);
});
test('mod cannot access owner-only commands', () => {
  for (const m of ['roles', 'permissions', 'trustedbots']) assert.equal(isAllowed({ ...base, kinds: ['mod'], module: m }), false);
});
test('owner-only modules cannot be granted via overrides', () => {
  assert.equal(isAllowed({ ...base, kinds: ['admin'], module: 'trustedbots', overrides: { admin: { trustedbots: true } } }), false);
});
test('anti-nuke role is not a super admin', () => {
  assert.equal(isAllowed({ ...base, kinds: ['antinuke'], module: 'moderation' }), false);
  assert.equal(isAllowed({ ...base, kinds: ['antinuke'], module: 'antinuke' }), true);
});
test('explicit deny beats allow from another role', () => {
  const overrides = { admin: { tickets: false }, mod: { tickets: true } };
  assert.equal(isAllowed({ ...base, kinds: ['admin', 'mod'], module: 'tickets', overrides }), false);
});
test('override can grant a module to mod', () => {
  assert.equal(isAllowed({ ...base, kinds: ['mod'], module: 'tickets', overrides: { mod: { tickets: true } } }), true);
});
test('server owner is admin tier but not bot owner', () => {
  assert.equal(isAllowed({ ...base, isServerOwner: true, module: 'prefix' }), true);
  assert.equal(isAllowed({ ...base, isServerOwner: true, module: 'trustedbots' }), false);
});
test('regular members only get public commands', () => {
  assert.equal(isAllowed({ ...base, module: null }), true);
  assert.equal(isAllowed({ ...base, module: 'prefix' }), false);
});
test('unknown modules are denied for non-owners', () => {
  assert.equal(isAllowed({ ...base, kinds: ['admin'], module: 'nope' }), false);
});
