import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  smallint,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

/** One entry per ordered track within an album's official tracklist. */
export interface AlbumTrack {
  position: number;
  name: string;
  /** Track length in seconds, or null if Last.fm didn't provide it. */
  duration: number | null;
}

/** Possible lifecycle states of a detected record-listening session. */
export type SessionStatus = 'in_progress' | 'completed' | 'abandoned';

/**
 * Cache of album metadata + tracklist, fetched from Last.fm `album.getInfo`.
 * Keyed on (artist, title) so each album is fetched at most once.
 */
export const albums = pgTable(
  'albums',
  {
    id: serial('id').primaryKey(),
    artist: text('artist').notNull(),
    title: text('title').notNull(),
    mbid: text('mbid'),
    imageUrl: text('image_url'),
    totalTracks: integer('total_tracks').notNull(),
    totalDurationSec: integer('total_duration_sec'),
    tracks: jsonb('tracks').$type<AlbumTrack[]>().notNull(),
    /** User's 1–5 star rating of the record, or null if unrated. */
    rating: smallint('rating'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('albums_artist_title_unique').on(t.artist, t.title)],
);

/**
 * Raw synced scrobbles (completed plays only — never the live now-playing
 * track). `playedAt` is unique so syncing is idempotent and detection can be
 * re-run deterministically.
 */
export const scrobbles = pgTable('scrobbles', {
  id: serial('id').primaryKey(),
  playedAt: timestamp('played_at', { withTimezone: true }).notNull().unique(),
  artist: text('artist').notNull(),
  album: text('album'),
  track: text('track').notNull(),
  /** Resolved album, if we could match it. */
  albumId: integer('album_id').references(() => albums.id),
  /** Resolved 1-based position within that album's tracklist. */
  position: integer('position'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** A detected run of in-order listening for one album. */
export const recordSessions = pgTable(
  'record_sessions',
  {
    id: serial('id').primaryKey(),
    albumId: integer('album_id')
      .references(() => albums.id)
      .notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    /** Highest in-sequence track position reached (1-based). */
    furthestPosition: integer('furthest_position').notNull().default(1),
    status: text('status').$type<SessionStatus>().notNull().default('in_progress'),
    /** User soft-delete — hidden from the UI, and not resurrected by re-syncs. */
    deleted: boolean('deleted').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Stable natural key so re-syncs upsert (preserving `deleted`) rather than
  // wiping and reinserting.
  (t) => [unique('record_sessions_album_started_unique').on(t.albumId, t.startedAt)],
);

/** Single-row table tracking how far the sync has progressed. */
export const syncState = pgTable('sync_state', {
  id: integer('id').primaryKey().default(1),
  /** Unix seconds of the most recent scrobble we've ingested. */
  lastSyncedUts: bigint('last_synced_uts', { mode: 'number' }),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
});

export type Album = typeof albums.$inferSelect;
export type Scrobble = typeof scrobbles.$inferSelect;
export type RecordSession = typeof recordSessions.$inferSelect;
