import { Component, OnInit, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  deleteBackup,
  getBackups,
  putBackupSettings,
  type BackupInfo,
  type BackupListResponse,
} from '../../api/generated';
import { formatBytes, timeAgo, unwrap } from '../../core/services/api';
import { AppTasks } from '../../core/services/app-tasks';
import { DashboardService } from '../../core/services/dashboard.service';
import { Icon } from '../../shared/icon';

interface EnvRow {
  key: string;
  value: string;
  saved: boolean;
}

/** Settings → Backups: schedule, offsite copy (restic), and restore. */
@Component({
  selector: 'app-backup-settings',
  imports: [FormsModule, Icon],
  template: `
    <div class="stack">
      <section class="section">
        <div class="section__head section__head--flush">
          <div>
            <h2 class="section__title">Backups</h2>
            <p class="section__desc">
              @if (data()?.lastRun; as run) {
                Last run {{ ago(run.at) }}:
                <strong [class.tone-negative]="run.status === 'error'">{{ run.status === 'ok' ? 'finished' : 'failed' }}</strong>
                @if (run.message) {
                  — {{ run.message }}
                }
              } @else {
                No backup has run yet.
              }
              @if (data()?.nextRun; as next) {
                · Next {{ when(next) }}
              }
            </p>
          </div>
          <button type="button" class="btn btn--solid" [disabled]="tasks.runningId() !== null" (click)="runNow()">
            <app-icon name="archive" [size]="14" />
            {{ tasks.runningId() === 'backup' ? 'Backing up…' : 'Back up now' }}
          </button>
        </div>
      </section>

      <section class="section">
        <div class="section__head">
          <div>
            <h2 class="section__title">Schedule</h2>
            <p class="section__desc">
              Each backup holds a dump of every Postgres database, each app's data folder and your lab config. Media
              libraries (Jellyfin media, Immich photos, MediaCMS uploads) are not copied locally — add them to the
              offsite extra paths below.
            </p>
          </div>
        </div>
        <div class="field-grid">
          <label class="switch">
            <span class="switch__text">
              Nightly backup
              <small>Runs at the time below, in the lab timezone.</small>
            </span>
            <input type="checkbox" [(ngModel)]="enabled" />
          </label>
          <label class="field">
            <span class="field__label">Time</span>
            <input class="input" type="time" [(ngModel)]="time" />
          </label>
          <label class="field">
            <span class="field__label">Keep</span>
            <span class="inline">
              <input class="input num" type="number" min="1" max="365" [(ngModel)]="keep" />
              <span class="muted">local backups</span>
            </span>
          </label>
        </div>
      </section>

      <section class="section">
        <div class="section__head">
          <div>
            <h2 class="section__title">Offsite copy (restic)</h2>
            <p class="section__desc">
              After each backup, copy it to a
              <a href="https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html" target="_blank" rel="noopener"
                >restic repository</a
              >: another disk, an SFTP server, S3, Backblaze B2… Uploads are encrypted and deduplicated. Leave the
              repository empty to keep backups local only.
            </p>
          </div>
        </div>
        <div class="field-grid">
          <label class="field field-grid--full">
            <span class="field__label">Repository</span>
            <input
              class="input mono"
              [(ngModel)]="resticRepository"
              placeholder="/mnt/usb/restic · sftp:user@nas:/backups/modulab · s3:s3.amazonaws.com/bucket/modulab"
              spellcheck="false"
            />
            <span class="field__hint">A path starting with / is a folder on this machine.</span>
          </label>
          <label class="field">
            <span class="field__label">Repository password</span>
            <input
              class="input"
              type="password"
              [(ngModel)]="resticPassword"
              [placeholder]="passwordSet ? 'Saved — leave blank to keep' : 'Encrypts the repository'"
              autocomplete="new-password"
            />
            <span class="field__hint">Store it somewhere else too: without it the offsite copy cannot be read.</span>
          </label>
          <label class="field">
            <span class="field__label">Keep offsite</span>
            <span class="inline">
              <input class="input num" type="number" min="0" max="365" [(ngModel)]="keepDaily" />
              <span class="muted">daily</span>
              <input class="input num" type="number" min="0" max="520" [(ngModel)]="keepWeekly" />
              <span class="muted">weekly</span>
            </span>
          </label>
          <div class="field field-grid--full">
            <span class="field__label">Credentials <em>(for S3, B2, Azure…)</em></span>
            @for (row of env; track $index; let i = $index) {
              <div class="env-row">
                <input class="input mono" [(ngModel)]="row.key" placeholder="AWS_ACCESS_KEY_ID" spellcheck="false" />
                <input
                  class="input"
                  type="password"
                  [(ngModel)]="row.value"
                  [placeholder]="row.saved ? 'Saved — leave blank to keep' : 'value'"
                  autocomplete="off"
                />
                <button type="button" class="icon-btn icon-btn--ghost" aria-label="Remove" (click)="env.splice(i, 1)">
                  <app-icon name="close" [size]="14" />
                </button>
              </div>
            }
            <button type="button" class="btn btn--sm btn--ghost add" (click)="env.push({ key: '', value: '', saved: false })">
              <app-icon name="plus" [size]="13" />
              Add variable
            </button>
          </div>
          <label class="field field-grid--full">
            <span class="field__label">Extra paths <em>(one per line)</em></span>
            <textarea
              class="textarea mono"
              rows="3"
              [(ngModel)]="extraPaths"
              placeholder="media&#10;data/immich/library&#10;/mnt/photos"
              spellcheck="false"
            ></textarea>
            <span class="field__hint">Copied straight to restic, never into local backups. Relative paths are inside the Modulab folder.</span>
          </label>
        </div>
        <div class="actions">
          @if (message()) {
            <span class="note" [class.is-error]="isError()" role="status">{{ message() }}</span>
          }
          <button type="button" class="btn btn--solid" [disabled]="busy()" (click)="save()">Save</button>
        </div>
      </section>

      <section class="section">
        <div class="section__head">
          <h2 class="section__title">Local backups</h2>
        </div>
        <ul class="row-list">
          @for (b of data()?.backups ?? []; track b.id) {
            <li class="row backup">
              <div class="row__main">
                <p class="row__title">
                  {{ date(b.createdAt) }}
                  <span class="badge badge--plain">{{ b.trigger }}</span>
                </p>
                <p class="row__meta">{{ size(b.sizeBytes) }} · {{ contents(b) }}</p>
              </div>
              <div class="row__end">
                <button type="button" class="btn btn--sm" [disabled]="tasks.runningId() !== null" (click)="openRestore(b)">
                  <app-icon name="undo" [size]="13" />
                  Restore…
                </button>
                <button
                  type="button"
                  class="icon-btn icon-btn--ghost icon-btn--danger"
                  [attr.aria-label]="'Delete backup ' + b.id"
                  title="Delete"
                  (click)="remove(b)"
                >
                  <app-icon name="trash" [size]="14" />
                </button>
              </div>
            </li>
          } @empty {
            <li class="empty-note">No backups yet. Click “Back up now” to make the first one.</li>
          }
        </ul>
      </section>
    </div>

    @if (restoring(); as b) {
      <div class="overlay" (click)="restoring.set(null)"></div>
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="restore-title">
        <header class="overlay-head">
          <div>
            <h2 id="restore-title" class="overlay-title">Restore from {{ date(b.createdAt) }}</h2>
            <p class="page-subtitle">Selected apps are stopped, restored, and started again.</p>
          </div>
        </header>
        <div class="overlay-body pick">
          @if (b.hasConfig) {
            <label class="switch">
              <span class="switch__text">
                Lab config
                <small>lab.config.json, secrets, dashboard, admin password</small>
              </span>
              <input type="checkbox" [(ngModel)]="restoreConfig" />
            </label>
          }
          @for (app of restoreChoices(b); track app) {
            <label class="switch">
              <span class="switch__text">
                {{ app }}
                <small>{{ b.apps.includes(app) ? 'data folder' : '' }}{{ b.apps.includes(app) && b.databases.includes(app) ? ' + ' : '' }}{{ b.databases.includes(app) ? 'database' : '' }}</small>
              </span>
              <input type="checkbox" [checked]="restoreApps.has(app)" (change)="toggle(app)" />
            </label>
          }
          <p class="field__hint">Current files are moved to data/.pre-restore/ first, nothing is deleted.</p>
        </div>
        <footer class="overlay-foot">
          <button type="button" class="btn btn--lg" (click)="restoring.set(null)">Cancel</button>
          <button
            type="button"
            class="btn btn--solid btn--lg"
            [disabled]="!restoreConfig && restoreApps.size === 0"
            (click)="confirmRestore(b)"
          >
            Restore
          </button>
        </footer>
      </div>
    }
  `,
  styles: `
    .stack {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      max-width: 880px;
    }
    .section__head--flush {
      margin-bottom: 0;
      align-items: center;
    }
    .section__desc a {
      color: var(--accent);
    }
    .tone-negative {
      color: var(--negative);
    }
    .inline {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .num {
      width: 5.5rem;
    }
    .mono {
      font-family: var(--mono);
      font-size: var(--fs-sm);
    }
    .env-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
      gap: 0.4rem;
    }
    .add {
      align-self: flex-start;
    }
    .actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 0.6rem;
      margin-top: var(--space-4);
    }
    .note {
      font-size: var(--fs-sm);
      color: var(--positive);
    }
    .note.is-error {
      color: var(--negative);
    }
    .backup .row__end {
      display: flex;
      gap: 0.35rem;
      align-items: center;
    }
    .pick {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
  `,
})
export class BackupSettings implements OnInit {
  readonly tasks = inject(AppTasks);
  private readonly dash = inject(DashboardService);
  readonly data = signal<BackupListResponse | null>(null);
  readonly busy = signal(false);
  readonly message = signal<string | null>(null);
  readonly isError = signal(false);
  readonly restoring = signal<BackupInfo | null>(null);
  restoreConfig = false;
  restoreApps = new Set<string>();

  enabled = true;
  time = '03:30';
  keep = 7;
  resticRepository = '';
  resticPassword = '';
  passwordSet = false;
  keepDaily = 7;
  keepWeekly = 4;
  env: EnvRow[] = [];
  extraPaths = '';

  readonly size = formatBytes;
  readonly ago = (iso: string) => timeAgo(iso);

  private readonly reloadAfterTask = effect(() => {
    if (this.tasks.settled() > 0) void this.load(false);
  });

  ngOnInit(): void {
    void this.load(true);
    if (this.dash.catalog().length === 0) this.dash.loadCatalog().subscribe({ error: () => undefined });
  }

  private async load(fillForm: boolean): Promise<void> {
    try {
      const res = await unwrap(getBackups({ throwOnError: false }));
      this.data.set(res);
      if (!fillForm) return;
      const s = res.settings;
      this.enabled = s.enabled;
      this.time = s.time;
      this.keep = Number(s.keep);
      this.resticRepository = s.resticRepository ?? '';
      this.passwordSet = s.resticPasswordSet;
      this.keepDaily = Number(s.resticKeepDaily);
      this.keepWeekly = Number(s.resticKeepWeekly);
      this.env = Object.keys(s.resticEnv ?? {}).map((key) => ({ key, value: '', saved: true }));
      this.extraPaths = (s.resticExtraPaths ?? []).join('\n');
    } catch (err) {
      this.show(err instanceof Error ? err.message : 'Could not load backups', true);
    }
  }

  async save(): Promise<void> {
    this.busy.set(true);
    try {
      const resticEnv: Record<string, string> = {};
      for (const row of this.env) {
        const key = row.key.trim();
        if (key) resticEnv[key] = row.value;
      }
      const s = await unwrap(
        putBackupSettings({
          throwOnError: false,
          body: {
            enabled: this.enabled,
            time: this.time,
            keep: Number(this.keep),
            resticRepository: this.resticRepository.trim(),
            resticPassword: this.resticPassword ? this.resticPassword : null,
            resticEnv,
            resticExtraPaths: this.extraPaths.split('\n').map((p) => p.trim()).filter(Boolean),
            resticKeepDaily: Number(this.keepDaily),
            resticKeepWeekly: Number(this.keepWeekly),
          },
        })
      );
      this.passwordSet = s.resticPasswordSet;
      this.resticPassword = '';
      this.env = Object.keys(s.resticEnv ?? {}).map((key) => ({ key, value: '', saved: true }));
      this.show('Saved', false);
      void this.load(false);
    } catch (err) {
      this.show(err instanceof Error ? err.message : 'Could not save', true);
    } finally {
      this.busy.set(false);
    }
  }

  runNow(): void {
    void this.tasks.backup();
  }

  openRestore(b: BackupInfo): void {
    this.restoreConfig = false;
    this.restoreApps = new Set();
    this.restoring.set(b);
  }

  restoreChoices(b: BackupInfo): string[] {
    // Apps with a data archive, plus databases that belong to a catalog app of the same name.
    const known = new Set(this.dash.catalog().map((a) => a.id));
    return [...new Set([...b.apps, ...b.databases])].filter((id) => known.has(id)).sort();
  }

  toggle(app: string): void {
    if (this.restoreApps.has(app)) this.restoreApps.delete(app);
    else this.restoreApps.add(app);
  }

  confirmRestore(b: BackupInfo): void {
    const parts = [...(this.restoreConfig ? ['lab config'] : []), ...this.restoreApps];
    if (!confirm(`Restore ${parts.join(', ')} from ${this.date(b.createdAt)}?\n\nChanges made since then are set aside.`)) return;
    this.restoring.set(null);
    void this.tasks.restore(b.id, { apps: [...this.restoreApps], config: this.restoreConfig });
  }

  async remove(b: BackupInfo): Promise<void> {
    if (!confirm(`Delete the backup from ${this.date(b.createdAt)}?`)) return;
    try {
      await unwrap(deleteBackup({ throwOnError: false, path: { id: b.id } }));
      void this.load(false);
    } catch (err) {
      this.show(err instanceof Error ? err.message : 'Could not delete', true);
    }
  }

  contents(b: BackupInfo): string {
    const parts: string[] = [];
    if (b.databases.length) parts.push(`${b.databases.length} database${b.databases.length === 1 ? '' : 's'}`);
    if (b.apps.length) parts.push(b.apps.join(', '));
    if (b.hasConfig) parts.push('config');
    return parts.join(' · ') || 'empty';
  }

  date(iso: string): string {
    return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  }

  when(iso: string): string {
    const d = new Date(iso);
    const today = new Date();
    const tomorrow = new Date(today.getTime() + 86_400_000);
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === today.toDateString()) return `today ${time}`;
    if (d.toDateString() === tomorrow.toDateString()) return `tomorrow ${time}`;
    return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  }

  private show(message: string, error: boolean): void {
    this.message.set(message);
    this.isError.set(error);
  }
}
