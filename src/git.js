'use strict';

const { spawnSync } = require('node:child_process');

class TimelineError extends Error {
  constructor(message, code = 'TIMELINE_ERROR', cause) {
    super(message);
    this.name = 'TimelineError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

function git(repo, args, options = {}) {
  const result = spawnSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    input: options.input,
    env: { ...process.env, ...options.env },
    maxBuffer: options.maxBuffer || 64 * 1024 * 1024,
  });

  if (result.error) {
    throw new TimelineError(`unable to run Git: ${result.error.message}`, 'GIT_UNAVAILABLE', result.error);
  }
  if (result.status !== 0 && !options.allowFailure) {
    const detail = (result.stderr || result.stdout || `exit ${result.status}`).trim();
    throw new TimelineError(`git ${args[0]} failed: ${detail}`, 'GIT_FAILED');
  }
  return {
    ok: result.status === 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function repositoryRoot(input) {
  const result = git(input, ['rev-parse', '--show-toplevel'], { allowFailure: true });
  if (!result.ok) {
    throw new TimelineError(`not inside a Git repository: ${input}`, 'NOT_A_REPOSITORY');
  }
  return result.stdout.trim();
}

function sanitize(value, fallback = 'default') {
  const safe = String(value || fallback)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return safe || fallback;
}

function oneLine(value) {
  return String(value || '').replace(/[\r\n]/g, ' ').slice(0, 160);
}

module.exports = { git, repositoryRoot, sanitize, oneLine, TimelineError };
