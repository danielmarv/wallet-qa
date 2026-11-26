import { InjectionToken } from '@angular/core';

/**
 * True when the page was opened with ?e2e=1. UI test runners (Maestro, Appium) set it: Material
 * animations and ripples are switched off and the progress bar is hidden, so taps do not land on
 * moving elements. The flag is read once at startup; in-app links keep it in the query string.
 */
export const E2E = new InjectionToken<boolean>('E2E');
export const e2eRequested = () => new URLSearchParams(window.location.search).get('e2e') === '1';
