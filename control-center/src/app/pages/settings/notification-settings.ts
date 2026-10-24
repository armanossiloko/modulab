import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { getNotificationSettings, putNotificationSettings, testNotification } from '../../api/generated';
import { unwrap } from '../../core/services/api';

/** Settings → Alerts: where Control Center sends "app down", "disk full" and "backup failed". */
@Component({
  selector: 'app-notification-settings',
  imports: [FormsModule],
  template: `
    <section class="section">
      <div class="section__head">
        <div>
          <h2 class="section__title">Alerts</h2>
          <p class="section__desc">
            Control Center checks every minute and alerts when an app stops or turns unhealthy, a disk crosses the
            threshold, or a backup fails. Use <a href="https://ntfy.sh" target="_blank" rel="noopener">ntfy</a>
            for phone push, or any webhook.
          </p>
        </div>
      </div>
      <div class="field-grid">
        <label class="field field-grid--full">
          <span class="field__label">ntfy topic URL</span>
          <input class="input" [(ngModel)]="ntfyUrl" placeholder="https://ntfy.sh/my-lab-alerts" spellcheck="false" />
          <span class="field__hint">Pick a long, unguessable topic name. Self-hosted ntfy works too.</span>
        </label>
        <label class="field">
          <span class="field__label">ntfy access token <em>(optional)</em></span>
          <input
            class="input"
            type="password"
            [(ngModel)]="ntfyToken"
            [placeholder]="tokenSet ? 'Saved — leave blank to keep' : ''"
            autocomplete="off"
          />
        </label>
        <label class="field">
          <span class="field__label">Webhook URL <em>(optional)</em></span>
          <input class="input" [(ngModel)]="webhookUrl" placeholder="https://…" spellcheck="false" />
          <span class="field__hint">Receives each event as JSON.</span>
        </label>
        <label class="field">
          <span class="field__label">Disk alert at</span>
          <span class="inline">
            <input class="input num" type="number" min="50" max="100" [(ngModel)]="diskThreshold" />
            <span class="muted">% used</span>
          </span>
        </label>
        <label class="switch">
          <span class="switch__text">
            Recovery alerts
            <small>Also notify when an app is running again.</small>
          </span>
          <input type="checkbox" [(ngModel)]="notifyOnRecovery" />
        </label>
      </div>
      <div class="actions">
        @if (message()) {
          <span class="note" [class.is-error]="isError()" role="status">{{ message() }}</span>
        }
        <button type="button" class="btn" [disabled]="busy()" (click)="test()">Send test</button>
        <button type="button" class="btn btn--solid" [disabled]="busy()" (click)="save()">Save</button>
      </div>
    </section>
  `,
  styles: `
    :host {
      display: block;
      max-width: 880px;
    }
    .inline {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .num {
      width: 6rem;
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
    .section__desc a {
      color: var(--accent);
    }
  `,
})
export class NotificationSettings implements OnInit {
  ntfyUrl = '';
  ntfyToken = '';
  tokenSet = false;
  webhookUrl = '';
  diskThreshold = 90;
  notifyOnRecovery = true;
  readonly busy = signal(false);
  readonly message = signal<string | null>(null);
  readonly isError = signal(false);

  async ngOnInit(): Promise<void> {
    try {
      const s = await unwrap(getNotificationSettings({ throwOnError: false }));
      this.ntfyUrl = s.ntfyUrl ?? '';
      this.tokenSet = s.ntfyToken != null;
      this.webhookUrl = s.webhookUrl ?? '';
      this.diskThreshold = Number(s.diskThresholdPercent);
      this.notifyOnRecovery = s.notifyOnRecovery;
    } catch (err) {
      this.show(err instanceof Error ? err.message : 'Could not load alert settings', true);
    }
  }

  async save(): Promise<boolean> {
    this.busy.set(true);
    try {
      const s = await unwrap(
        putNotificationSettings({
          throwOnError: false,
          body: {
            ntfyUrl: this.ntfyUrl.trim() || null,
            ntfyToken: this.ntfyToken || null,
            webhookUrl: this.webhookUrl.trim() || null,
            diskThresholdPercent: Number(this.diskThreshold),
            notifyOnRecovery: this.notifyOnRecovery,
          },
        })
      );
      this.tokenSet = s.ntfyToken != null;
      this.ntfyToken = '';
      this.show('Saved', false);
      return true;
    } catch (err) {
      this.show(err instanceof Error ? err.message : 'Could not save', true);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  async test(): Promise<void> {
    if (!(await this.save())) return;
    this.busy.set(true);
    try {
      const res = await unwrap(testNotification({ throwOnError: false }));
      this.show(res.message, false);
    } catch (err) {
      this.show(err instanceof Error ? err.message : 'Test failed', true);
    } finally {
      this.busy.set(false);
    }
  }

  private show(message: string, error: boolean): void {
    this.message.set(message);
    this.isError.set(error);
  }
}
