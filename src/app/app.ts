import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of, switchMap, timer } from 'rxjs';

import { RecordList } from './components/record-list/record-list';
import { Track } from './models/track.model';
import { LastfmService } from './services/lastfm.service';

/** How often to re-check what's playing, in milliseconds. */
const POLL_INTERVAL_MS = 5_000;

@Component({
  selector: 'app-root',
  imports: [RecordList],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  private readonly lastfm = inject(LastfmService);
  private readonly platformId = inject(PLATFORM_ID);

  /**
   * The now-playing state, as a three-way signal:
   *   undefined → still loading / connecting
   *   null      → nothing playing right now
   *   Track     → currently playing
   */
  protected readonly nowPlaying = signal<Track | null | undefined>(undefined);

  constructor() {
    // A repeating timer would stall server-side rendering (it never settles),
    // so only poll in the browser. The server renders the loading state and
    // the browser takes over after hydration.
    if (isPlatformBrowser(this.platformId)) {
      timer(0, POLL_INTERVAL_MS)
        .pipe(
          switchMap(() =>
            this.lastfm.getNowPlaying().pipe(
              // Keep the stream alive if a single request fails (network blip,
              // bad key, etc.) — treat it as "nothing playing" for this tick.
              catchError(() => of(null))
            )
          ),
          takeUntilDestroyed()
        )
        .subscribe((track) => this.nowPlaying.set(track));
    }
  }
}
