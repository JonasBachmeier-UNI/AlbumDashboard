import 'dotenv/config';
import type { AlbumTrack } from './db/schema';

const BASE_URL = 'https://ws.audioscrobbler.com/2.0/';

function credentials(): { apiKey: string; user: string } {
  const apiKey = process.env['LASTFM_API_KEY'];
  const user = process.env['LASTFM_USER'];
  if (!apiKey || !user) {
    throw new Error('LASTFM_API_KEY and LASTFM_USER must be set (see .env).');
  }
  return { apiKey, user };
}

async function call<T>(params: Record<string, string>): Promise<T> {
  const url = new URL(BASE_URL);
  url.search = new URLSearchParams({ ...params, format: 'json' }).toString();
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Last.fm request failed: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as T & { error?: number; message?: string };
  if (json.error) {
    throw new Error(`Last.fm API error ${json.error}: ${json.message}`);
  }
  return json;
}

// --- A scrobble, parsed into the shape the rest of the server cares about ---
export interface ParsedScrobble {
  /** Unix seconds when the track was played. */
  uts: number;
  playedAt: Date;
  artist: string;
  album: string | null;
  track: string;
}

export interface RecentTracksPage {
  scrobbles: ParsedScrobble[];
  page: number;
  totalPages: number;
}

// --- Minimal raw response typings (Last.fm nests text in "#text") ---
interface RawText {
  '#text': string;
}
interface RawRecentTrack {
  name: string;
  artist: RawText;
  album: RawText;
  '@attr'?: { nowplaying?: string };
  date?: { uts: string };
}
interface RawRecentTracks {
  recenttracks?: {
    track: RawRecentTrack[] | RawRecentTrack;
    '@attr'?: { page: string; totalPages: string };
  };
}

/**
 * Fetches one page of scrobble history, oldest-supported via `from` (uts).
 * The live now-playing track (no `date`) is filtered out — we only ingest
 * completed plays.
 */
export async function getRecentTracks(opts: {
  from?: number;
  page?: number;
  limit?: number;
}): Promise<RecentTracksPage> {
  const { apiKey, user } = credentials();
  const params: Record<string, string> = {
    method: 'user.getrecenttracks',
    user,
    api_key: apiKey,
    limit: String(opts.limit ?? 200),
    page: String(opts.page ?? 1),
  };
  if (opts.from) {
    params['from'] = String(opts.from);
  }

  const data = await call<RawRecentTracks>(params);
  const raw = data.recenttracks?.track;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];

  const scrobbles: ParsedScrobble[] = list
    .filter((t) => t.date?.uts) // drop the live now-playing entry
    .map((t) => {
      const uts = Number(t.date!.uts);
      return {
        uts,
        playedAt: new Date(uts * 1000),
        artist: t.artist['#text'],
        album: t.album['#text'] || null,
        track: t.name,
      };
    });

  const attr = data.recenttracks?.['@attr'];
  return {
    scrobbles,
    page: Number(attr?.page ?? 1),
    totalPages: Number(attr?.totalPages ?? 1),
  };
}

export interface AlbumInfo {
  artist: string;
  title: string;
  mbid: string | null;
  imageUrl: string | null;
  totalTracks: number;
  totalDurationSec: number | null;
  tracks: AlbumTrack[];
}

interface RawAlbumTrack {
  name: string;
  duration?: string | number;
  '@attr'?: { rank?: string | number };
}
interface RawImage extends RawText {
  size: string;
}
interface RawAlbumInfo {
  album?: {
    name: string;
    artist: string;
    mbid?: string;
    image?: RawImage[];
    tracks?: { track: RawAlbumTrack[] | RawAlbumTrack };
  };
}

/**
 * Fetches an album's official tracklist. Returns null when Last.fm can't
 * identify the album or it has no tracklist (untrackable).
 */
export async function getAlbumInfo(artist: string, album: string): Promise<AlbumInfo | null> {
  const { apiKey } = credentials();
  const data = await call<RawAlbumInfo>({
    method: 'album.getinfo',
    artist,
    album,
    api_key: apiKey,
  });

  const a = data.album;
  const rawTracks = a?.tracks?.track;
  if (!a || !rawTracks) {
    return null;
  }
  const trackList = Array.isArray(rawTracks) ? rawTracks : [rawTracks];
  if (trackList.length === 0) {
    return null;
  }

  const tracks: AlbumTrack[] = trackList.map((t, i) => {
    const duration = t.duration ? Number(t.duration) : 0;
    return {
      // Prefer Last.fm's rank; fall back to array order (1-based).
      position: t['@attr']?.rank ? Number(t['@attr']!.rank) : i + 1,
      name: t.name,
      duration: duration > 0 ? duration : null,
    };
  });

  const totalDuration = tracks.reduce((sum, t) => sum + (t.duration ?? 0), 0);
  // Last.fm image array is ordered small → extralarge; take the last non-empty.
  const images = (a.image ?? []).filter((img) => img['#text']);
  return {
    artist: a.artist,
    title: a.name,
    mbid: a.mbid || null,
    imageUrl: images.length ? images[images.length - 1]['#text'] : null,
    totalTracks: tracks.length,
    totalDurationSec: totalDuration > 0 ? totalDuration : null,
    tracks,
  };
}
