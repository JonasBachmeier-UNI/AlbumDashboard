import { DatePipe, NgClass, isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of, switchMap, timer } from 'rxjs';

import { RecordSession } from '../../models/record-session.model';
import { RecordsService } from '../../services/records.service';

/** How often to refresh the listing from the API, in milliseconds. */
const REFRESH_INTERVAL_MS = 30_000;

@Component({
  selector: 'app-record-list',
  imports: [DatePipe, NgClass],
  templateUrl: './record-list.html',
})
export class RecordList {
  private readonly records = inject(RecordsService);
  private readonly platformId = inject(PLATFORM_ID);

  /** undefined = loading, [] = empty, list = loaded. */
  protected readonly sessions = signal<RecordSession[] | undefined>(undefined);
  protected readonly stars = [1, 2, 3, 4, 5];

  constructor() {
    // Same-origin /api calls only make sense in the browser (SSR has no host).
    if (isPlatformBrowser(this.platformId)) {
      timer(0, REFRESH_INTERVAL_MS)
        .pipe(
          switchMap(() => this.records.getRecords().pipe(catchError(() => of([])))),
          takeUntilDestroyed(),
        )
        .subscribe((list) => this.sessions.set(list));
    }
  }

  private refresh(): void {
    this.records
      .getRecords()
      .pipe(catchError(() => of([])))
      .subscribe((list) => this.sessions.set(list));
  }

  protected progressPct(r: RecordSession): number {
    if (!r.album.totalTracks) {
      return 0;
    }
    return Math.round((r.furthestPosition / r.album.totalTracks) * 100);
  }

  /** Next track to play when resuming an in-progress record. */
  protected resumeTrack(r: RecordSession): number {
    return Math.min(r.furthestPosition + 1, r.album.totalTracks);
  }

  /** Click a star: set the rating, or clear it if clicking the current value. */
  protected rate(r: RecordSession, star: number): void {
    const next = r.album.rating === star ? null : star;
    // Optimistic update so the UI feels instant; the poll/refresh reconciles.
    this.sessions.update((list) =>
      list?.map((s) => (s.album.id === r.album.id ? { ...s, album: { ...s.album, rating: next } } : s)),
    );
    this.records.setRating(r.album.id, next).subscribe({ error: () => this.refresh() });
  }

  protected remove(r: RecordSession): void {
    this.sessions.update((list) => list?.filter((s) => s.id !== r.id));
    this.records.deleteRecord(r.id).subscribe({ error: () => this.refresh() });
  }
}
