/**
 * A clean, UI-facing representation of a track.
 * Decoupled from Last.fm's raw (nested, stringly-typed) JSON so the rest of
 * the app depends on this shape rather than the API's quirks.
 */
export interface Track {
  name: string;
  artist: string;
  album: string;
  /** URL of the album art, or null if Last.fm didn't provide one. */
  imageUrl: string | null;
  /** True when this track is playing right now (Last.fm "nowplaying" flag). */
  isNowPlaying: boolean;
  /** Last.fm page for the track. */
  url: string;
}
