import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatExpansionModule } from '@angular/material/expansion';
import { Api } from '../api';
import { Environment, certificateText, instanceRootText, instanceSummary } from '../model/workspace-view';

/** The fixed trust setup of this instance: which wallet builds can be tested here. */
@Component({
  selector: 'qa-instance-info',
  imports: [MatExpansionModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (environment(); as env) {
      <mat-expansion-panel class="instance" id="instance-info" data-testid="instance-info">
        <mat-expansion-panel-header>
          <mat-panel-title id="instance-summary" data-testid="instance-summary">{{ summary(env) }}</mat-panel-title>
        </mat-expansion-panel-header>
        <p class="muted">
          Every test runs against these EUDIPLO tenants. They are set up when the instance is deployed; your wallet
          build has to trust the issuers of their access certificates.
        </p>
        <ul id="instance-tenants" data-testid="instance-tenants">
          @for (tenant of env.tenants ?? []; track tenant.tenantId) {
            <li>
              <strong>{{ tenant.tenantId }}</strong> — {{ tenant.description ?? tenant.profileIds.join(', ') }}<br />
              <span [class]="tenant.error ? 'warning' : 'muted'">{{ certificate(tenant) }}</span>
            </li>
          }
        </ul>
        @if (root(env)) {
          <p class="muted root" id="instance-root" data-testid="instance-root">{{ root(env) }}</p>
        }
      </mat-expansion-panel>
    }
  `,
  styles: `
    .instance {
      box-shadow: none !important;
      border: 1px solid var(--mat-sys-outline-variant);
    }
    li {
      margin: 0 0 8px;
    }
    .muted {
      color: var(--mat-sys-on-surface-variant);
    }
    .warning {
      color: var(--mat-sys-error);
    }
    .root {
      word-break: break-all;
    }
  `,
})
export class InstanceInfo {
  private readonly api = inject(Api);
  readonly environment = signal<Environment | undefined>(undefined);
  readonly summary = instanceSummary;
  readonly certificate = certificateText;
  readonly root = instanceRootText;

  constructor() {
    // The page works without it.
    this.api.get<Environment>('/environment').then((env) => this.environment.set(env), () => undefined);
  }
}
