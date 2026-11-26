import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTableModule } from '@angular/material/table';
import { Api, ApiError, errorText } from '../api';
import {
  PublishedFeed,
  dateText,
  featureText,
  filterResults,
  loadErrorText,
  provenanceText,
  resultDetails,
  verdictTone,
  versionText,
  walletNames,
  walletTitle,
} from '../model/results-view';

/**
 * The public results page (/results): published results from GET /v1/published. On a hosted
 * instance it is outside the team login, so it reads nothing but the feed.
 */
@Component({
  selector: 'qa-results',
  imports: [MatCardModule, MatFormFieldModule, MatInputModule, MatTableModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './results.html',
  styleUrl: './results.scss',
})
export class ResultsPage {
  private readonly api = inject(Api);

  readonly message = signal('Loading published results…');
  readonly feed = signal<PublishedFeed | undefined>(undefined);
  readonly wallet = signal('');
  readonly wallets = computed(() => walletNames(this.feed()?.results ?? []));
  readonly shown = computed(() => filterResults(this.feed()?.results ?? [], this.wallet()));
  readonly columns = ['test', 'verdict', 'features', 'tested', 'eudiplo'];

  readonly walletTitle = walletTitle;
  readonly details = resultDetails;
  readonly provenance = provenanceText;
  readonly tone = verdictTone;
  readonly date = dateText;
  readonly version = versionText;

  constructor() {
    this.api.get<PublishedFeed>('/published').then(
      (feed) => {
        this.feed.set(feed);
        this.message.set('');
      },
      (error) => this.message.set(loadErrorText(error instanceof ApiError ? error.status : undefined, errorText(error))),
    );
  }

  features(ids: string[]) {
    return featureText(this.feed()?.features ?? [], ids);
  }
}
