import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  getContainers,
  getEvents,
  getSystemMetrics,
  type ContainerRow,
  type DiskUsage,
  type LabEvent,
  type SystemMetricsResponse,
} from '../../api/generated';
import { formatBytes, timeAgo, unwrap } from '../../core/services/api';
import { AppLogsDialog } from '../../shared/app-logs-dialog';
import { Icon } from '../../shared/icon';
import { Sparkline, type SparkPoint } from '../../shared/sparkline';

type Severity = 'ok' | 'high' | 'critical';

/** Host resources, containers and recent events. Polls lightly; all data comes from Control Center. */
@Component({
  selector: 'app-system-page',
  imports: [Icon, Sparkline, AppLogsDialog, RouterLink],
  template: `
    <header class="page-header">
      <div class="page-header__titles">
        <h1 class="page-title">System</h1>
        <p class="page-subtitle">
          @if (host(); as h) {
            Up {{ uptime(h.uptimeSeconds) }} · {{ h.cpuCount }} CPU cores
          } @else {
            Host metrics need Linux (Control Center reads /proc)
          }
        </p>
      </div>
      <div class="page-header__actions">
        <a class="btn" routerLink="/settings/notifications">
          <app-icon name="bell" [size]="14" />
          Alerts
        </a>
      </div>
    </header>

    <section class="kpis" aria-label="Host resources">
      <article class="card kpi">
        <p class="kpi__label">CPU</p>
        <p class="kpi__value">{{ host() ? num(host()!.cpuPercent).toFixed(0) + '%' : '—' }}</p>
        <p class="kpi__meta">Load {{ host() ? load() : '—' }}</p>
        <app-sparkline [points]="cpuTrend()" label="CPU usage, last two hours" />
      </article>
      <article class="card kpi">
        <p class="kpi__label">Memory</p>
        <p class="kpi__value">{{ host() ? memPercent().toFixed(0) + '%' : '—' }}</p>
        <p class="kpi__meta">
          @if (host(); as h) {
            {{ bytes(h.memoryUsedBytes) }} of {{ bytes(h.memoryTotalBytes) }}
          } @else {
            —
          }
        </p>
        <app-sparkline [points]="memTrend()" label="Memory usage, last two hours" />
      </article>
      <article class="card kpi">
        <p class="kpi__label">Containers</p>
        @if (containers(); as list) {
          <p class="kpi__value">{{ runningCount() }}<span class="kpi__of"> / {{ list.length }}</span></p>
        } @else {
          <p class="kpi__value">—</p>
        }
        <p class="kpi__meta">
          running
          @if (unhealthyCount()) {
            · <span class="tone-negative">{{ unhealthyCount() }} need attention</span>
          }
        </p>
      </article>
    </section>

    <section class="section" aria-labelledby="disks-title">
      <div class="section__head">
        <h2 id="disks-title" class="section__title">Storage</h2>
      </div>
      @for (disk of disks(); track disk.path) {
        <div class="disk">
          <div class="disk__head">
            <span class="disk__label">{{ disk.label }}</span>
            <span class="disk__path">{{ disk.path }}</span>
            <span class="disk__value">
              {{ bytes(disk.usedBytes) }} of {{ bytes(disk.totalBytes) }} ·
              <strong>{{ diskPercent(disk).toFixed(0) }}%</strong>
              @if (severity(diskPercent(disk)) !== 'ok') {
                <span class="badge" [class.badge--negative]="severity(diskPercent(disk)) === 'critical'" [class.badge--accent]="severity(diskPercent(disk)) === 'high'">
                  {{ severity(diskPercent(disk)) === 'critical' ? 'Nearly full' : 'High' }}
                </span>
              }
            </span>
          </div>
          <div
            class="meter"
            [class.is-high]="severity(diskPercent(disk)) === 'high'"
            [class.is-critical]="severity(diskPercent(disk)) === 'critical'"
            role="meter"
            [attr.aria-valuenow]="diskPercent(disk).toFixed(0)"
            aria-valuemin="0"
            aria-valuemax="100"
            [attr.aria-label]="disk.label + ' disk usage'"
          >
            <span class="meter__fill" [style.width.%]="diskPercent(disk)"></span>
          </div>
        </div>
      } @empty {
        <p class="empty-note">No disk information available.</p>
      }
    </section>

    <section class="section" aria-labelledby="containers-title">
      <div class="section__head">
        <div>
          <h2 id="containers-title" class="section__title">Containers</h2>
          <p class="section__desc">Every container on this Docker host. CPU and memory refresh every 15 seconds.</p>
        </div>
      </div>
      @if (containersError()) {
        <p class="empty-note">{{ containersError() }}</p>
      } @else if (containers() === null) {
        <p class="empty-note">Asking Docker…</p>
      } @else {
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th scope="col">Container</th>
                <th scope="col">State</th>
                <th scope="col" class="num">CPU</th>
                <th scope="col" class="num">Memory</th>
                <th scope="col" class="num">Restarts</th>
                <th scope="col"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              @for (c of containers() ?? []; track c.name) {
                <tr>
                  <td>
                    <span class="c-name">{{ c.name }}</span>
                    <span class="c-image">{{ c.image }}</span>
                  </td>
                  <td>
                    <span
                      class="badge"
                      [class.badge--positive]="tone(c) === 'positive'"
                      [class.badge--negative]="tone(c) === 'negative'"
                      [class.badge--accent]="tone(c) === 'accent'"
                      [title]="c.status"
                      >{{ stateLabel(c) }}</span
                    >
                  </td>
                  <td class="num">{{ c.cpuPercent == null ? '—' : num(c.cpuPercent).toFixed(1) + '%' }}</td>
                  <td class="num">{{ c.memoryBytes == null ? '—' : bytes(c.memoryBytes) }}</td>
                  <td class="num" [class.tone-negative]="num(c.restartCount) > 3">{{ c.restartCount }}</td>
                  <td class="actions">
                    @if (c.appId) {
                      <button type="button" class="btn btn--sm" (click)="openLogs(c)">
                        <app-icon name="terminal" [size]="13" />
                        Logs
                      </button>
                    }
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="6" class="empty-note">No containers yet.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>

    <section class="section" aria-labelledby="events-title">
      <div class="section__head">
        <div>
          <h2 id="events-title" class="section__title">Recent events</h2>
          <p class="section__desc">Apps going down or recovering, disks filling up, backup results.</p>
        </div>
      </div>
      <ul class="events">
        @for (e of events(); track e.id) {
          <li class="event">
            <span class="event__level" [class]="'event__level level-' + e.level">
              <app-icon [name]="e.level === 'info' ? 'check' : 'info'" [size]="14" />
              {{ levelLabel(e.level) }}
            </span>
            <span class="event__msg">{{ e.message }}</span>
            <time class="event__time" [attr.datetime]="e.at" [title]="e.at">{{ ago(e.at) }}</time>
          </li>
        } @empty {
          <li class="empty-note">Nothing has happened yet.</li>
        }
      </ul>
    </section>

    @if (logsFor(); as l) {
      <app-logs-dialog [appId]="l.appId" [name]="l.appId" [container]="l.container" (closed)="logsFor.set(null)" />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
    .kpis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: var(--space-3);
    }
    .kpi {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      padding: var(--space-4);
    }
    .kpi__label {
      margin: 0;
      font-size: var(--fs-sm);
      color: var(--text-dim);
      font-weight: 550;
    }
    .kpi__value {
      margin: 0;
      font-size: 1.9rem;
      font-weight: 650;
      letter-spacing: -0.02em;
      color: var(--text);
    }
    .kpi__of {
      font-size: var(--fs-lg);
      color: var(--text-muted);
      font-weight: 500;
    }
    .kpi__meta {
      margin: 0 0 0.6rem;
      font-size: var(--fs-xs);
      color: var(--text-muted);
    }
    .tone-negative {
      color: var(--negative);
    }
    .disk + .disk {
      margin-top: var(--space-4);
    }
    .disk__head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.25rem 0.75rem;
      margin-bottom: 0.45rem;
    }
    .disk__label {
      font-weight: 600;
    }
    .disk__path {
      font-family: var(--mono);
      font-size: var(--fs-xs);
      color: var(--text-muted);
    }
    .disk__value {
      margin-left: auto;
      font-size: var(--fs-sm);
      color: var(--text-dim);
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
    }
    .disk__value strong {
      color: var(--text);
    }
    /* Meter: the fill carries severity; the track is a light step of the same hue. */
    .meter {
      --tone: var(--positive);
      height: 8px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--tone) 16%, transparent);
      overflow: hidden;
    }
    .meter.is-high {
      --tone: var(--accent);
    }
    .meter.is-critical {
      --tone: var(--negative);
    }
    .meter__fill {
      display: block;
      height: 100%;
      border-radius: 999px;
      background: var(--tone);
      transition: width 0.4s var(--ease);
    }
    .table-wrap {
      overflow-x: auto;
    }
    .table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--fs-sm);
    }
    .table th {
      text-align: left;
      font-size: var(--fs-xs);
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 0 0.6rem 0.5rem;
      border-bottom: 1px solid var(--border-soft);
    }
    .table td {
      padding: 0.55rem 0.6rem;
      border-bottom: 1px solid var(--border-soft);
      vertical-align: middle;
    }
    .table tr:last-child td {
      border-bottom: 0;
    }
    .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .actions {
      text-align: right;
    }
    .c-name {
      display: block;
      font-weight: 600;
      color: var(--text);
    }
    .c-image {
      display: block;
      font-family: var(--mono);
      font-size: 0.7rem;
      color: var(--text-muted);
      max-width: 42ch;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .events {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .event {
      display: grid;
      grid-template-columns: 7.5rem minmax(0, 1fr) auto;
      gap: 0.75rem;
      align-items: center;
      padding: 0.5rem 0;
      border-bottom: 1px solid var(--border-soft);
      font-size: var(--fs-sm);
    }
    .event:last-child {
      border-bottom: 0;
    }
    .event__level {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-weight: 600;
      color: var(--text-dim);
    }
    .event__level app-icon {
      color: var(--text-muted);
    }
    .level-error app-icon {
      color: var(--negative);
    }
    .level-warning app-icon {
      color: var(--accent);
    }
    .level-info app-icon {
      color: var(--positive);
    }
    .event__msg {
      color: var(--text);
    }
    .event__time {
      color: var(--text-muted);
      font-size: var(--fs-xs);
      white-space: nowrap;
    }
  `,
})
export class SystemPage implements OnInit, OnDestroy {
  readonly metrics = signal<SystemMetricsResponse | null>(null);
  /** null until the first answer — docker stats takes a couple of seconds. */
  readonly containers = signal<ContainerRow[] | null>(null);
  readonly containersError = signal<string | null>(null);
  readonly events = signal<LabEvent[]>([]);
  readonly logsFor = signal<{ appId: string; container: string } | null>(null);
  private readonly timers: number[] = [];

  readonly host = computed(() => this.metrics()?.host ?? null);
  readonly disks = computed(() => this.metrics()?.disks ?? []);
  readonly cpuTrend = computed<SparkPoint[]>(() =>
    (this.metrics()?.history ?? []).map((p) => ({ at: p.at, value: Number(p.cpu) }))
  );
  readonly memTrend = computed<SparkPoint[]>(() =>
    (this.metrics()?.history ?? []).map((p) => ({ at: p.at, value: Number(p.memory) }))
  );
  readonly memPercent = computed(() => {
    const h = this.host();
    const total = Number(h?.memoryTotalBytes ?? 0);
    return total > 0 ? (100 * Number(h!.memoryUsedBytes)) / total : 0;
  });
  readonly load = computed(() => {
    const h = this.host();
    return h ? [h.load1, h.load5, h.load15].map((v) => Number(v).toFixed(2)).join(' · ') : '';
  });
  readonly runningCount = computed(() => (this.containers() ?? []).filter((c) => c.state === 'running').length);
  readonly unhealthyCount = computed(
    () => (this.containers() ?? []).filter((c) => c.health === 'unhealthy' || c.state === 'restarting').length
  );

  readonly bytes = formatBytes;
  readonly ago = (iso: string) => timeAgo(iso);
  readonly num = (v: number | string | null | undefined) => Number(v ?? 0);

  ngOnInit(): void {
    void this.loadMetrics();
    void this.loadContainers();
    void this.loadEvents();
    this.timers.push(
      window.setInterval(() => void this.loadMetrics(), 10_000),
      window.setInterval(() => void this.loadContainers(), 15_000),
      window.setInterval(() => void this.loadEvents(), 30_000)
    );
  }

  ngOnDestroy(): void {
    this.timers.forEach((t) => window.clearInterval(t));
  }

  private async loadMetrics(): Promise<void> {
    try {
      this.metrics.set(await unwrap(getSystemMetrics({ throwOnError: false, query: { history: 120 } })));
    } catch {
      /* keep last values */
    }
  }

  private async loadContainers(): Promise<void> {
    try {
      const res = await unwrap(getContainers({ throwOnError: false }));
      this.containers.set(res.containers);
      this.containersError.set(null);
    } catch (err) {
      this.containersError.set(err instanceof Error ? err.message : 'Docker is not reachable');
    }
  }

  private async loadEvents(): Promise<void> {
    try {
      this.events.set((await unwrap(getEvents({ throwOnError: false, query: { limit: 30 } }))).events);
    } catch {
      /* keep last values */
    }
  }

  diskPercent(d: DiskUsage): number {
    const total = Number(d.totalBytes);
    return total > 0 ? (100 * Number(d.usedBytes)) / total : 0;
  }

  severity(pct: number): Severity {
    return pct >= 90 ? 'critical' : pct >= 80 ? 'high' : 'ok';
  }

  tone(c: ContainerRow): 'positive' | 'negative' | 'accent' | 'neutral' {
    if (c.health === 'unhealthy' || c.state === 'restarting' || c.state === 'dead') return 'negative';
    if (c.health === 'starting') return 'accent';
    if (c.state === 'running') return 'positive';
    return 'neutral';
  }

  stateLabel(c: ContainerRow): string {
    if (c.state === 'running' && c.health) return c.health === 'healthy' ? 'Healthy' : c.health === 'starting' ? 'Starting' : 'Unhealthy';
    return c.state.charAt(0).toUpperCase() + c.state.slice(1);
  }

  levelLabel(level: string): string {
    return level === 'error' ? 'Problem' : level === 'warning' ? 'Warning' : 'OK';
  }

  uptime(seconds: number | string): string {
    const s = Number(seconds);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    return d > 0 ? `${d} d ${h} h` : `${h} h ${Math.floor((s % 3600) / 60)} min`;
  }

  openLogs(c: ContainerRow): void {
    if (c.appId) this.logsFor.set({ appId: c.appId, container: c.name });
  }
}
