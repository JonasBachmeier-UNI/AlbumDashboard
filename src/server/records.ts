import { and, desc, eq } from 'drizzle-orm';

import { db } from './db/client';
import { albums, recordSessions, type SessionStatus } from './db/schema';

/** API-facing shape of a record session (album info flattened in). */
export interface RecordDto {
  id: number;
  status: SessionStatus;
  furthestPosition: number;
  startedAt: string;
  endedAt: string | null;
  album: {
    id: number;
    artist: string;
    title: string;
    imageUrl: string | null;
    totalTracks: number;
    rating: number | null;
  };
}

const baseSelect = {
  id: recordSessions.id,
  status: recordSessions.status,
  furthestPosition: recordSessions.furthestPosition,
  startedAt: recordSessions.startedAt,
  endedAt: recordSessions.endedAt,
  albumId: albums.id,
  artist: albums.artist,
  title: albums.title,
  imageUrl: albums.imageUrl,
  totalTracks: albums.totalTracks,
  rating: albums.rating,
};

type Row = {
  id: number;
  status: SessionStatus;
  furthestPosition: number;
  startedAt: Date;
  endedAt: Date | null;
  albumId: number;
  artist: string;
  title: string;
  imageUrl: string | null;
  totalTracks: number;
  rating: number | null;
};

function toDto(r: Row): RecordDto {
  return {
    id: r.id,
    status: r.status,
    furthestPosition: r.furthestPosition,
    startedAt: r.startedAt.toISOString(),
    endedAt: r.endedAt ? r.endedAt.toISOString() : null,
    album: {
      id: r.albumId,
      artist: r.artist,
      title: r.title,
      imageUrl: r.imageUrl,
      totalTracks: r.totalTracks,
      rating: r.rating,
    },
  };
}

/** All non-deleted record sessions, most recent first, optionally by status. */
export async function listRecords(status?: SessionStatus): Promise<RecordDto[]> {
  const rows = await db
    .select(baseSelect)
    .from(recordSessions)
    .innerJoin(albums, eq(recordSessions.albumId, albums.id))
    .where(
      and(
        eq(recordSessions.deleted, false),
        status ? eq(recordSessions.status, status) : undefined,
      ),
    )
    .orderBy(desc(recordSessions.endedAt));
  return rows.map(toDto);
}

/** The single active (in_progress) session, or null. */
export async function getCurrentRecord(): Promise<RecordDto | null> {
  const rows = await db
    .select(baseSelect)
    .from(recordSessions)
    .innerJoin(albums, eq(recordSessions.albumId, albums.id))
    .where(and(eq(recordSessions.status, 'in_progress'), eq(recordSessions.deleted, false)))
    .orderBy(desc(recordSessions.endedAt))
    .limit(1);
  return rows.length ? toDto(rows[0]) : null;
}

/** Soft-deletes a session. Returns false if no such session existed. */
export async function deleteRecord(id: number): Promise<boolean> {
  const res = await db
    .update(recordSessions)
    .set({ deleted: true, updatedAt: new Date() })
    .where(eq(recordSessions.id, id))
    .returning({ id: recordSessions.id });
  return res.length > 0;
}

/** Sets (or clears, with null) an album's 1–5 rating. Returns false if absent. */
export async function setAlbumRating(albumId: number, rating: number | null): Promise<boolean> {
  const res = await db
    .update(albums)
    .set({ rating })
    .where(eq(albums.id, albumId))
    .returning({ id: albums.id });
  return res.length > 0;
}
