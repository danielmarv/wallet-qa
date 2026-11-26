import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink, RouterOutlet } from '@angular/router';

@Component({
  selector: 'qa-root',
  imports: [RouterOutlet, RouterLink, MatToolbarModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-toolbar class="app-bar">
      <a class="brand" routerLink="/" queryParamsHandling="preserve" id="brand" data-testid="brand">Wallet QA</a>
      <span class="tagline">Pick a test, run it with the wallet, answer the checklist.</span>
      <span class="spacer"></span>
      <a matButton routerLink="/start" queryParamsHandling="preserve" id="start-link" data-testid="start-link">Start</a>
      <a matButton routerLink="/results" id="results-link" data-testid="results-link">Results</a>
    </mat-toolbar>
    <main class="page">
      <router-outlet />
    </main>
  `,
  styles: `
    .app-bar {
      position: sticky;
      top: 0;
      z-index: 2;
      gap: 12px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .brand {
      color: inherit;
      text-decoration: none;
      font: var(--mat-sys-title-large);
    }
    .tagline {
      font: var(--mat-sys-body-medium);
      color: var(--mat-sys-on-surface-variant);
      white-space: normal;
    }
    .spacer {
      flex: 1;
    }
    @media (max-width: 599px) {
      .tagline {
        display: none;
      }
    }
    .page {
      box-sizing: border-box;
      width: 100%;
      max-width: 1280px;
      margin: 0 auto;
      padding: 16px;
    }
    @media (max-width: 599px) {
      .page {
        padding: 12px 8px 24px;
      }
    }
  `,
})
export class App {}
