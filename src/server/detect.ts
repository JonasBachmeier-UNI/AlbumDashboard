import type { AlbumTrack, SessionStatus } from './db/schema';

/**
 * IN-ORDER RECORD DETECTION (interruption-tolerant)
 *
 * A "record session" tracks how far you've listened into an album, in order.
 * Each album progresses independently, so unrelated or out-of-order songs in
 * between are simply ignored — they never end a record. A session ends only by:
 *   - completing (reaching the last track),
 *   - being restarted from track 1, or
 *   - expiring after EXPIRE_DAYS with no progress.
 *
 * This function is PURE and operates on the FULL ordered scrobble list plus a
 * `now` timestamp (for expiry), so a re-run reproduces the same sessions. The
 * caller resolves album + position; we don't touch the network or DB.
 */

/** Days without progress before an open record is considered abandoned. */
export const EXPIRE_DAYS = 7;
const EXPIRE_MS = EXPIRE_DAYS * 24 * 60 * 60 * 1000;

/**
 * A record may open from track 1 *or* this position, to tolerate Last.fm/TIDAL
 * occasionally dropping the very first scrobble of a sitting. Opening at track 2
 * assumes track 1 was heard (progress starts at 2). Track 3+ never starts a
 * record — too likely to be a playlist hitting an album track by chance.
 */
export const START_GRACE = 2;

/** A scrobble annotated with its resolved album + tracklist position. */
export interface DetectInput {
  playedAt: Date;
  /** Resolved album, or null when the track isn't part of a known album. */
  album: { id: number; totalTracks: number } | null;
  /** 1-based position within that album, or null if unresolved. */
  position: number | null;
}

export interface DetectedSession {
  albumId: number;
  startedAt: Date;
  endedAt: Date;
  furthestPosition: number;
  status: SessionStatus;
}

interface OpenSession {
  albumId: number;
  totalTracks: number;
  startedAt: Date;
  endedAt: Date;
  furthest: number;
}

function finalize(s: OpenSession, status: SessionStatus): DetectedSession {
  return {
    albumId: s.albumId,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    furthestPosition: s.furthest,
    status,
  };
}

function startSession(
  albumId: number,
  totalTracks: number,
  at: Date,
  furthest: number,
): OpenSession {
  return { albumId, totalTracks, startedAt: at, endedAt: at, furthest };
}

const expired = (s: OpenSession, at: Date) => at.getTime() - s.endedAt.getTime() > EXPIRE_MS;

export function detectSessions(scrobbles: DetectInput[], now: Date): DetectedSession[] {
  const done: DetectedSession[] = [];
  // One independent open session per album.
  const open = new Map<number, OpenSession>();

  for (const s of scrobbles) {
    // Untrackable scrobble (unknown album, unmatched track, or a single/1-track
    // "album") — ignored entirely; never ends a record.
    if (s.album === null || s.position === null || s.album.totalTracks < 2) {
      continue;
    }
    const { id: albumId, totalTracks } = s.album;
    const pos = s.position;
    let session = open.get(albumId);

    // A long pause with no progress expires the record before this scrobble.
    if (session && expired(session, s.playedAt)) {
      done.push(finalize(session, 'abandoned'));
      open.delete(albumId);
      session = undefined;
    }

    if (!session) {
      // A record opens at track 1, or within the start grace (dropped 1st scrobble).
      if (pos <= START_GRACE) {
        const fresh = startSession(albumId, totalTracks, s.playedAt, pos);
        if (fresh.furthest >= fresh.totalTracks) {
          done.push(finalize(fresh, 'completed')); // e.g. a 2-track album opened at 2
        } else {
          open.set(albumId, fresh);
        }
      }
      continue;
    }

    if (pos === session.furthest + 1) {
      // Next track in order — advance.
      session.furthest = pos;
      session.endedAt = s.playedAt;
      if (session.furthest >= session.totalTracks) {
        done.push(finalize(session, 'completed'));
        open.delete(albumId);
      }
    } else if (pos === session.furthest) {
      // Replay of the current track (e.g. stopped mid-song, restarted it).
      session.endedAt = s.playedAt;
    } else if (pos === 1) {
      // Re-listen from the top — close the old run, start fresh.
      done.push(finalize(session, 'abandoned'));
      open.set(albumId, startSession(albumId, totalTracks, s.playedAt, 1));
    }
    // else: out-of-order / skip-ahead — an interruption; leave the session as-is.
  }

  // Classify whatever is still open: abandoned if it went stale, else resumable.
  for (const session of open.values()) {
    done.push(finalize(session, expired(session, now) ? 'abandoned' : 'in_progress'));
  }

  // Stable output order, oldest first.
  done.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  return done;
}

// --- Track-name → tracklist-position resolution (pure, fuzzy) ---

/**
 * Normalizes a track title for comparison: lowercased, accent-insensitive,
 * with "(feat. …)" / "- remastered" style noise and punctuation stripped.
 * Matching is inherently fuzzy — some titles legitimately won't match.
 */
export function normalizeTrackName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // strip accents / combining marks
    .replace(/\(feat\.?[^)]*\)/g, '') // (feat. X)
    .replace(/\[feat\.?[^\]]*\]/g, '') // [feat. X]
    .replace(/\bfeat\.?\b.*$/g, '') // trailing "feat. X"
    .replace(/-\s*(remaster(ed)?|mono|stereo|live|deluxe).*$/g, '') // edition noise
    .replace(/[^a-z0-9]/g, '') // drop punctuation/spaces
    .trim();
}

/** Returns the 1-based position of a track within an album, or null. */
export function resolvePosition(tracks: AlbumTrack[], trackName: string): number | null {
  const target = normalizeTrackName(trackName);
  if (!target) {
    return null;
  }
  const match = tracks.find((t) => normalizeTrackName(t.name) === target);
  return match ? match.position : null;
}
