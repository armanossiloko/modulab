import { Injectable, inject, signal } from '@angular/core';
import { DashboardService } from './dashboard.service';

export interface AppTask {
  id: string;
  name: string;
  action: string;
  status: 'running' | 'ok' | 'error';
  latest: string;
  lines: string[];
  error: string | null;
  startedAt: string;
}

@Injectable({ providedIn: 'root' })
export class AppTasks {
  private readonly dash = inject(DashboardService);
  readonly task = signal<AppTask | null>(null);
  readonly logOpen = signal(false);
  readonly clock = signal(Date.now());
  /** Bumped whenever a task finishes, so pages can reload (backups list, catalog). */
  readonly settled = signal(0);
  private timer: number | null = null;
  private downSince: number | null = null;
  private reloadTimer: number | null = null;

  runningId(): string | null {
    const task = this.task();
    return task?.status === 'running' ? task.id : null;
  }

  async attach(): Promise<void> {
    await this.pull(false);
    if (this.task()?.status === 'running') this.follow();
  }

  async updateControlCenter(): Promise<void> {
    if (this.runningId()) {
      this.logOpen.set(true);
      return;
    }
    if (
      !confirm(
        'Download compose.yaml for this image tag and recreate Control Center, Postgres, and Caddy? This page disconnects while Control Center restarts.'
      )
    ) {
      return;
    }

    this.downSince = null;
    this.logOpen.set(false);
    this.task.set({
      id: 'control-center',
      name: 'Control Center',
      action: 'system-update',
      status: 'running',
      latest: 'Starting…',
      lines: [],
      error: null,
      startedAt: new Date().toISOString(),
    });

    try {
      const res = await fetch('/api/system/update', { method: 'POST' });
      const body = (await res.json()) as { current?: AppTask; message?: string };
      if (body.current) {
        const next = normalize(body.current);
        this.task.set(next);
        if (next.status === 'running') this.follow();
        else this.settle(next.status);
        return;
      }
      this.fail(body.message || `Update failed (${res.status})`);
    } catch (err) {
      this.fail(err instanceof Error ? err.message : 'Update failed');
    }
  }

  async updateApp(id: string, name: string): Promise<void> {
    await this.run(`/api/apps/${encodeURIComponent(id)}/update`, { id, name, action: 'update' });
  }

  async rollbackApp(id: string, name: string): Promise<void> {
    await this.run(`/api/apps/${encodeURIComponent(id)}/rollback`, { id, name, action: 'rollback' });
  }

  async backup(): Promise<void> {
    await this.run('/api/backups', { id: 'backup', name: 'Backup', action: 'backup' });
  }

  async restore(backupId: string, body: { apps: string[]; config: boolean }): Promise<void> {
    await this.run(`/api/backups/${encodeURIComponent(backupId)}/restore`, { id: 'restore', name: 'Restore', action: 'restore' }, body);
  }

  /** POST an endpoint that starts a lab task (202) or reports the busy one (409), then follow it. */
  private async run(url: string, start: Pick<AppTask, 'id' | 'name' | 'action'>, body?: unknown): Promise<void> {
    if (this.runningId()) {
      this.logOpen.set(true);
      return;
    }

    this.logOpen.set(false);
    this.task.set({
      ...start,
      status: 'running',
      latest: 'Starting…',
      lines: [],
      error: null,
      startedAt: new Date().toISOString(),
    });

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const payload = (await res.json()) as { current?: AppTask; message?: string };
      if (payload.current) {
        const next = normalize(payload.current);
        this.task.set(next);
        if (next.status === 'running') this.follow();
        else this.settle(next.status);
        return;
      }
      this.fail(payload.message || `Request failed (${res.status})`);
    } catch (err) {
      this.fail(err instanceof Error ? err.message : 'Request failed');
    }
  }

  async dismiss(): Promise<void> {
    if (this.task()?.status === 'running') return;
    try {
      await fetch('/api/tasks', { method: 'DELETE' });
    } catch {
      /* hiding the panel locally is enough */
    }
    this.task.set(null);
    this.logOpen.set(false);
    this.stop();
  }

  private follow(): void {
    if (this.timer != null) return;
    this.timer = window.setInterval(() => void this.pull(true), 1000);
  }

  private stop(): void {
    if (this.timer == null) return;
    window.clearInterval(this.timer);
    this.timer = null;
  }

  private async pull(settle: boolean): Promise<void> {
    this.clock.set(Date.now());
    try {
      const res = await fetch('/api/tasks', { cache: 'no-store' });
      if (!res.ok) {
        this.noteRestartIfDown();
        return;
      }
      const body = (await res.json()) as { current?: AppTask | null };
      const prev = this.task();
      const next = body.current ? normalize(body.current) : null;
      if (prev?.action === 'system-update' && prev.status === 'running' && !next) {
        window.location.reload();
        return;
      }
      this.task.set(next);
      if (settle && prev?.status === 'running' && next && next.status !== 'running') {
        this.settle(next.status);
      }
      if (next?.action === 'system-update' && next.status === 'ok') this.armReload();
      this.downSince = null;
      if (!next || next.status !== 'running') this.stop();
    } catch {
      this.noteRestartIfDown();
    }
  }

  private noteRestartIfDown(): void {
    const task = this.task();
    if (task?.action !== 'system-update' || task.status !== 'running') return;
    if (this.downSince == null) this.downSince = Date.now();
    if (Date.now() - this.downSince < 8000) return;
    this.task.set({
      ...task,
      latest: 'Control Center is restarting. This page will reload when it is back.',
    });
    this.armReload();
  }

  private armReload(): void {
    if (this.reloadTimer != null) return;
    this.reloadTimer = window.setInterval(() => void this.ping(), 2000);
  }

  private async ping(): Promise<void> {
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      if (!res.ok) return;
      if (this.downSince != null || this.task()?.status === 'ok') window.location.reload();
    } catch {
      this.downSince = this.downSince ?? Date.now();
    }
  }

  private settle(status: AppTask['status']): void {
    if (status === 'error') this.logOpen.set(true);
    this.settled.update((n) => n + 1);
    this.dash.loadCatalog().subscribe({ error: () => undefined });
    this.dash.loadUpdates(true).subscribe({ error: () => undefined });
  }

  private fail(message: string): void {
    const current = this.task();
    this.task.set({
      id: current?.id ?? '',
      name: current?.name ?? 'App',
      action: current?.action ?? 'update',
      status: 'error',
      latest: 'Failed',
      lines: current?.lines ?? [],
      error: message,
      startedAt: current?.startedAt ?? new Date().toISOString(),
    });
    this.logOpen.set(true);
    this.stop();
  }
}

function normalize(task: AppTask): AppTask {
  return {
    ...task,
    lines: Array.isArray(task.lines) ? task.lines : [],
    error: task.error ?? null,
  };
}

/** Task dock headline for a task in its current state. */
export function taskTitle(task: AppTask): string {
  const running = task.status === 'running';
  const ok = task.status === 'ok';
  switch (task.action) {
    case 'backup':
      return running ? 'Backing up the lab' : ok ? 'Backup finished' : 'Backup failed';
    case 'restore':
      return running ? 'Restoring from backup' : ok ? 'Restore finished' : 'Restore failed';
    case 'rollback':
      return running ? `Rolling back ${task.name}` : ok ? `${task.name} rolled back` : `Couldn't roll back ${task.name}`;
    default:
      return running ? `Updating ${task.name}` : ok ? `${task.name} updated` : `Couldn't update ${task.name}`;
  }
}
