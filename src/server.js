'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Timeline, TimelineError } = require('./timeline');
const { git } = require('./git');

const WEB_ROOT = path.resolve(__dirname, '..', 'web');
const ASSETS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);

function json(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

function publicEvent(event) {
  return {
    hash: event.hash,
    date: event.date,
    subject: event.subject.replace(/^timeline:\s*/, '').replace(/^codex-timeline:\s*/, ''),
    sequence: event.sequence,
    context: event.context,
  };
}

function createTimelineServer(options = {}) {
  const session = options.session || 'project';
  const timeline = new Timeline({ ...options, session });
  if (session === 'project') timeline.sync();
  else timeline.start();

  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    try {
      if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed' });
      if (ASSETS.has(url.pathname)) {
        const [file, contentType] = ASSETS.get(url.pathname);
        response.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': 'no-cache',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'",
        });
        return fs.createReadStream(path.join(WEB_ROOT, file)).pipe(response);
      }
      if (url.pathname === '/api/timeline') {
        const branch = git(timeline.repo, ['branch', '--show-current']).stdout.trim() || 'detached';
        const events = timeline.list().map(publicEvent);
        return json(response, 200, {
          repository: { name: path.basename(timeline.repo), path: timeline.repo, branch },
          session,
          ref: timeline.ref,
          events,
        });
      }
      const eventMatch = /^\/api\/events\/(\d+)$/.exec(url.pathname);
      if (eventMatch) {
        const sequence = Number(eventMatch[1]);
        const event = publicEvent(timeline.resolveSequence(sequence));
        const changes = timeline.changes(sequence);
        const changeByPath = new Map(changes.map((change) => [change.path, change]));
        const files = timeline.tree(sequence).map((filePath) => ({
          path: filePath,
          status: changeByPath.get(filePath)?.status || '',
          oldPath: changeByPath.get(filePath)?.oldPath,
        }));
        for (const change of changes) {
          if (change.status === 'D' && !files.some((file) => file.path === change.path)) files.push(change);
        }
        files.sort((a, b) => a.path.localeCompare(b.path));
        return json(response, 200, { event, changes, files });
      }
      const fileMatch = /^\/api\/events\/(\d+)\/file$/.exec(url.pathname);
      if (fileMatch) {
        const filePath = url.searchParams.get('path');
        if (!filePath) return json(response, 400, { error: 'Missing path' });
        return json(response, 200, timeline.fileSnapshot(Number(fileMatch[1]), filePath));
      }
      return json(response, 404, { error: 'Not found' });
    } catch (error) {
      const status = error instanceof TimelineError && ['UNKNOWN_SEQUENCE', 'FILE_NOT_FOUND'].includes(error.code) ? 404 : 500;
      return json(response, status, { error: error.message, code: error.code || 'SERVER_ERROR' });
    }
  });

  const host = options.host || '127.0.0.1';
  const port = Number.isInteger(Number(options.port)) ? Number(options.port) : 4177;
  server.ready = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      const url = `http://${host}:${address.port}`;
      resolve({ url, timeline });
    });
  });
  return server;
}

function launchBrowser(url) {
  let command;
  let args;
  if (process.platform === 'darwin') {
    command = 'open'; args = [url];
  } else if (process.platform === 'win32') {
    command = 'cmd'; args = ['/c', 'start', '', url];
  } else {
    command = 'xdg-open'; args = [url];
  }
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.unref();
  child.on('error', () => {});
}

function openTimeline(options = {}) {
  const server = createTimelineServer(options);
  server.ready.then(({ url }) => {
    process.stdout.write(`Timeline is ready at ${url}\n`);
    process.stdout.write('Press Ctrl+C to stop.\n');
    if (options.open !== false) launchBrowser(url);
  }).catch((error) => {
    process.stderr.write(`timeline: ${error.message}\n`);
    process.exitCode = 1;
  });
  return server;
}

module.exports = { createTimelineServer, openTimeline };
