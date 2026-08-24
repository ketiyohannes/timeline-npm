'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const { createTimelineServer } = require('..');

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

function repository() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-server-'));
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.name', 'Timeline Test');
  git(repo, 'config', 'user.email', 'timeline-test@example.com');
  fs.writeFileSync(path.join(repo, 'app.js'), 'const answer = 1;\n');
  git(repo, 'add', 'app.js');
  git(repo, 'commit', '-m', 'create application');
  fs.writeFileSync(path.join(repo, 'app.js'), 'const answer = 2;\n');
  fs.writeFileSync(path.join(repo, 'README.md'), '# Demo\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'document the answer');
  return repo;
}

test('local browser server exposes timeline, event, file, and static assets', async (t) => {
  const repo = repository();
  const server = createTimelineServer({ repo, host: '127.0.0.1', port: 0, open: false });
  t.after(() => {
    server.close();
    fs.rmSync(repo, { recursive: true, force: true });
  });
  const { url } = await server.ready;

  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>Timeline<\/title>/);

  const timelineResponse = await fetch(`${url}/api/timeline`);
  assert.equal(timelineResponse.status, 200);
  const timeline = await timelineResponse.json();
  assert.equal(timeline.repository.name, path.basename(repo));
  assert.equal(timeline.repository.branch, 'main');
  assert.equal(timeline.events.length, 2);
  assert.equal(timeline.events[1].subject, 'document the answer');

  const event = await (await fetch(`${url}/api/events/2`)).json();
  assert.deepEqual(event.changes.map((change) => [change.path, change.status]), [
    ['README.md', 'A'],
    ['app.js', 'M'],
  ]);
  assert.ok(event.files.some((file) => file.path === 'app.js' && file.status === 'M'));

  const snapshot = await (await fetch(`${url}/api/events/2/file?path=app.js`)).json();
  assert.equal(snapshot.path, 'app.js');
  assert.ok(snapshot.lines.some((line) => line.kind === 'delete' && line.text.includes('1')));
  assert.ok(snapshot.lines.some((line) => line.kind === 'add' && line.text.includes('2')));

  const missing = await fetch(`${url}/api/events/2/file?path=package-lock.json`);
  assert.equal(missing.status, 404);
});

test('package manifest contains only the Node and browser runtime', () => {
  const manifest = require('../package.json');
  assert.deepEqual(manifest.files, [
    'bin', 'src', 'web', 'index.js', 'index.d.ts', 'LICENSE', 'README.md',
  ]);
  assert.deepEqual(Object.keys(manifest.scripts), ['test', 'test:compat', 'check']);
});

test('AI overview endpoint reports status, generates an explanation, and reuses cached results', async (t) => {
  const repo = repository();
  const generated = {
    version: 1,
    eventHash: git(repo, 'rev-parse', 'HEAD'),
    generatedAt: '2026-08-24T12:00:00.000Z',
    overview: {
      headline: 'Document the updated answer',
      summary: 'The answer changes and a README is added.',
      impact: ['Consumers now receive the new value.'],
      risks: [],
      suggestedChecks: ['Run the application test suite.'],
    },
  };
  let cached = null;
  let generationInput;
  const overviewProvider = {
    getCached: () => cached,
    status: async () => ({ available: true, authenticated: true, message: 'Logged in using ChatGPT' }),
    generate: async (input) => {
      generationInput = input;
      cached = generated;
      return generated;
    },
  };
  const server = createTimelineServer({ repo, host: '127.0.0.1', port: 0, open: false, overviewProvider });
  t.after(() => {
    server.close();
    fs.rmSync(repo, { recursive: true, force: true });
  });
  const { url } = await server.ready;

  const idle = await (await fetch(`${url}/api/events/2/overview`)).json();
  assert.equal(idle.status, 'idle');
  assert.equal(idle.codex.authenticated, true);

  const rejected = await fetch(`${url}/api/events/2/overview`, { method: 'POST' });
  assert.equal(rejected.status, 403);

  const response = await fetch(`${url}/api/events/2/overview`, {
    method: 'POST',
    headers: { 'X-Timeline-Request': 'ai-overview' },
  });
  assert.equal(response.status, 200);
  const ready = await response.json();
  assert.equal(ready.overview.headline, generated.overview.headline);
  assert.match(generationInput.diff, /const answer = 2/);
  assert.deepEqual(generationInput.changes.map((change) => change.path), ['README.md', 'app.js']);

  const cachedResponse = await (await fetch(`${url}/api/events/2/overview`)).json();
  assert.equal(cachedResponse.status, 'ready');
  assert.equal(cachedResponse.generatedAt, generated.generatedAt);
});
