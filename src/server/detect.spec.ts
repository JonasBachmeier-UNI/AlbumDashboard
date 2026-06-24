import { describe, expect, it } from 'vitest';
import { detectSessions, normalizeTrackName, resolvePosition } from './detect';
import type { DetectInput } from './detect';
import type { AlbumTrack } from './db/schema';

// --- helpers: build scrobbles at explicit times (minutes from a fixed epoch) ---
const T0 = new Date('2026-01-01T00:00:00Z').getTime();
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const at = (minutes: number) => new Date(T0 + minutes * MIN);

/** A scrobble of album `id` (`total` tracks) at `pos`, played `min` minutes in. */
function play(id: number, total: number, pos: number, min: number): DetectInput {
  return { playedAt: at(min), album: { id, totalTracks: total }, position: pos };
}
/** An untrackable scrobble (a single, or an unmatched track). */
function other(min: number): DetectInput {
  return { playedAt: at(min), album: null, position: null };
}
const soon = at(10_000); // a "now" shortly after these short test sequences

describe('detectSessions — requirement examples', () => {
  it('1. full album in one sitting → completed', () => {
    const out = detectSessions([play(1, 3, 1, 0), play(1, 3, 2, 1), play(1, 3, 3, 2)], soon);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ albumId: 1, furthestPosition: 3, status: 'completed' });
  });

  it('2.1. finish in a later sitting (gap < 7d) → completed', () => {
    const out = detectSessions(
      [play(1, 4, 1, 0), play(1, 4, 2, 1), play(1, 4, 3, 3 * DAY / MIN), play(1, 4, 4, 3 * DAY / MIN + 1)],
      soon,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ furthestPosition: 4, status: 'completed' });
  });

  it('2.1b. gap > 7d before resuming → first run abandoned, no resurrection', () => {
    const out = detectSessions(
      [play(1, 4, 1, 0), play(1, 4, 2, 1), play(1, 4, 3, 8 * DAY / MIN), play(1, 4, 4, 8 * DAY / MIN + 1)],
      at(9 * DAY / MIN),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ furthestPosition: 2, status: 'abandoned' });
  });

  it('2.2. replaying the current track keeps a single advancing session', () => {
    const out = detectSessions(
      [play(1, 4, 1, 0), play(1, 4, 2, 1), play(1, 4, 3, 2), play(1, 4, 3, 3), play(1, 4, 4, 4)],
      soon,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ furthestPosition: 4, status: 'completed' });
  });

  it('3.1. unrelated and out-of-order songs mid-record are ignored → completed', () => {
    const out = detectSessions(
      [
        play(1, 4, 1, 0),
        play(1, 4, 2, 1),
        other(2), // unrelated single
        play(1, 4, 2, 3), // out-of-order (already heard) — ignored
        play(9, 4, 1, 4), // a stray track from another album — ignored here
        play(1, 4, 3, 5),
        play(1, 4, 4, 6),
      ],
      soon,
    );
    const album1 = out.filter((s) => s.albumId === 1);
    expect(album1).toHaveLength(1);
    expect(album1[0]).toMatchObject({ furthestPosition: 4, status: 'completed' });
  });
});

describe('detectSessions — other behaviours', () => {
  it('restart from track 1 yields two sessions', () => {
    const out = detectSessions(
      [play(1, 5, 1, 0), play(1, 5, 2, 1), play(1, 5, 3, 2), play(1, 5, 1, 3), play(1, 5, 2, 4)],
      soon,
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ status: 'abandoned', furthestPosition: 3 });
    expect(out[1]).toMatchObject({ status: 'in_progress', furthestPosition: 2 });
  });

  it('tracks two interleaved albums independently', () => {
    const out = detectSessions(
      [play(1, 2, 1, 0), play(2, 2, 1, 1), play(1, 2, 2, 2), play(2, 2, 2, 3)],
      soon,
    );
    expect(out).toHaveLength(2);
    expect(out.find((s) => s.albumId === 1)).toMatchObject({ status: 'completed' });
    expect(out.find((s) => s.albumId === 2)).toMatchObject({ status: 'completed' });
  });

  it('opens from track 2 when the first scrobble was dropped (start grace)', () => {
    // No track 1 ever scrobbled; starts at 2 → progress assumes 1 was heard.
    const out = detectSessions([play(1, 5, 2, 0), play(1, 5, 3, 1), play(1, 5, 4, 2)], soon);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ furthestPosition: 4, status: 'in_progress' });
  });

  it('does NOT start a record from track 3+ (beyond the grace)', () => {
    expect(detectSessions([play(1, 5, 3, 0), play(1, 5, 4, 1)], soon)).toHaveLength(0);
  });

  it('ignores 1-track "albums" (singles)', () => {
    expect(detectSessions([play(1, 1, 1, 0)], soon)).toHaveLength(0);
  });

  it('classifies the final open session by the expiry window', () => {
    const seq = [play(1, 10, 1, 0), play(1, 10, 2, 1), play(1, 10, 3, 2)];
    expect(detectSessions(seq, at(2 + 60))[0]).toMatchObject({ status: 'in_progress' });
    expect(detectSessions(seq, at(8 * DAY / MIN))[0]).toMatchObject({ status: 'abandoned' });
  });
});

describe('normalizeTrackName', () => {
  it('ignores case, punctuation and accents', () => {
    expect(normalizeTrackName('Déjà Vu!')).toBe(normalizeTrackName('deja vu'));
  });
  it('strips "(feat. …)" and remaster noise', () => {
    expect(normalizeTrackName('Money (feat. Pink)')).toBe(normalizeTrackName('Money'));
    expect(normalizeTrackName('Time - Remastered 2011')).toBe(normalizeTrackName('Time'));
  });
});

describe('resolvePosition', () => {
  const tracks: AlbumTrack[] = [
    { position: 1, name: 'Speak to Me', duration: 90 },
    { position: 2, name: 'Breathe (In the Air)', duration: 163 },
    { position: 3, name: 'Time', duration: 421 },
  ];
  it('matches despite formatting differences', () => {
    expect(resolvePosition(tracks, 'breathe (in the air)')).toBe(2);
    expect(resolvePosition(tracks, 'Time - Remastered')).toBe(3);
  });
  it('returns null for an unknown track', () => {
    expect(resolvePosition(tracks, 'Money')).toBeNull();
  });
});
