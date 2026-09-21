import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAppliedTo } from './experiments';

test('parseAppliedTo parses valid JSON arrays', () => {
  assert.deepEqual(
    parseAppliedTo('["LinkedIn","X","YouTube"]'),
    ['LinkedIn', 'X', 'YouTube'],
  );
});

test('parseAppliedTo returns empty array for malformed JSON', () => {
  assert.deepEqual(
    parseAppliedTo('["LinkedIn",INVALID]'),
    [],
  );
});

test('parseAppliedTo returns empty array for non-array JSON', () => {
  assert.deepEqual(
    parseAppliedTo('{"platform":"LinkedIn"}'),
    [],
  );
});

test('parseAppliedTo returns empty array for non-string array values', () => {
  assert.deepEqual(
    parseAppliedTo('[1,2,3]'),
    [],
  );
});

test('parseAppliedTo returns empty array for null or empty values', () => {
  assert.deepEqual(parseAppliedTo(null), []);
  assert.deepEqual(parseAppliedTo(''), []);
});
