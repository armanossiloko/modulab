import { Routes } from '@angular/router';
import { authGuard } from './core/services/auth';
import { Shell } from './layout/shell/shell';
import { LoginPage } from './pages/auth/login-page';
import { HomePage } from './pages/home/home-page';
import { LibraryPage } from './pages/library/library-page';
import { SettingsPage } from './pages/settings/settings-page';
import { SystemPage } from './pages/system/system-page';

export const routes: Routes = [
  { path: 'login', component: LoginPage, title: 'Sign in · Modulab' },
  { path: 'setup', component: LoginPage, title: 'Set up · Modulab' },
  {
    path: '',
    component: Shell,
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'd/home' },
      { path: 'd/:id', component: HomePage },
      { path: 'library', component: LibraryPage },
      { path: 'system', component: SystemPage },
      { path: 'settings', component: SettingsPage },
      { path: 'settings/:section', component: SettingsPage },
      { path: '**', redirectTo: 'd/home' },
    ],
  },
];
