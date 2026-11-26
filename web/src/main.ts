import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { appConfig } from './app/app.config';
import { e2eRequested } from './app/e2e';

const e2e = e2eRequested();
// The class switches off CSS transitions as well (styles.scss).
if (e2e) document.documentElement.classList.add('e2e');
bootstrapApplication(App, appConfig(e2e)).catch((error) => console.error(error));
