import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth';

/** Settings → Security: admin password and sessions. */
@Component({
  selector: 'app-security-settings',
  imports: [FormsModule],
  template: `
    <div class="stack">
      <section class="section">
        <div class="section__head">
          <div>
            <h2 class="section__title">Admin password</h2>
            <p class="section__desc">Changing it signs out every other browser.</p>
          </div>
        </div>
        <form class="field-grid" (ngSubmit)="change()">
          <label class="field">
            <span class="field__label">Current password</span>
            <input class="input" type="password" name="current" [(ngModel)]="current" autocomplete="current-password" required />
          </label>
          <label class="field">
            <span class="field__label">New password</span>
            <input class="input" type="password" name="next" [(ngModel)]="next" autocomplete="new-password" required />
            <span class="field__hint">At least 8 characters.</span>
          </label>
          <label class="field">
            <span class="field__label">Repeat new password</span>
            <input class="input" type="password" name="repeat" [(ngModel)]="repeat" autocomplete="new-password" required />
          </label>
          <div class="field-grid--full actions">
            @if (message()) {
              <span class="note" [class.is-error]="isError()" role="status">{{ message() }}</span>
            }
            <button type="submit" class="btn btn--solid" [disabled]="busy() || !current || !next">Change password</button>
          </div>
        </form>
      </section>

      <section class="section">
        <div class="section__head section__head--flush">
          <div>
            <h2 class="section__title">Sessions</h2>
            <p class="section__desc">
              Lost a device or signed in somewhere you shouldn't have? Sign out everywhere except here.
            </p>
          </div>
          <div class="row-actions">
            <button type="button" class="btn" (click)="signOutOthers()">Sign out other sessions</button>
            <button type="button" class="btn" (click)="signOut()">Sign out</button>
          </div>
        </div>
      </section>
    </div>
  `,
  styles: `
    .stack {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      max-width: 880px;
    }
    .actions,
    .row-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 0.6rem;
    }
    .section__head--flush {
      margin-bottom: 0;
    }
    .note {
      font-size: var(--fs-sm);
      color: var(--positive);
    }
    .note.is-error {
      color: var(--negative);
    }
  `,
})
export class SecuritySettings {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  current = '';
  next = '';
  repeat = '';
  readonly busy = signal(false);
  readonly message = signal<string | null>(null);
  readonly isError = signal(false);

  async change(): Promise<void> {
    if (this.next !== this.repeat) {
      this.show('The new passwords do not match', true);
      return;
    }
    this.busy.set(true);
    try {
      const res = await this.auth.changePassword(this.current, this.next);
      this.current = this.next = this.repeat = '';
      this.show(res.message, false);
    } catch (err) {
      this.show(err instanceof Error ? err.message : 'Could not change the password', true);
    } finally {
      this.busy.set(false);
    }
  }

  async signOutOthers(): Promise<void> {
    if (!confirm('Sign out every other browser and device?')) return;
    try {
      const res = await this.auth.logoutEverywhere();
      this.show(res.message, false);
    } catch (err) {
      this.show(err instanceof Error ? err.message : 'Failed', true);
    }
  }

  async signOut(): Promise<void> {
    await this.auth.logout();
    void this.router.navigate(['/login']);
  }

  private show(message: string, error: boolean): void {
    this.message.set(message);
    this.isError.set(error);
  }
}
