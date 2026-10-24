import { Injectable, inject, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import {
  changePassword,
  getAuthStatus,
  login,
  logout,
  logoutEverywhere,
  setupAuth,
  type ApiMessage,
  type AuthStatusResponse,
} from '../../api/generated';
import { unwrap } from './api';

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly status = signal<AuthStatusResponse | null>(null);

  async refresh(): Promise<AuthStatusResponse> {
    const status = await unwrap(getAuthStatus({ throwOnError: false }));
    this.status.set(status);
    return status;
  }

  async setup(password: string): Promise<void> {
    await unwrap(setupAuth({ throwOnError: false, body: { password } }));
    await this.refresh();
  }

  async login(password: string, remember: boolean): Promise<void> {
    await unwrap(login({ throwOnError: false, body: { password, remember } }));
    await this.refresh();
  }

  async logout(): Promise<void> {
    await unwrap(logout({ throwOnError: false }));
    this.status.set({ configured: true, authenticated: false, username: null });
  }

  changePassword(currentPassword: string, newPassword: string): Promise<ApiMessage> {
    return unwrap(changePassword({ throwOnError: false, body: { currentPassword, newPassword } }));
  }

  logoutEverywhere(): Promise<ApiMessage> {
    return unwrap(logoutEverywhere({ throwOnError: false }));
  }
}

/** Shell routes: send visitors to first-run setup or sign-in, then back to where they were. */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  try {
    const status = await auth.refresh();
    if (!status.configured) return router.createUrlTree(['/setup'], { queryParams: { rd: state.url } });
    if (!status.authenticated) return router.createUrlTree(['/login'], { queryParams: { rd: state.url } });
    return true;
  } catch {
    // API unreachable (restarting): let the shell render its own error states.
    return true;
  }
};
