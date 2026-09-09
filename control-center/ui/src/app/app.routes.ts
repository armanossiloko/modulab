import { Routes } from '@angular/router';
import { Shell } from './layout/shell/shell';
import { HomePage } from './pages/home/home-page';
import { LibraryPage } from './pages/library/library-page';
import { SettingsPage } from './pages/settings/settings-page';

export const routes: Routes = [
  {
    path: '',
    component: Shell,
    children: [
      { path: '', component: HomePage },
      { path: 'library', component: LibraryPage },
      { path: 'settings', component: SettingsPage },
      { path: 'settings/:section', component: SettingsPage },
      { path: '**', redirectTo: '' },
    ],
  },
];
