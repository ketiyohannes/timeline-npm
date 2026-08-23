'use strict';

const { Timeline, TimelineError } = require('./src/timeline');
const { installHooks, uninstallHooks } = require('./src/hooks');
const { installNeovim, uninstallNeovim, defaultNeovimTarget } = require('./src/nvim');

module.exports = {
  Timeline,
  TimelineError,
  installHooks,
  uninstallHooks,
  installNeovim,
  uninstallNeovim,
  defaultNeovimTarget,
};
