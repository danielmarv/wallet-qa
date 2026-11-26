import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Router, RouterLink } from '@angular/router';
import { Api, ApiError, LAST_WORKSPACE_KEY, errorText, storage } from '../api';
import {
  PUBLISH_WARNING,
  Workspace,
  WorkspaceFormValue,
  publishErrorText,
  publishedText,
  workspaceBody,
  workspaceForm,
  workspaceIdFrom,
} from '../model/workspace-view';
import { confirm } from '../shared/confirm-dialog';
import { InstanceInfo } from '../shared/instance-info';
import { WorkspaceForm } from '../shared/workspace-form';

/**
 * /start: create a workspace. Joining one by its link sits below the form, since most testers
 * join by opening the link or scanning its QR code. Publishing a report from another instance
 * is folded at the bottom: it is rare, and it needs the team login that /results does not.
 */
@Component({
  selector: 'qa-start',
  imports: [
    MatButtonModule,
    MatCardModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatInputModule,
    RouterLink,
    InstanceInfo,
    WorkspaceForm,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './start.html',
  styleUrl: './start.scss',
})
export class StartPage {
  private readonly api = inject(Api);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);

  /** A message handed over by the workspace page, e.g. an expired workspace. */
  readonly message = signal<string>(this.router.currentNavigation()?.extras.state?.['message'] ?? history.state?.message ?? '');
  readonly busy = signal(false);
  readonly lastWorkspace = signal(storage.get(LAST_WORKSPACE_KEY));
  readonly joinInput = signal('');
  readonly uploadFile = signal<File | undefined>(undefined);
  readonly formValue = workspaceForm();

  async create(form: WorkspaceFormValue) {
    this.busy.set(true);
    try {
      const created = await this.api.post<Workspace>('/workspaces', workspaceBody(form));
      storage.set(LAST_WORKSPACE_KEY, created.id);
      await this.open(created.id);
    } catch (error) {
      this.message.set(errorText(error));
    } finally {
      this.busy.set(false);
    }
  }

  join() {
    const id = workspaceIdFrom(this.joinInput());
    if (!id) {
      this.message.set('That is not a workspace link or ID.');
      return;
    }
    void this.open(id);
  }

  resume() {
    const id = this.lastWorkspace();
    if (id) void this.open(id);
  }

  /** Query parameters such as ?e2e=1 stay on. */
  private open(id: string) {
    return this.router.navigate(['/w', id], { queryParamsHandling: 'preserve' });
  }

  chooseFile(event: Event) {
    this.uploadFile.set((event.target as HTMLInputElement).files?.[0]);
  }

  async upload() {
    const file = this.uploadFile();
    if (!file) {
      this.message.set('Choose a workspace JSON report first.');
      return;
    }
    const ok = await confirm(this.dialog, { title: 'Publish this report?', text: PUBLISH_WARNING, confirm: 'Publish' });
    if (!ok) return;
    try {
      const result = await this.api.post<{ tests: unknown[] }>('/uploads', await file.text());
      this.message.set(publishedText(result.tests.length, true));
    } catch (error) {
      this.message.set(publishErrorText(error instanceof ApiError ? error.status : undefined, errorText(error)));
    }
  }
}
