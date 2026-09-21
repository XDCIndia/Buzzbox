import assert from 'node:assert/strict';
import { test } from 'node:test';
import { secureCompare } from './secure-compare';

test('matching secrets return true', () => {
  assert.equal(secureCompare('secret-value', 'secret-value'), true);
});

test('mismatched secrets return false', () => {
  assert.equal(secureCompare('secret-a', 'secret-b'), false);
});

test('length mismatch returns false (no throw)', () => {
  assert.equal(secureCompare('short', 'a-much-longer-secret-value'), false);
  assert.equal(secureCompare('a-much-longer-secret-value', 'short'), false);
});

test('empty or missing inputs return false', () => {
  assert.equal(secureCompare(null, 'x'), false);
  assert.equal(secureCompare('x', null), false);
  assert.equal(secureCompare('', 'x'), false);
  assert.equal(secureCompare('x', ''), false);
  assert.equal(secureCompare(undefined, undefined), false);
});

test('unicode secrets compare correctly', () => {
  assert.equal(secureCompare('héllo🔑', 'héllo🔑'), true);
  assert.equal(secureCompare('héllo🔑', 'héllo'), false);
});
