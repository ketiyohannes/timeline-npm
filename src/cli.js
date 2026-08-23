'use strict';

const { Timeline, TimelineError } = require('./timeline');
const { installHooks, uninstallHooks } = require('./hooks');
const { installNeovim, uninstallNeovim } = require('./nvim');

const HELP = `Usage: timeline <command> [options]

Recorder commands:
  sync              Import existing commits and current project state
  start             Create a baseline for a session
  checkpoint        Record the worktree if it changed
  list              Print events as TSV (or structured JSON with --json)
  diff <sequence>   Print the patch introduced by an event
  files <sequence>  Print files changed by an event
  context <sequence> Print stored coding-agent context
  pending-set       Remember the next checkpoint label
  flush             Checkpoint pending tools
  clear-pending     Forget pending tools
  enable|disable    Change repository recording status
  status            Print effective status
  sessions|latest   Inspect recorded timeline refs

Setup commands:
  hooks install [--config <path>]
  hooks uninstall [--config <path>]
  nvim install [--target <path>]
  nvim uninstall [--target <path>]

Options:
  --repo <path>        Repository (default: current directory)
  --session <id>       Timeline session (default: default)
  --codex-session <id> Codex task/session context
  --label <text>       Human-readable event label
  --event <name>       Lifecycle event name
  --tool <name>        Tool name
  --turn <id>          Turn id
  --tool-use <id>      Tool invocation id
  --json               Emit JSON when supported
`;

function parse(argv) {
  const values = { _: [] };
  const names = {
    '--repo': 'repo', '--session': 'session', '--codex-session': 'codexSession', '--label': 'label',
    '--event': 'event', '--tool': 'tool', '--turn': 'turn', '--tool-use': 'toolUse',
    '--config': 'configPath', '--target': 'target',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--json') values.json = true;
    else if (value === '-h' || value === '--help') values.help = true;
    else if (names[value]) {
      if (argv[index + 1] === undefined) throw new TimelineError(`missing value for ${value}`, 'INVALID_ARGUMENT');
      values[names[value]] = argv[index + 1];
      index += 1;
    } else if (value.startsWith('--')) throw new TimelineError(`unknown option: ${value}`, 'INVALID_ARGUMENT');
    else values._.push(value);
  }
  return values;
}

function write(value) {
  if (value !== undefined && value !== null && value !== '') process.stdout.write(`${value}\n`);
}

function run(argv = process.argv.slice(2)) {
  const args = parse(argv);
  if (args.help || args._.length === 0 || args._[0] === 'help') {
    process.stdout.write(HELP);
    return 0;
  }
  const [command, operand] = args._;

  if (command === 'hooks') {
    const result = operand === 'install' ? installHooks(args)
      : operand === 'uninstall' ? uninstallHooks(args)
        : null;
    if (!result) throw new TimelineError('hooks requires install or uninstall', 'INVALID_ARGUMENT');
    write(`${result.action === 'installed' ? 'Installed' : 'Removed'} Timeline hooks ${result.action === 'installed' ? 'in' : 'from'} ${result.configPath}`);
    if (result.backupPath) write(`Backup: ${result.backupPath}`);
    return 0;
  }

  if (command === 'nvim') {
    const result = operand === 'install' ? installNeovim(args)
      : operand === 'uninstall' ? uninstallNeovim(args)
        : null;
    if (!result) throw new TimelineError('nvim requires install or uninstall', 'INVALID_ARGUMENT');
    write(`${result.action === 'installed' ? 'Installed' : 'Removed'} Timeline Neovim runtime ${result.action === 'installed' ? 'at' : 'from'} ${result.target}`);
    return 0;
  }

  if (args._.length > (['diff', 'files', 'context'].includes(command) ? 2 : 1)) {
    throw new TimelineError(`unexpected argument: ${args._.at(-1)}`, 'INVALID_ARGUMENT');
  }
  const timeline = new Timeline(args);
  let result;
  switch (command) {
    case 'sync': result = timeline.sync(); break;
    case 'start': result = timeline.start(); break;
    case 'checkpoint': result = timeline.checkpoint(); break;
    case 'pending-set': result = timeline.pendingSet(); break;
    case 'flush': result = timeline.flush(); break;
    case 'clear-pending': result = timeline.clearPending(); break;
    case 'enable': result = timeline.enable(); break;
    case 'disable': result = timeline.disable(); break;
    case 'status': result = timeline.status(); break;
    case 'latest': result = timeline.latest(); break;
    case 'sessions': result = timeline.sessions(); break;
    case 'list': result = timeline.list(); break;
    case 'diff': result = timeline.diff(operand); break;
    case 'files': result = timeline.files(operand); break;
    case 'context': result = args.json ? timeline.context(operand) : timeline.message(operand); break;
    default: throw new TimelineError(`unknown command: ${command}`, 'INVALID_ARGUMENT');
  }

  if (args.json) {
    write(JSON.stringify(result, null, 2));
  } else if (command === 'sessions') {
    for (const item of result) write(`${item.ref}\t${item.date}\t${item.subject}`);
  } else if (command === 'list') {
    for (const item of result) write(`${item.hash}\t${item.parents.join(' ')}\t${item.date}\t${item.subject}`);
  } else if (command === 'files') {
    for (const file of result) write(file);
  } else if (Array.isArray(result)) {
    for (const value of result) write(value);
  } else {
    write(result);
  }
  return 0;
}

module.exports = { HELP, parse, run };
