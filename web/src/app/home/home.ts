import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';
import { Api, LAST_WORKSPACE_KEY, storage } from '../api';
import { Scenario } from '../model/workspace-view';
import { RUN_TRACE, catalogOverview, catalogTotalText, sectionCountText } from '../model/home-view';
import { InstanceInfo } from '../shared/instance-info';

/**
 * The overview at /: what Wallet QA does, how a run works and what this instance tests. Starting
 * or joining a session is on /start.
 */
@Component({
  selector: 'qa-home',
  imports: [MatButtonModule, RouterLink, InstanceInfo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class HomePage {
  private readonly api = inject(Api);
  private readonly router = inject(Router);

  readonly lastWorkspace = signal(storage.get(LAST_WORKSPACE_KEY));
  readonly trace = RUN_TRACE;
  readonly scenarios = signal<Scenario[]>([]);
  readonly sections = computed(() => catalogOverview(this.scenarios()));
  readonly total = computed(() => catalogTotalText(this.sections()));
  readonly countText = sectionCountText;

  constructor() {
    // The overview is extra; the page works without it.
    this.api.get<{ scenarios: Scenario[] }>('/scenarios').then((data) => this.scenarios.set(data.scenarios), () => undefined);
  }

  /** Query parameters such as ?e2e=1 stay on. */
  resume() {
    const id = this.lastWorkspace();
    if (id) void this.router.navigate(['/w', id], { queryParamsHandling: 'preserve' });
  }
}
