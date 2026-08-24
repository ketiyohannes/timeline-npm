'use strict';

const { Timeline, TimelineError } = require('./src/timeline');
const { installHooks, uninstallHooks } = require('./src/hooks');
const { createTimelineServer, openTimeline } = require('./src/server');

module.exports = {
  Timeline,
  TimelineError,
  installHooks,
  uninstallHooks,
  createTimelineServer,
  openTimeline,
};
