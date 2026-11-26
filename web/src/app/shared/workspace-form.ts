import { ChangeDetectionStrategy, Component, input, linkedSignal, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { WorkspaceFormValue } from '../model/workspace-view';

/** Tester and wallet build of a workspace: creates one on the setup screen, edits one in a workspace. */
@Component({
  selector: 'qa-workspace-form',
  imports: [MatButtonModule, MatFormFieldModule, MatInputModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form id="workspace-form" data-testid="workspace-form" (submit)="$event.preventDefault(); submit()">
      <div class="fields">
        <mat-form-field appearance="outline">
          <mat-label>Wallet</mat-label>
          <input matInput id="wallet-name" data-testid="wallet-name" required [value]="form().name" (input)="set('name', $event)" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Build or version</mat-label>
          <input matInput id="wallet-version" data-testid="wallet-version" placeholder="e.g. 1.4.2 (2311)" [value]="form().version" (input)="set('version', $event)" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Platform</mat-label>
          <!-- A native select: its picker is the platform's, which UI test runners drive reliably. -->
          <select matNativeControl id="wallet-platform" data-testid="wallet-platform" (change)="set('platform', $event)">
            @for (option of platforms; track option.value) {
              <option [value]="option.value" [selected]="option.value === form().platform">{{ option.label }}</option>
            }
          </select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Device (optional)</mat-label>
          <input matInput id="wallet-device" data-testid="wallet-device" placeholder="e.g. Pixel 8, Android 16" [value]="form().device" (input)="set('device', $event)" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Your name (optional)</mat-label>
          <input matInput id="tester" data-testid="tester" autocomplete="name" [value]="form().tester" (input)="set('tester', $event)" />
        </mat-form-field>
      </div>
      <div class="actions">
        <button matButton="filled" type="submit" class="big" id="save-workspace" data-testid="save-workspace" [disabled]="busy() || !form().name.trim()">
          {{ editing() ? 'Save' : 'Create workspace' }}
        </button>
        @if (editing()) {
          <button matButton="outlined" type="button" class="big" id="cancel-edit" data-testid="cancel-edit" (click)="cancelled.emit()">Cancel</button>
        }
      </div>
    </form>
  `,
  styles: `
    .fields {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      column-gap: 12px;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .big {
      min-height: 48px;
    }
  `,
})
export class WorkspaceForm {
  readonly value = input.required<WorkspaceFormValue>();
  readonly editing = input(false);
  readonly busy = input(false);
  readonly saved = output<WorkspaceFormValue>();
  readonly cancelled = output<void>();

  readonly form = linkedSignal(() => ({ ...this.value() }));
  readonly platforms = [
    { value: '', label: '—' },
    { value: 'android', label: 'Android' },
    { value: 'ios', label: 'iOS' },
  ];

  set(key: keyof WorkspaceFormValue, event: Event) {
    const value = (event.target as HTMLInputElement | HTMLSelectElement).value;
    this.form.update((form) => ({ ...form, [key]: value }));
  }

  submit() {
    if (this.form().name.trim()) this.saved.emit(this.form());
  }
}
