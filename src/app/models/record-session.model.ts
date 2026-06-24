export type SessionStatus = 'in_progress' | 'completed' | 'abandoned';

/** A detected record-listening session, as returned by `/api/records`. */
export interface RecordSession {
  id: number;
  status: SessionStatus;
  /** Highest in-sequence track position reached (1-based). */
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
