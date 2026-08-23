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

export interface NeovimInstallResult {
  target: string;
  action: 'installed' | 'uninstalled';
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
  context(sequence: number): Record<string, string>;
}

export function installHooks(options?: { configPath?: string; adapterPath?: string }): HookInstallResult;
export function uninstallHooks(options?: { configPath?: string }): HookInstallResult;
export function defaultNeovimTarget(): string;
export function installNeovim(options?: { target?: string }): NeovimInstallResult;
export function uninstallNeovim(options?: { target?: string }): NeovimInstallResult;
