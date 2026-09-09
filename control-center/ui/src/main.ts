import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { configureLabApi } from './app/api/configure-lab-api';

configureLabApi();

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
