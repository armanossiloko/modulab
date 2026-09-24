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
  private timer: number | null = null;

  runningId(): string | null {
    const task = this.task();
    return task?.status === 'running' ? task.id : null;
  }

  async attach(): Promise<void> {
    await this.pull(false);
    if (this.task()?.status === 'running') this.follow();
  }

  async updateApp(id: string, name: string): Promise<void> {
    if (this.runningId()) {
      this.logOpen.set(true);
      return;
    }

    this.logOpen.set(false);
    this.task.set({
      id,
      name,
      action: 'update',
      status: 'running',
      latest: 'Starting…',
      lines: [],
      error: null,
      startedAt: new Date().toISOString(),
    });

    try {
      const res = await fetch(`/api/apps/${encodeURIComponent(id)}/update`, { method: 'POST' });
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
      if (!res.ok) return;
      const body = (await res.json()) as { current?: AppTask | null };
      const prev = this.task();
      const next = body.current ? normalize(body.current) : null;
      this.task.set(next);
      if (settle && prev?.status === 'running' && next && next.status !== 'running') {
        this.settle(next.status);
      }
      if (!next || next.status !== 'running') this.stop();
    } catch {
      /* keep the last snapshot and retry on the next tick */
    }
  }

  private settle(status: AppTask['status']): void {
    if (status === 'error') this.logOpen.set(true);
    this.dash.loadCatalog().subscribe({ error: () => undefined });
    this.dash.loadUpdates(true).subscribe({ error: () => undefined });
  }

  private fail(message: string): void {
    const current = this.task();
    this.task.set({
      id: current?.id ?? '',
      name: current?.name ?? 'App',
      action: 'update',
      status: 'error',
      latest: 'Update failed',
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
