# Timeline

Timeline turns any Git repository into a visual, searchable history in your browser. Install the npm package, run one command inside a codebase, and inspect every commit and recorded coding-agent change without touching your branch, `HEAD`, worktree, or staging area.

```sh
npm install --global @ketiyohannes/timeline
cd your-codebase
timeline
```

Timeline synchronizes the repository, starts a server bound to `127.0.0.1`, and opens the local browser at `http://127.0.0.1:4177`.

## Requirements

- Node.js 18 or newer
- Git 2.20 or newer
- A modern web browser

There are no runtime npm dependencies and no editor integration to configure.

## Run without a global install

Once the package is published, you can open a repository directly with:

```sh
cd your-codebase
npx @ketiyohannes/timeline
```

During local development:

```sh
git clone https://github.com/ketiyohannes/timeline-npm.git
cd timeline-npm
npm link

cd /path/to/your-codebase
timeline
```

Use another repository, port, or host explicitly:

```sh
timeline --repo /path/to/codebase
timeline --port 4400
timeline --host 127.0.0.1 --no-open
```

`--no-open` starts the server without launching a browser. This is useful in containers and remote development environments.

## What the browser shows

- Every reachable Git commit in chronological order
- Future Codex tool changes as individual timeline events
- The complete repository tree at each event
- Full source files with event-local additions and deletions in context
- Commit and file filtering
- Live updates while the browser remains open

The visual browser is served entirely from the installed npm package. It does not send repository contents to a remote service.

## Automatic Codex recording

Existing commits appear immediately. To record future Codex edits at tool-call granularity, install the lifecycle hooks once:

```sh
timeline hooks install
```

Then open `/hooks` in the Codex CLI and review and approve the six commands ending in `timeline-hook`. Restart Codex after approval.

Timeline preserves unrelated hook handlers and creates a timestamped backup whenever it changes `~/.codex/hooks.json`.

Remove only Timeline's handlers with:

```sh
timeline hooks uninstall
```

## Recorder and diagnostic commands

The browser is the default command. Lower-level commands remain available for scripts and diagnostics:

```sh
timeline sync --repo .
timeline status --repo .
timeline sessions --repo .
timeline list --repo . --session project
timeline list --repo . --session project --json
timeline diff 3 --repo . --session project
timeline files 3 --repo . --session project
timeline context 3 --repo . --session project
timeline disable --repo .
timeline enable --repo .
```

## Node.js API

```js
const {
  Timeline,
  createTimelineServer,
} = require('@ketiyohannes/timeline');

const timeline = new Timeline({ repo: process.cwd(), session: 'project' });

timeline.sync();
console.log(timeline.list());

const server = createTimelineServer({ repo: process.cwd(), port: 0 });

server.ready.then(({ url }) => {
  console.log(`Timeline: ${url}`);
});
```

## Storage and safety

Timeline stores snapshots as commits reachable only through `refs/codex-timeline/*`. It builds snapshots using a temporary `GIT_INDEX_FILE`, then advances the hidden ref with `git update-ref`.

It does not:

- checkout commits;
- change the current branch or `HEAD`;
- modify the normal Git index;
- push Timeline refs with a normal `git push`; or
- upload source code to the browser or any external service.

Ignored files are excluded. Untracked, modified, and deleted non-ignored files are included in snapshots.

## Development

```sh
npm test
npm run check
```

The suite verifies Git-state isolation, history import, ordered checkpoints, hook compatibility, HTTP APIs, browser assets, and the packed npm artifact.

## License

MIT
