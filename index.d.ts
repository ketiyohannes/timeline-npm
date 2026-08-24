export interface TimelineOptions {
  repo?: string;
  session?: string;
  codexSession?: string;
  label?: string;
  event?: string;
  tool?: string;
  turn?: string;
  toolUse?: string;
}

export interface TimelineEvent {
  hash: string;
  parents: string[];
  date: string;
  subject: string;
  sequence: number;
  context: Record<string, string>;
}

export interface TimelineSession {
  ref: string;
  date: string;
  subject: string;
}

export interface HookInstallResult {
  configPath: string;
  backupPath: string | null;
  action: 'installed' | 'uninstalled';
}

export interface TimelineServerOptions extends TimelineOptions {
  host?: string;
  port?: number;
  open?: boolean;
}

export class TimelineError extends Error {
  code: string;
  cause?: unknown;
}

export class Timeline {
  constructor(options?: TimelineOptions);
  readonly repo: string;
  readonly gitDir: string;
  readonly session: string;
  readonly ref: string;
  start(): string;
  sync(): string;
  checkpoint(): string | null;
  pendingSet(): string;
  flush(options?: { all?: boolean }): string[];
  clearPending(options?: { all?: boolean }): number;
  enable(): 'enabled';
  disable(): 'disabled';
  status(): 'enabled' | 'disabled';
  sessions(): TimelineSession[];
  latest(): string | null;
  list(): TimelineEvent[];
  diff(sequence: number): string;
  files(sequence: number): string[];
  tree(sequence: number): string[];
  changes(sequence: number): Array<{ path: string; status: string; oldPath?: string }>;
  fileSnapshot(sequence: number, filePath: string): {
    path: string;
    status: string;
    binary: boolean;
    lines: Array<{ text: string; kind: string; oldLine: number | null; newLine: number | null }>;
  };
  context(sequence: number): Record<string, string>;
}

export function installHooks(options?: { configPath?: string; adapterPath?: string }): HookInstallResult;
export function uninstallHooks(options?: { configPath?: string }): HookInstallResult;
export function createTimelineServer(options?: TimelineServerOptions): import('node:http').Server & { ready: Promise<{ url: string }> };
export function openTimeline(options?: TimelineServerOptions): import('node:http').Server & { ready: Promise<{ url: string }> };
