import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { getLabStatus } from '../../api/generated';
import { AuthService } from '../../core/services/auth';

/**
 * Sign-in and first-run setup. `rd` is where to go afterwards: an in-app path, or (from Caddy's
 * forward_auth) an absolute URL on a protected lab hostname.
 */
@Component({
  selector: 'app-login-page',
  imports: [FormsModule],
  template: `
    <main class="auth">
      <form class="auth-card" (ngSubmit)="submit()">
        <span class="brand-orb" aria-hidden="true"></span>
        @if (mode() === 'setup') {
          <h1 class="auth-title">Welcome to Modulab</h1>
          <p class="auth-lede">
            Set an admin password for Control Center. Anyone on your network who can open this page can
            install and remove apps, so pick something only you know.
          </p>
        } @else {
          <h1 class="auth-title">Sign in</h1>
          <p class="auth-lede">Control Center is locked.</p>
        }

        <label class="field">
          <span class="field__label">Password</span>
          <input
            class="input"
            type="password"
            name="password"
            [(ngModel)]="password"
            [autocomplete]="mode() === 'setup' ? 'new-password' : 'current-password'"
            required
            autofocus
          />
        </label>

        @if (mode() === 'setup') {
          <label class="field">
            <span class="field__label">Repeat password</span>
            <input class="input" type="password" name="confirm" [(ngModel)]="confirm" autocomplete="new-password" required />
            <span class="field__hint">At least 8 characters.</span>
          </label>
        } @else {
          <label class="remember">
            <input type="checkbox" name="remember" [(ngModel)]="remember" />
            Keep me signed in for 30 days
          </label>
        }

        @if (error()) {
          <p class="auth-error" role="alert">{{ error() }}</p>
        }

        <button type="submit" class="btn btn--solid btn--lg" [disabled]="busy()">
          {{ busy() ? 'Please wait…' : mode() === 'setup' ? 'Set password' : 'Sign in' }}
        </button>

        @if (mode() === 'login') {
          <p class="auth-foot">
            Forgot it? Delete <code>data/control-center/auth.json</code> in your Modulab folder and reload
            to set a new one.
          </p>
        }
      </form>
    </main>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100dvh;
    }
    .auth {
      min-height: 100dvh;
      display: grid;
      place-items: center;
      padding: 1.5rem;
    }
    .auth-card {
      width: min(400px, 100%);
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      padding: 1.75rem;
      border-radius: var(--radius-lg);
      border: 1px solid var(--border-soft);
      background: var(--bg-elevated);
      box-shadow: var(--shadow-pop);
      animation: modal-in 0.22s var(--ease) both;
    }
    .brand-orb {
      width: 30px;
      height: 30px;
      border-radius: 50%;
      background: radial-gradient(
        circle at 35% 30%,
        color-mix(in srgb, var(--accent) 45%, #fff),
        var(--accent) 55%,
        color-mix(in srgb, var(--accent) 55%, #000)
      );
      box-shadow: 0 0 20px color-mix(in srgb, var(--accent) 35%, transparent);
    }
    .auth-title {
      margin: 0;
      font-size: var(--fs-xl);
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .auth-lede {
      margin: -0.5rem 0 0;
      color: var(--text-dim);
      font-size: var(--fs-md);
      line-height: 1.5;
    }
    .remember {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: var(--fs-sm);
      color: var(--text-dim);
      cursor: pointer;
    }
    .auth-error {
      margin: 0;
      padding: 0.55rem 0.75rem;
      border-radius: var(--radius-sm);
      border: 1px solid var(--negative-border);
      background: var(--negative-soft);
      color: var(--text);
      font-size: var(--fs-sm);
    }
    .auth-foot {
      margin: 0;
      font-size: var(--fs-xs);
      color: var(--text-muted);
      line-height: 1.5;
    }
    .auth-foot code {
      font-family: var(--mono);
      color: var(--text-dim);
    }
  `,
})
export class LoginPage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly mode = signal<'login' | 'setup'>('login');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  password = '';
  confirm = '';
  remember = true;

  async ngOnInit(): Promise<void> {
    try {
      const status = await this.auth.refresh();
      if (status.authenticated) {
        await this.leave();
        return;
      }
      this.mode.set(status.configured ? 'login' : 'setup');
    } catch {
      this.error.set('Control Center is not reachable. Is it running?');
    }
  }

  async submit(): Promise<void> {
    if (this.busy()) return;
    this.error.set(null);
    if (this.mode() === 'setup' && this.password !== this.confirm) {
      this.error.set('The passwords do not match');
      return;
    }
    this.busy.set(true);
    try {
      if (this.mode() === 'setup') await this.auth.setup(this.password);
      else await this.auth.login(this.password, this.remember);
      await this.leave();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Sign-in failed');
      this.password = '';
      this.confirm = '';
    } finally {
      this.busy.set(false);
    }
  }

  private async leave(): Promise<void> {
    const rd = this.route.snapshot.queryParamMap.get('rd') || '/';
    if (rd.startsWith('/') && !rd.startsWith('//')) {
      await this.router.navigateByUrl(rd);
      return;
    }
    // Absolute URL from a protected app hostname: only follow it within the lab domain.
    try {
      const target = new URL(rd);
      const status = await getLabStatus({ throwOnError: false });
      const domain = status.data?.domain;
      if (domain && (target.protocol === 'http:' || target.protocol === 'https:') && target.hostname.endsWith(`.${domain}`)) {
        window.location.assign(target.toString());
        return;
      }
    } catch {
      /* not a URL — fall through */
    }
    await this.router.navigateByUrl('/');
  }
}
