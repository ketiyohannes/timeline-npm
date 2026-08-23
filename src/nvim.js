'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PACKAGE_NAME = '@ketiyohannes/timeline';
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const INSTALL_ENTRIES = ['bin', 'src', 'lua', 'plugin', 'doc', 'index.js', 'index.d.ts', 'package.json', 'LICENSE', 'README.md'];

function defaultNeovimTarget() {
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(dataHome, 'nvim', 'site', 'pack', 'timeline', 'start', 'timeline');
}

function isOurInstall(target) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'));
    return manifest.name === PACKAGE_NAME;
  } catch {
    return false;
  }
}

function installNeovim({ target = defaultNeovimTarget() } = {}) {
  const resolved = path.resolve(target);
  if (fs.existsSync(resolved) && !isOurInstall(resolved)) {
    throw new Error(`refusing to replace a directory not owned by ${PACKAGE_NAME}: ${resolved}`);
  }
  fs.mkdirSync(resolved, { recursive: true });
  for (const entry of INSTALL_ENTRIES) {
    const source = path.join(PACKAGE_ROOT, entry);
    if (fs.existsSync(source)) fs.cpSync(source, path.join(resolved, entry), { recursive: true, force: true });
  }
  for (const executable of ['timeline', 'timeline-hook', 'install-hooks', 'codex-timeline', 'codex-timeline-hook']) {
    fs.chmodSync(path.join(resolved, 'bin', executable), 0o755);
  }
  return { target: resolved, action: 'installed' };
}

function uninstallNeovim({ target = defaultNeovimTarget() } = {}) {
  const resolved = path.resolve(target);
  if (!fs.existsSync(resolved)) return { target: resolved, action: 'uninstalled' };
  if (!isOurInstall(resolved)) {
    throw new Error(`refusing to remove a directory not owned by ${PACKAGE_NAME}: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
  return { target: resolved, action: 'uninstalled' };
}

module.exports = { defaultNeovimTarget, installNeovim, uninstallNeovim };
