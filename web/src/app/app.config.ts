import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { MAT_RIPPLE_GLOBAL_OPTIONS, MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { E2E } from './e2e';

export function appConfig(e2e: boolean): ApplicationConfig {
  return {
    providers: [
      provideBrowserGlobalErrorListeners(),
      provideRouter(routes, withComponentInputBinding()),
      { provide: E2E, useValue: e2e },
      // Material 22 animates without @angular/animations; this is its switch (provideNoopAnimations()
      // would need the deprecated animations package).
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: e2e } },
      { provide: MAT_RIPPLE_GLOBAL_OPTIONS, useValue: { disabled: e2e } },
    ],
  };
}
