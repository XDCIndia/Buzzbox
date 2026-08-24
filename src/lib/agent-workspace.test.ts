import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';

import { isAllowedWorkspaceWritePath, normalizeWorkspaceRelativePath, resolveWorkspacePath } from './agent-workspace';

test('resolveWorkspacePath blocks absolute and traversal paths', () => {
  const root = path.resolve('/tmp/workspace-root');
  assert.equal(resolveWorkspacePath(root, '../x'), null);
  assert.equal(resolveWorkspacePath(root, '..'), null);
  assert.equal(resolveWorkspacePath(root, '/etc/passwd'), null);
  assert.equal(resolveWorkspacePath(root, 'a/../../b'), null);
  assert.ok(resolveWorkspacePath(root, 'notes.md')?.startsWith(root + path.sep));
});

test('normalizeWorkspaceRelativePath normalizes separators and collapses dot segments', () => {
  assert.equal(normalizeWorkspaceRelativePath('a/b/c.md'), 'a/b/c.md');
  assert.equal(normalizeWorkspaceRelativePath('a\\b\\c.md'), 'a/b/c.md');
  assert.equal(normalizeWorkspaceRelativePath('a/./b/../c.txt'), 'a/c.txt');
  assert.equal(normalizeWorkspaceRelativePath('  notes.md  '), 'notes.md');
});

test('normalizeWorkspaceRelativePath rejects traversal, absolute paths, and NUL bytes', () => {
  assert.equal(normalizeWorkspaceRelativePath('../x'), null);
  assert.equal(normalizeWorkspaceRelativePath('..'), null);
  assert.equal(normalizeWorkspaceRelativePath('a/../../b'), null);
  assert.equal(normalizeWorkspaceRelativePath('/etc/passwd'), null);
  assert.equal(normalizeWorkspaceRelativePath('a\0b'), null);
  assert.equal(normalizeWorkspaceRelativePath(''), null);
});

test('isAllowedWorkspaceWritePath allows safe text files and blocks sensitive paths', () => {
  assert.equal(isAllowedWorkspaceWritePath('AGENTS.md'), true);
  assert.equal(isAllowedWorkspaceWritePath('playbook.md'), true);
  assert.equal(isAllowedWorkspaceWritePath('.env'), false);
  assert.equal(isAllowedWorkspaceWritePath('state/leads.json'), false);
  assert.equal(isAllowedWorkspaceWritePath('logs/app.log'), false);
  assert.equal(isAllowedWorkspaceWritePath('notes.exe'), false);
  assert.equal(isAllowedWorkspaceWritePath('../escape.md'), false);
});

