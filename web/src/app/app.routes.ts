import { Routes } from '@angular/router';

// /w/<workspace>?scenario=<id>&run=<id> are the links testers, the README and UI test runners use.
// /results is public on hosted instances (outside the team login); it reads only GET /v1/published.
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./home/home').then((m) => m.HomePage),
    title: 'Wallet QA',
  },
  {
    path: 'start',
    loadComponent: () => import('./start/start').then((m) => m.StartPage),
    title: 'Start a test session · Wallet QA',
  },
  {
    path: 'w/:workspaceId',
    loadComponent: () => import('./workspace/workspace').then((m) => m.WorkspacePage),
    title: 'Wallet QA',
  },
  {
    path: 'results',
    loadComponent: () => import('./results/results').then((m) => m.ResultsPage),
    title: 'Wallet QA results',
  },
  { path: '**', redirectTo: '' },
];
