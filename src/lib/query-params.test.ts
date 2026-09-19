import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server';
import { clampParam } from './query-params';

function req(url: string): NextRequest {
  return new NextRequest(url);
}

test('clampParam returns fallback when param absent', () => {
  assert.equal(clampParam(req('http://localhost/api/x'), 'limit', 1, 100, 50), 50);
});

test('clampParam returns fallback for non-numeric values', () => {
  assert.equal(clampParam(req('http://localhost/api/x?limit=abc'), 'limit', 1, 100, 50), 50);
});

test('clampParam returns fallback for empty value', () => {
  assert.equal(clampParam(req('http://localhost/api/x?limit='), 'limit', 1, 100, 50), 50);
});

test('clampParam clamps below the minimum', () => {
  assert.equal(clampParam(req('http://localhost/api/x?limit=-5'), 'limit', 1, 100, 50), 1);
});

test('clampParam clamps above the maximum (issue #64)', () => {
  assert.equal(clampParam(req('http://localhost/api/x?limit=999999999'), 'limit', 1, 100, 50), 100);
});

test('clampParam floors non-integers', () => {
  assert.equal(clampParam(req('http://localhost/api/x?limit=10.9'), 'limit', 1, 100, 50), 10);
});

test('clampParam passes through in-range values', () => {
  assert.equal(clampParam(req('http://localhost/api/x?limit=42'), 'limit', 1, 100, 50), 42);
});
