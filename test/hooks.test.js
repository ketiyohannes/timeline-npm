'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { installHooks, uninstallHooks } = require('..');

test('hook installer preserves unrelated handlers and is idempotent', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-hooks-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, 'hooks.json');
  const unrelated = { hooks: [{ type: 'command', command: 'keep-me' }] };
  fs.writeFileSync(configPath, `${JSON.stringify({ hooks: { Stop: [unrelated] } })}\n`);

  installHooks({ configPath, adapterPath: '/tmp/timeline hook' });
  installHooks({ configPath, adapterPath: '/tmp/timeline hook' });
  const installed = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  assert.equal(installed.hooks.Stop.length, 2);
  assert.deepEqual(installed.hooks.Stop[0], unrelated);
  assert.match(installed.hooks.Stop[1].hooks[0].command, /^'\/tmp\/timeline hook' 'Stop' # timeline$/);
  assert.equal(Object.keys(installed.hooks).length, 6);

  uninstallHooks({ configPath });
  const removed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.deepEqual(removed.hooks, { Stop: [unrelated] });
});
