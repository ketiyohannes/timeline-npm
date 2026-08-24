'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { git, repositoryRoot, sanitize, oneLine, TimelineError } = require('./git');

const sleepArray = new Int32Array(new SharedArrayBuffer(4));

function sleep(milliseconds) {
  Atomics.wait(sleepArray, 0, 0, milliseconds);
}

function metadata(message) {
  const context = {};
  for (const line of message.split(/\r?\n/)) {
    const match = /^(?:Timeline|Codex-Timeline)-([^:]+):\s*(.*)$/.exec(line);
    if (match) context[match[1].toLowerCase().replace(/-/g, '_')] = match[2];
  }
  return context;
}

class Timeline {
  constructor(options = {}) {
    this.options = {
      repo: options.repo || process.cwd(),
      session: options.session || 'default',
      codexSession: options.codexSession || '',
      label: options.label || '',
      event: options.event || '',
      tool: options.tool || '',
      turn: options.turn || '',
      toolUse: options.toolUse || '',
    };
    this.repo = repositoryRoot(this.options.repo);
    this.gitDir = git(this.repo, ['rev-parse', '--absolute-git-dir']).stdout.trim();
    this.session = sanitize(this.options.session);
    this.safeSession = `session-${this.session}`;
    this.ref = `refs/codex-timeline/${this.safeSession}`;
    this.stateDir = path.join(this.gitDir, 'codex-timeline', this.safeSession);
    this.pendingDir = path.join(this.stateDir, 'pending');
    this.lockDir = path.join(this.gitDir, 'codex-timeline', 'locks', this.safeSession);
  }

  with(overrides) {
    return new Timeline({ ...this.options, ...overrides, repo: this.repo });
  }

  hasRef() {
    return git(this.repo, ['show-ref', '--verify', '--quiet', this.ref], { allowFailure: true }).ok;
  }

  withLock(callback) {
    fs.mkdirSync(path.dirname(this.lockDir), { recursive: true });
    let owned = false;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        fs.mkdirSync(this.lockDir);
        fs.writeFileSync(path.join(this.lockDir, 'pid'), `${process.pid}\n`);
        owned = true;
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const pid = Number.parseInt(readFirstLine(path.join(this.lockDir, 'pid')), 10);
        if (Number.isInteger(pid) && !processExists(pid)) {
          fs.rmSync(path.join(this.lockDir, 'pid'), { force: true });
          try { fs.rmdirSync(this.lockDir); } catch {}
          continue;
        }
        sleep(25);
      }
    }
    if (!owned) throw new TimelineError(`timed out waiting for session lock: ${this.session}`, 'LOCK_TIMEOUT');
    try {
      return callback();
    } finally {
      fs.rmSync(path.join(this.lockDir, 'pid'), { force: true });
      try { fs.rmdirSync(this.lockDir); } catch {}
    }
  }

  snapshotTree() {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-'));
    const index = path.join(temporary, 'index');
    const env = { GIT_INDEX_FILE: index };
    try {
      git(this.repo, ['read-tree', '--empty'], { env });
      git(this.repo, ['add', '-A', '--', '.'], { env });
      return git(this.repo, ['write-tree'], { env }).stdout.trim();
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }

  makeCommit(tree, parent, subject, sequence) {
    const message = [
      `timeline: ${oneLine(subject)}`,
      '',
      `Timeline-Session: ${oneLine(this.options.codexSession || this.session)}`,
      `Timeline-Ref: ${this.safeSession}`,
      `Timeline-Sequence: ${sequence}`,
      `Timeline-Event: ${oneLine(this.options.event || 'checkpoint')}`,
      `Timeline-Tool: ${oneLine(this.options.tool || 'unknown')}`,
      `Timeline-Turn: ${oneLine(this.options.turn || 'unknown')}`,
      `Timeline-Tool-Use: ${oneLine(this.options.toolUse || 'unknown')}`,
    ].join('\n');
    const args = ['commit-tree', tree];
    if (parent) args.push('-p', parent);
    return git(this.repo, args, {
      input: `${message}\n`,
      env: {
        GIT_AUTHOR_NAME: 'Timeline',
        GIT_AUTHOR_EMAIL: 'timeline@local',
        GIT_COMMITTER_NAME: 'Timeline',
        GIT_COMMITTER_EMAIL: 'timeline@local',
      },
    }).stdout.trim();
  }

  start() {
    return this.withLock(() => this.startUnlocked());
  }

  sync() {
    const synced = this.with({
      session: 'project',
      label: this.options.label || 'existing project baseline',
      event: this.options.event || 'manual-sync',
    });
    return synced.start();
  }

  startUnlocked() {
    if (this.hasRef()) {
      const existing = git(this.repo, ['rev-parse', this.ref]).stdout.trim();
      const count = Number.parseInt(git(this.repo, ['rev-list', '--count', this.ref]).stdout, 10);
      if (this.safeSession === 'session-project' && count === 1) {
        const first = git(this.repo, ['rev-list', '--reverse', this.ref]).stdout.trim().split('\n')[0];
        const message = git(this.repo, ['show', '-s', '--format=%B', first]).stdout;
        if (metadata(message).sequence === '0') {
          const headResult = git(this.repo, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true });
          if (headResult.ok) {
            const head = headResult.stdout.trim();
            const tree = this.snapshotTree();
            const headTree = git(this.repo, ['show', '-s', '--format=%T', head]).stdout.trim();
            const migrated = tree === headTree
              ? head
              : this.makeCommit(
                tree,
                head,
                this.options.label || 'existing project baseline',
                Number.parseInt(git(this.repo, ['rev-list', '--count', head]).stdout, 10) + 1,
              );
            git(this.repo, ['update-ref', this.ref, migrated, existing]);
            return migrated;
          }
        }
      }
      return existing;
    }

    const tree = this.snapshotTree();
    const headResult = git(this.repo, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true });
    const head = headResult.ok ? headResult.stdout.trim() : '';
    let commit;
    if (this.safeSession === 'session-project' && head) {
      const headTree = git(this.repo, ['show', '-s', '--format=%T', head]).stdout.trim();
      if (tree === headTree) {
        commit = head;
      } else {
        const count = Number.parseInt(git(this.repo, ['rev-list', '--count', head]).stdout, 10);
        commit = this.makeCommit(tree, head, this.options.label || 'existing project baseline', count + 1);
      }
    } else {
      commit = this.makeCommit(tree, '', this.options.label || 'baseline', 0);
    }
    git(this.repo, ['update-ref', this.ref, commit]);
    fs.mkdirSync(this.stateDir, { recursive: true });
    return commit;
  }

  checkpoint() {
    return this.withLock(() => this.checkpointUnlocked());
  }

  checkpointUnlocked() {
    if (!this.hasRef()) {
      this.startUnlocked();
      return null;
    }
    const parent = git(this.repo, ['rev-parse', this.ref]).stdout.trim();
    const previousTree = git(this.repo, ['show', '-s', '--format=%T', parent]).stdout.trim();
    const tree = this.snapshotTree();
    if (tree === previousTree) return null;

    const message = git(this.repo, ['show', '-s', '--format=%B', parent]).stdout;
    const last = metadata(message).sequence;
    const sequence = /^\d+$/.test(last || '')
      ? Number.parseInt(last, 10) + 1
      : Number.parseInt(git(this.repo, ['rev-list', '--count', this.ref]).stdout, 10) + 1;
    const commit = this.makeCommit(tree, parent, this.options.label || `change #${sequence}`, sequence);
    git(this.repo, ['update-ref', this.ref, commit, parent]);
    return commit;
  }

  pendingPath(toolUse = this.options.toolUse) {
    return path.join(this.pendingDir, sanitize(toolUse || 'default'));
  }

  pendingSet() {
    return this.withLock(() => {
      fs.mkdirSync(this.pendingDir, { recursive: true });
      const file = this.pendingPath();
      const values = [
        this.options.label || 'Codex tool', this.options.event, this.options.tool,
        this.options.turn, this.options.toolUse, this.options.codexSession || this.session,
      ].map(oneLine);
      fs.writeFileSync(file, `${values.join('\n')}\n`, { mode: 0o600 });
      return file;
    });
  }

  pendingFiles(all) {
    if (!all && this.options.toolUse) return [this.pendingPath()];
    if (!fs.existsSync(this.pendingDir)) return [];
    return fs.readdirSync(this.pendingDir).sort().map((name) => path.join(this.pendingDir, name));
  }

  flush(options = {}) {
    return this.withLock(() => {
      const commits = [];
      const all = options.all === undefined ? !this.options.toolUse : options.all;
      for (const file of this.pendingFiles(all)) {
        if (!fs.existsSync(file)) continue;
        const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
        const pendingSession = lines[5] || '';
        if (this.options.codexSession && pendingSession !== this.options.codexSession) continue;
        const pending = this.with({
          label: lines[0] || 'Codex tool', event: lines[1] || '', tool: lines[2] || '',
          turn: lines[3] || '', toolUse: lines[4] || '', codexSession: pendingSession,
        });
        const commit = pending.checkpointUnlocked();
        if (commit) commits.push(commit);
        fs.rmSync(file, { force: true });
      }
      try { fs.rmdirSync(this.pendingDir); } catch {}
      return commits;
    });
  }

  clearPending(options = {}) {
    return this.withLock(() => {
      let count = 0;
      const all = options.all === undefined ? !this.options.toolUse : options.all;
      for (const file of this.pendingFiles(all)) {
        if (fs.existsSync(file)) {
          fs.rmSync(file, { force: true });
          count += 1;
        }
      }
      try { fs.rmdirSync(this.pendingDir); } catch {}
      return count;
    });
  }

  enable() {
    git(this.repo, ['config', '--local', 'codex.timeline.enabled', 'true']);
    return 'enabled';
  }

  disable() {
    git(this.repo, ['config', '--local', 'codex.timeline.enabled', 'false']);
    return 'disabled';
  }

  status() {
    const result = git(this.repo, ['config', '--bool', '--get', 'codex.timeline.enabled'], { allowFailure: true });
    return result.ok && result.stdout.trim() === 'false' ? 'disabled' : 'enabled';
  }

  sessions() {
    const output = git(this.repo, [
      'for-each-ref', '--sort=-committerdate',
      '--format=%(refname)%09%(committerdate:iso-strict)%09%(subject)', 'refs/codex-timeline/',
    ]).stdout;
    return output.trim() ? output.trimEnd().split('\n').map((line) => {
      const [ref, date, ...subject] = line.split('\t');
      return { ref, date, subject: subject.join('\t') };
    }) : [];
  }

  latest() {
    return this.sessions()[0]?.ref || null;
  }

  assertRef() {
    if (!this.hasRef()) throw new TimelineError(`timeline does not exist: ${this.session}`, 'TIMELINE_NOT_FOUND');
  }

  list() {
    this.assertRef();
    const format = '%H%x09%P%x09%aI%x09%B%x00';
    const output = git(this.repo, ['log', '--reverse', '--topo-order', `--format=${format}`, this.ref]).stdout;
    return output.split('\0').map((record) => record.trim()).filter(Boolean).map((record, index) => {
      const [header, ...body] = record.split('\n');
      const [hash, parentText, date, ...subject] = header.split('\t');
      const context = metadata(body.join('\n'));
      const sequence = /^\d+$/.test(context.sequence || '') ? Number.parseInt(context.sequence, 10) : index + 1;
      return { hash, parents: parentText ? parentText.split(' ') : [], date, subject: subject.join('\t'), sequence, context };
    });
  }

  resolveSequence(sequence) {
    const wanted = Number(sequence);
    if (!Number.isInteger(wanted) || wanted < 0) {
      throw new TimelineError('sequence must be a non-negative integer', 'INVALID_SEQUENCE');
    }
    const event = this.list().find((candidate) => candidate.sequence === wanted);
    if (!event) throw new TimelineError(`unknown sequence: ${sequence}`, 'UNKNOWN_SEQUENCE');
    return event;
  }

  diff(sequence) {
    const event = this.resolveSequence(sequence);
    return event.parents.length
      ? git(this.repo, ['diff', '--no-ext-diff', '--minimal', event.parents[0], event.hash, '--']).stdout
      : git(this.repo, ['show', '--format=', '--no-ext-diff', event.hash, '--']).stdout;
  }

  files(sequence) {
    const event = this.resolveSequence(sequence);
    const output = event.parents.length
      ? git(this.repo, ['diff', '--name-only', event.parents[0], event.hash, '--']).stdout
      : git(this.repo, ['show', '--format=', '--name-only', event.hash, '--']).stdout;
    return output.trim() ? output.trimEnd().split('\n') : [];
  }

  tree(sequence) {
    const event = this.resolveSequence(sequence);
    const output = git(this.repo, ['ls-tree', '-r', '--name-only', '-z', event.hash]).stdout;
    return output.split('\0').filter(Boolean);
  }

  changes(sequence) {
    const event = this.resolveSequence(sequence);
    if (!event.parents.length) {
      if (event.sequence === 0) return [];
      return this.tree(sequence).map((filePath) => ({ path: filePath, status: 'A' }));
    }
    const output = git(this.repo, [
      'diff', '--name-status', '-M', event.parents[0], event.hash, '--',
    ]).stdout;
    if (!output.trim()) return [];
    return output.trimEnd().split('\n').map((line) => {
      const [rawStatus, firstPath, secondPath] = line.split('\t');
      const status = rawStatus.slice(0, 1);
      if ((status === 'R' || status === 'C') && secondPath) {
        return { path: secondPath, oldPath: firstPath, status };
      }
      return { path: firstPath, status };
    });
  }

  fileSnapshot(sequence, filePath) {
    const event = this.resolveSequence(sequence);
    const tree = this.tree(sequence);
    const changes = this.changes(sequence);
    const change = changes.find((item) => item.path === filePath || item.oldPath === filePath);
    if (!tree.includes(filePath) && !change) {
      throw new TimelineError(`file does not exist at sequence ${sequence}: ${filePath}`, 'FILE_NOT_FOUND');
    }

    if (!change) {
      const content = git(this.repo, ['show', `${event.hash}:${filePath}`]).stdout;
      if (content.includes('\0')) return { path: filePath, status: '', binary: true, lines: [] };
      return {
        path: filePath,
        status: '',
        binary: false,
        lines: content.replace(/\n$/, '').split('\n').map((text, index) => ({
          text, kind: 'context', oldLine: index + 1, newLine: index + 1,
        })),
      };
    }

    const displayPath = change.status === 'D' ? change.path : filePath;
    const args = event.parents.length
      ? ['diff', '--no-color', '--no-ext-diff', '--minimal', '--unified=999999', event.parents[0], event.hash, '--', displayPath]
      : ['show', '--format=', '--no-color', '--no-ext-diff', '--minimal', '--unified=999999', event.hash, '--', displayPath];
    const patch = git(this.repo, args).stdout;
    const lines = parseFullDiff(patch);
    return {
      path: displayPath,
      status: change.status,
      binary: lines.length === 0 && /Binary files|GIT binary patch/.test(patch),
      lines,
    };
  }

  context(sequence) {
    const message = this.message(sequence);
    return { subject: message.split(/\r?\n/, 1)[0], ...metadata(message) };
  }

  message(sequence) {
    const event = this.resolveSequence(sequence);
    return git(this.repo, ['show', '-s', '--format=%B', event.hash]).stdout;
  }
}

function parseFullDiff(patch) {
  const result = [];
  let oldLine = 0;
  let newLine = 0;
  let insideHunk = false;
  for (const line of patch.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldLine = Number.parseInt(hunk[1], 10);
      newLine = Number.parseInt(hunk[2], 10);
      insideHunk = true;
      continue;
    }
    if (!insideHunk || line === '\\ No newline at end of file') continue;
    if (line.startsWith('+')) {
      result.push({ text: line.slice(1), kind: 'add', oldLine: null, newLine });
      newLine += 1;
    } else if (line.startsWith('-')) {
      result.push({ text: line.slice(1), kind: 'delete', oldLine, newLine: null });
      oldLine += 1;
    } else if (line.startsWith(' ')) {
      result.push({ text: line.slice(1), kind: 'context', oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    }
  }
  return result;
}

function readFirstLine(file) {
  try { return fs.readFileSync(file, 'utf8').split(/\r?\n/, 1)[0]; } catch { return ''; }
}

function processExists(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

module.exports = { Timeline, TimelineError };
