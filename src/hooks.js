'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd'];
const MARKERS = ['# timeline', '# codex-timeline'];

function defaultConfigPath() {
  return path.join(os.homedir(), '.codex', 'hooks.json');
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function readConfig(configPath) {
  if (!fs.existsSync(configPath)) return {};
  const value = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new TypeError(`${configPath} must contain a JSON object`);
  }
  return value;
}

function isOurs(group) {
  return Boolean(group && Array.isArray(group.hooks) && group.hooks.some((handler) =>
    handler && MARKERS.some((marker) => String(handler.command || '').includes(marker))));
}

function removeExisting(config) {
  if (config.hooks === undefined) config.hooks = {};
  if (!config.hooks || Array.isArray(config.hooks) || typeof config.hooks !== 'object') {
    throw new TypeError("the top-level 'hooks' value must be a JSON object");
  }
  for (const event of Object.keys(config.hooks)) {
    const groups = config.hooks[event];
    if (!Array.isArray(groups)) continue;
    config.hooks[event] = groups.filter((group) => !isOurs(group));
    if (config.hooks[event].length === 0) delete config.hooks[event];
  }
}

function writeAtomic(configPath, config) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  let backupPath = null;
  if (fs.existsSync(configPath)) {
    const stamp = new Date().toISOString().replace(/[-:.]/g, '').replace('Z', 'Z');
    backupPath = `${configPath}.backup-${stamp}`;
    fs.copyFileSync(configPath, backupPath);
  }
  const temporary = path.join(path.dirname(configPath), `.${path.basename(configPath)}.${process.pid}.${Date.now()}`);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, configPath);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  return backupPath;
}

function updateHooks({ configPath = defaultConfigPath(), adapterPath, uninstall = false } = {}) {
  const resolved = path.resolve(configPath);
  const config = readConfig(resolved);
  removeExisting(config);
  if (!uninstall) {
    const adapter = path.resolve(adapterPath || path.join(__dirname, '..', 'bin', 'timeline-hook'));
    for (const event of EVENTS) {
      const command = `${shellQuote(adapter)} ${shellQuote(event)} # timeline`;
      if (!config.hooks[event]) config.hooks[event] = [];
      config.hooks[event].push({ hooks: [{ type: 'command', command, timeout: 30 }] });
    }
  }
  const backupPath = writeAtomic(resolved, config);
  return { configPath: resolved, backupPath, action: uninstall ? 'uninstalled' : 'installed' };
}

function installHooks(options = {}) {
  return updateHooks({ ...options, uninstall: false });
}

function uninstallHooks(options = {}) {
  return updateHooks({ ...options, uninstall: true });
}

module.exports = { EVENTS, installHooks, uninstallHooks, defaultConfigPath };
