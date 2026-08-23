'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const { Timeline } = require('..');

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

function repository() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-test-'));
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.name', 'Timeline Test');
  git(repo, 'config', 'user.email', 'timeline-test@example.com');
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'one\n');
  git(repo, 'add', 'tracked.txt');
  git(repo, 'commit', '-m', 'initial');
  return repo;
}

test('sync imports history without touching normal Git state', (t) => {
  const repo = repository();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'one\ntwo\n');
  fs.writeFileSync(path.join(repo, 'new.txt'), 'new\n');
  git(repo, 'add', 'tracked.txt');
  const beforeHead = git(repo, 'rev-parse', 'HEAD');
  const beforeIndex = git(repo, 'write-tree');

  const timeline = new Timeline({ repo });
  const snapshot = timeline.sync();

  assert.equal(git(repo, 'rev-parse', 'HEAD'), beforeHead);
  assert.equal(git(repo, 'write-tree'), beforeIndex);
  assert.equal(git(repo, 'branch', '--show-current'), 'main');
  assert.equal(git(repo, 'show', `${snapshot}:new.txt`), 'new');
  const project = new Timeline({ repo, session: 'project' });
  assert.deepEqual(project.files(2).sort(), ['new.txt', 'tracked.txt']);
});

test('checkpoint records ordered events and exposes diff context', (t) => {
  const repo = repository();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const timeline = new Timeline({ repo, session: 'project' });
  timeline.sync();
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'one\ntwo\n');

  const commit = timeline.with({
    label: 'update tracked.txt', event: 'PostToolUse', tool: 'apply_patch', turn: '7', toolUse: 'tool-1',
  }).checkpoint();

  assert.ok(commit);
  assert.equal(timeline.list().length, 2);
  assert.match(timeline.diff(2), /^\+two$/m);
  assert.deepEqual(timeline.files(2), ['tracked.txt']);
  assert.equal(timeline.context(2).tool, 'apply_patch');
  assert.equal(timeline.context(2).turn, '7');
  assert.equal(timeline.checkpoint(), null);
});

test('pending tools flush in order and support enable/disable', (t) => {
  const repo = repository();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const timeline = new Timeline({ repo, session: 'project', codexSession: 'task-1' });
  timeline.sync();
  timeline.with({ label: 'edit file', toolUse: 'tool-1', tool: 'apply_patch' }).pendingSet();
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'changed\n');

  const commits = timeline.with({ toolUse: 'tool-1' }).flush();

  assert.equal(commits.length, 1);
  assert.equal(timeline.context(2).tool_use, 'tool-1');
  assert.equal(timeline.status(), 'enabled');
  assert.equal(timeline.disable(), 'disabled');
  assert.equal(timeline.status(), 'disabled');
  assert.equal(timeline.enable(), 'enabled');
});

test('a tool-specific flush leaves other pending tool calls alone', (t) => {
  const repo = repository();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const timeline = new Timeline({ repo, session: 'project', codexSession: 'task-1' });
  timeline.sync();
  timeline.with({ label: 'first', toolUse: 'tool-1' }).pendingSet();
  timeline.with({ label: 'second', toolUse: 'tool-2' }).pendingSet();
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'changed\n');

  assert.equal(timeline.with({ toolUse: 'tool-1' }).flush().length, 1);
  assert.equal(timeline.with({ toolUse: 'tool-1' }).clearPending(), 0);
  assert.equal(timeline.with({ toolUse: 'tool-2' }).clearPending(), 1);
});

test('separate sessions do not overwrite each other', (t) => {
  const repo = repository();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const first = new Timeline({ repo, session: 'one' });
  const second = new Timeline({ repo, session: 'two' });
  assert.notEqual(first.start(), second.start());
  assert.equal(first.list()[0].sequence, 0);
  assert.equal(second.list()[0].sequence, 0);
  assert.equal(first.sessions().length, 2);
});
