'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { CodexOverview } = require('../src/codex-overview');

test('Codex overview uses an existing login and caches structured output by event hash', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-codex-test-'));
  const repo = path.join(root, 'repo');
  const gitDir = path.join(repo, '.git');
  const executable = path.join(root, 'fake-codex');
  fs.mkdirSync(gitDir, { recursive: true });
  fs.writeFileSync(executable, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('codex-cli 1.0.0'); process.exit(0); }
if (args[0] === 'login') { console.log('Logged in using ChatGPT'); process.exit(0); }
const output = args[args.indexOf('--output-last-message') + 1];
process.stdin.resume();
process.stdin.on('end', () => {
  fs.writeFileSync(output, JSON.stringify({
    headline: 'Add regional pricing',
    summary: 'The pricing path now accounts for customer region.',
    impact: ['Regional totals can differ.'],
    risks: ['Unknown regions need a fallback.'],
    suggestedChecks: ['Test a supported and unsupported region.']
  }));
});
`);
  fs.chmodSync(executable, 0o755);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const provider = new CodexOverview({ repo, gitDir, codexPath: executable, timeoutMs: 5_000 });
  const status = await provider.status();
  assert.equal(status.available, true);
  assert.equal(status.authenticated, true);

  const event = { hash: 'a'.repeat(40), sequence: 4, subject: 'regional pricing' };
  const first = await provider.generate({
    event,
    changes: [{ status: 'M', path: 'pricing.js' }],
    diff: '-return total;\n+return regionalTotal;',
  });
  assert.equal(first.overview.headline, 'Add regional pricing');
  assert.equal(fs.existsSync(provider.cachePath(event.hash)), true);

  fs.rmSync(executable);
  const second = await provider.generate({ event, changes: [], diff: '' });
  assert.deepEqual(second, first);
});
