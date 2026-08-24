'use strict';

const state = {
  timeline: null,
  eventData: null,
  selectedSequence: null,
  selectedPath: null,
  eventQuery: '',
  fileQuery: '',
  latestHash: null,
  toastTimer: null,
};

const elements = Object.fromEntries([
  'repo-name', 'branch-name', 'repository-path', 'event-count', 'event-list', 'event-search',
  'event-number', 'file-count', 'file-list', 'file-search', 'change-summary', 'code-event',
  'code-title', 'code-context', 'code-stats', 'code-lines', 'empty-state', 'refresh-button', 'toast',
].map((id) => [id, document.getElementById(id)]));

async function requestJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function pad(value) { return String(value).padStart(3, '0'); }

function relativeTime(value) {
  const delta = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('visible');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => elements.toast.classList.remove('visible'), 3200);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderEventList() {
  const query = state.eventQuery.trim().toLowerCase();
  const events = (state.timeline?.events || []).filter((event) => {
    const searchable = `${event.sequence} ${event.subject} ${event.context.tool || ''}`.toLowerCase();
    return searchable.includes(query);
  }).slice().reverse();
  elements['event-list'].replaceChildren();
  elements['event-count'].textContent = String(events.length);

  for (const event of events) {
    const button = element('button', `event-item${event.sequence === state.selectedSequence ? ' selected' : ''}`);
    button.type = 'button';
    button.role = 'option';
    button.ariaSelected = event.sequence === state.selectedSequence ? 'true' : 'false';
    button.dataset.sequence = String(event.sequence);
    const dot = element('span', 'event-dot', String(event.sequence));
    const copy = element('span', 'event-copy');
    copy.append(element('span', 'event-subject', event.subject || 'Untitled change'));
    const meta = element('span', 'event-meta');
    meta.append(element('span', '', `#${pad(event.sequence)}`));
    meta.append(element('span', '', '·'));
    meta.append(element('span', '', relativeTime(event.date)));
    if (event.context.tool && event.context.tool !== 'unknown') {
      meta.append(element('span', '', '·'));
      meta.append(element('span', 'event-tool', event.context.tool));
    }
    copy.append(meta);
    button.append(dot, copy);
    button.addEventListener('click', () => selectEvent(event.sequence));
    elements['event-list'].append(button);
  }
}

function changeCounts(changes) {
  return changes.reduce((counts, change) => {
    if (change.status === 'A') counts.add += 1;
    else if (change.status === 'D') counts.delete += 1;
    else counts.modify += 1;
    return counts;
  }, { add: 0, modify: 0, delete: 0 });
}

function renderSummary() {
  const counts = changeCounts(state.eventData?.changes || []);
  elements['change-summary'].replaceChildren();
  for (const [kind, label] of [['add', 'added'], ['modify', 'changed'], ['delete', 'removed']]) {
    if (counts[kind]) elements['change-summary'].append(element('span', `summary-chip ${kind}`, `${counts[kind]} ${label}`));
  }
}

function renderFileList() {
  const query = state.fileQuery.trim().toLowerCase();
  const files = (state.eventData?.files || [])
    .filter((file) => file.path.toLowerCase().includes(query))
    .sort((a, b) => Number(Boolean(b.status)) - Number(Boolean(a.status)) || a.path.localeCompare(b.path));
  elements['file-list'].replaceChildren();
  elements['file-count'].textContent = String(files.length);

  for (const file of files) {
    const button = element('button', `file-item${file.path === state.selectedPath ? ' selected' : ''}`);
    button.type = 'button';
    button.role = 'option';
    button.ariaSelected = file.path === state.selectedPath ? 'true' : 'false';
    button.title = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
    const extension = file.path.includes('.') ? file.path.split('.').pop().slice(0, 2).toUpperCase() : '·';
    const pathNode = element('span', 'file-path');
    const slash = file.path.lastIndexOf('/');
    if (slash >= 0) {
      pathNode.append(document.createTextNode(file.path.slice(0, slash + 1)));
      pathNode.append(element('strong', '', file.path.slice(slash + 1)));
    } else {
      pathNode.append(element('strong', '', file.path));
    }
    button.append(
      element('span', 'file-icon', extension),
      pathNode,
      element('span', `file-status status-${file.status || 'none'}`, file.status || ''),
    );
    button.addEventListener('click', () => selectFile(file.path));
    elements['file-list'].append(button);
  }
}

function renderCode(snapshot) {
  elements['code-lines'].replaceChildren();
  elements['empty-state'].hidden = true;
  elements['code-lines'].hidden = false;
  elements['code-title'].textContent = snapshot.path;
  elements['code-event'].textContent = `Change #${pad(state.selectedSequence)}`;
  const event = state.eventData.event;
  elements['code-context'].textContent = event.subject;

  if (snapshot.binary) {
    elements['code-lines'].append(element('div', 'binary-state', 'Binary file · preview unavailable'));
    elements['code-stats'].replaceChildren();
    return;
  }

  let additions = 0;
  let deletions = 0;
  const fragment = document.createDocumentFragment();
  for (const line of snapshot.lines) {
    if (line.kind === 'add') additions += 1;
    if (line.kind === 'delete') deletions += 1;
    const row = element('div', `code-line ${line.kind}`);
    row.append(
      element('span', 'line-number', line.oldLine ?? ''),
      element('span', 'line-number', line.newLine ?? ''),
      element('span', 'line-mark', line.kind === 'add' ? '+' : line.kind === 'delete' ? '−' : ''),
      element('span', 'line-source', line.text || ' '),
    );
    fragment.append(row);
  }
  elements['code-lines'].append(fragment);
  elements['code-stats'].replaceChildren();
  if (additions) elements['code-stats'].append(element('span', 'stat-add', `+${additions}`));
  if (deletions) elements['code-stats'].append(element('span', 'stat-delete', `−${deletions}`));
}

async function selectFile(filePath) {
  if (state.selectedSequence === null) return;
  state.selectedPath = filePath;
  renderFileList();
  try {
    const snapshot = await requestJson(`/api/events/${state.selectedSequence}/file?path=${encodeURIComponent(filePath)}`);
    if (filePath !== state.selectedPath) return;
    renderCode(snapshot);
  } catch (error) {
    showToast(error.message);
  }
}

async function selectEvent(sequence, preferredPath = null) {
  state.selectedSequence = sequence;
  state.selectedPath = null;
  renderEventList();
  elements['event-number'].textContent = `Snapshot #${pad(sequence)}`;
  try {
    const data = await requestJson(`/api/events/${sequence}`);
    if (sequence !== state.selectedSequence) return;
    state.eventData = data;
    renderSummary();
    const preferred = preferredPath && data.files.find((file) => file.path === preferredPath);
    const firstChanged = data.files.find((file) => file.status);
    const next = preferred || firstChanged || data.files[0];
    state.selectedPath = next?.path || null;
    renderFileList();
    if (next) await selectFile(next.path);
  } catch (error) {
    showToast(error.message);
  }
}

async function loadTimeline({ silent = false } = {}) {
  try {
    const previousLatest = state.latestHash;
    const wasAtLatest = state.timeline?.events.at(-1)?.sequence === state.selectedSequence;
    const data = await requestJson('/api/timeline');
    state.timeline = data;
    state.latestHash = data.events.at(-1)?.hash || null;
    elements['repo-name'].textContent = data.repository.name;
    elements['branch-name'].textContent = data.repository.branch;
    elements['repository-path'].textContent = data.repository.path;
    document.title = `${data.repository.name} · Timeline`;
    renderEventList();

    if (state.selectedSequence === null && data.events.length) {
      await selectEvent(data.events.at(-1).sequence);
    } else if (previousLatest && previousLatest !== state.latestHash && wasAtLatest) {
      await selectEvent(data.events.at(-1).sequence);
      if (!silent) showToast('A new change was added to the timeline.');
    }
  } catch (error) {
    showToast(error.message);
  }
}

function moveEvent(direction) {
  const events = (state.timeline?.events || []).slice().reverse();
  const index = events.findIndex((event) => event.sequence === state.selectedSequence);
  const next = events[index + direction];
  if (next) selectEvent(next.sequence, state.selectedPath);
}

elements['event-search'].addEventListener('input', (event) => {
  state.eventQuery = event.target.value;
  renderEventList();
});
elements['file-search'].addEventListener('input', (event) => {
  state.fileQuery = event.target.value;
  renderFileList();
});
elements['refresh-button'].addEventListener('click', () => loadTimeline());
document.addEventListener('keydown', (event) => {
  const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  if (event.key === '/' && !typing) {
    event.preventDefault();
    elements['event-search'].focus();
  } else if (!typing && (event.key === 'j' || event.key === ']')) {
    event.preventDefault(); moveEvent(1);
  } else if (!typing && (event.key === 'k' || event.key === '[')) {
    event.preventDefault(); moveEvent(-1);
  } else if (event.key === 'Escape' && typing) {
    document.activeElement.blur();
  }
});

elements['event-list'].append(element('div', 'loading-row'));
elements['event-list'].append(element('div', 'loading-row'));
elements['event-list'].append(element('div', 'loading-row'));
loadTimeline();
setInterval(() => loadTimeline({ silent: true }), 2500);
