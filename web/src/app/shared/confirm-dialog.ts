import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';

export interface ConfirmData {
  title: string;
  text: string;
  confirm: string;
}

/** A yes/no question before an action that cannot be undone (publishing). */
@Component({
  selector: 'qa-confirm-dialog',
  imports: [MatDialogModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content><p>{{ data.text }}</p></mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton type="button" id="confirm-cancel" data-testid="confirm-cancel" [mat-dialog-close]="false">
        Cancel
      </button>
      <button matButton="filled" type="button" id="confirm-ok" data-testid="confirm-ok" [mat-dialog-close]="true">
        {{ data.confirm }}
      </button>
    </mat-dialog-actions>
  `,
})
export class ConfirmDialog {
  readonly data = inject<ConfirmData>(MAT_DIALOG_DATA);
}

export async function confirm(dialog: MatDialog, data: ConfirmData): Promise<boolean> {
  const ref = dialog.open<ConfirmDialog, ConfirmData, boolean>(ConfirmDialog, { data, maxWidth: '480px' });
  return (await firstValueFrom(ref.afterClosed())) === true;
}
