import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { environment } from '../../environments/environment';
import { Track } from '../models/track.model';

// --- Minimal typings for the raw Last.fm getRecentTracks response ---
// Last.fm returns everything as strings and nests text in "#text" fields.
interface LastfmImage {
  size: 'small' | 'medium' | 'large' | 'extralarge';
  '#text': string;
}

interface LastfmTrack {
  name: string;
  url: string;
  artist: { '#text': string };
  album: { '#text': string };
  image: LastfmImage[];
  '@attr'?: { nowplaying?: string };
  // `date` is present for past scrobbles and absent for the now-playing track.
  date?: { uts: string; '#text': string };
}

interface RecentTracksResponse {
  recenttracks?: {
    // `track` is an array, but Last.fm sometimes returns a single object.
    track: LastfmTrack[] | LastfmTrack;
  };
}

@Injectable({ providedIn: 'root' })
export class LastfmService {
  private readonly http = inject(HttpClient);
  private readonly config = environment.lastfm;

  /**
   * Fetches the track currently playing, or `null` if nothing is playing.
   * Last.fm marks the live track with `@attr.nowplaying === "true"`.
   */
  getNowPlaying(): Observable<Track | null> {
    const params = new HttpParams()
      .set('method', 'user.getrecenttracks')
      .set('user', this.config.username)
      .set('api_key', this.config.apiKey)
      .set('format', 'json')
      .set('limit', '1');

    return this.http
      .get<RecentTracksResponse>(this.config.baseUrl, { params })
      .pipe(map((response) => this.toNowPlayingTrack(response)));
  }

  private toNowPlayingTrack(response: RecentTracksResponse): Track | null {
    const raw = response.recenttracks?.track;
    // Normalise to a single track regardless of array-vs-object quirk.
    const track = Array.isArray(raw) ? raw[0] : raw;
    if (!track) {
      return null;
    }

    const isNowPlaying = track['@attr']?.nowplaying === 'true';
    if (!isNowPlaying) {
      // The newest track is a past scrobble — nothing playing right now.
      return null;
    }

    return {
      name: track.name,
      artist: track.artist['#text'],
      album: track.album['#text'],
      imageUrl: this.largestImage(track.image),
      isNowPlaying: true,
      url: track.url,
    };
  }

  /** Picks the highest-resolution non-empty image, or null. */
  private largestImage(images: LastfmImage[]): string | null {
    if (!images?.length) {
      return null;
    }
    // Images are ordered small → extralarge; take the last non-empty one.
    const withUrl = images.filter((img) => img['#text']);
    return withUrl.length ? withUrl[withUrl.length - 1]['#text'] : null;
  }
}
