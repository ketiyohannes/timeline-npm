# Timeline for npm

Timeline is a Git-backed time machine for repositories changed by Codex and other coding agents. This package records complete worktree snapshots on isolated Git refs, exposes them through a Node.js API and CLI, and includes the same three-pane Neovim browser as the original Lua project.

Normal branches, `HEAD`, the worktree, and the staging area are never changed. Existing Timeline data remains compatible: both implementations use `refs/codex-timeline/` and `.git/codex-timeline/`.

## Requirements

- Node.js 18 or newer
- Git 2.20 or newer
- Neovim 0.10 or newer for the optional UI
- Codex with lifecycle-hook support for automatic recording

## Install

Install the CLI globally:

```sh
npm install --global @ketiyohannes/timeline
```

Or add the library to a project:

```sh
npm install @ketiyohannes/timeline
```

Install the Codex lifecycle hooks:

```sh
timeline hooks install
```

The installer merges six Timeline handlers into `~/.codex/hooks.json`, preserves unrelated hooks, and creates a timestamped backup. Open `/hooks` in the Codex CLI and trust the six commands ending in `timeline-hook`; installed hooks do not execute until they are approved.

Install the bundled Neovim runtime:

```sh
timeline nvim install
```

This copies the package into Neovim's native `pack/*/start/*` directory. Restart Neovim, run `:checkhealth timeline`, and open the browser with `:Timeline`.

You can also install directly from the repository with lazy.nvim:

```lua
{
  "ketiyohannes/timeline-npm",
  name = "timeline",
  lazy = false,
  config = function()
    require("timeline").setup()
  end,
}
```

## CLI

```sh
timeline status --repo .
timeline sync --repo .
timeline sessions --repo .
timeline list --repo . --session project
timeline list --repo . --session project --json
timeline diff 3 --repo . --session project
timeline files 3 --repo . --session project
timeline context 3 --repo . --session project
timeline disable --repo .
```

Run `timeline --help` for every command and option.

## Node.js API

```js
const { Timeline } = require('@ketiyohannes/timeline');

const timeline = new Timeline({ repo: process.cwd(), session: 'project' });

timeline.sync();
timeline.checkpoint();

for (const event of timeline.list()) {
  console.log(event.sequence, event.subject, event.hash);
}

console.log(timeline.files(2));
console.log(timeline.diff(2));
```

Hook and Neovim installers are also exported:

```js
const {
  installHooks,
  uninstallHooks,
  installNeovim,
  uninstallNeovim,
} = require('@ketiyohannes/timeline');
```

## Neovim

The package retains the original commands and navigation:

- `:Timeline` opens the chronological three-pane browser.
- `:TimelineSync` imports existing commits and local state.
- `:TimelineAnnotate` shows which event introduced each line.
- `:TimelineSession` selects a recorded timeline.
- `:TimelineInstallHooks` and `:TimelineUninstallHooks` manage Codex hooks.
- `]t` and `[t` move between annotated lines.

Commit, file, and source search; complete historical file reconstruction; live refresh; diff highlighting; and legacy `:CodexTimeline*` aliases are included.

## Storage and safety

Timeline snapshots are commits reachable only from `refs/codex-timeline/*`. It builds each snapshot using a temporary `GIT_INDEX_FILE`, then advances its hidden ref with `git update-ref`. Normal pushes do not include these refs.

Ignored files are excluded. Untracked, modified, and deleted non-ignored files are included in snapshots.

## Uninstall

```sh
timeline hooks uninstall
timeline nvim uninstall
npm uninstall --global @ketiyohannes/timeline
```

Recorded refs are intentionally retained. Delete one explicitly if desired:

```sh
git update-ref -d refs/codex-timeline/session-project
```

## Development

```sh
npm test
npm run check
```

## License

MIT
