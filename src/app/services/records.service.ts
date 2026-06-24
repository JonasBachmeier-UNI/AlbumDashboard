import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { RecordSession } from '../models/record-session.model';

/** Reads detected record sessions from the server API (same-origin /api). */
@Injectable({ providedIn: 'root' })
export class RecordsService {
  private readonly http = inject(HttpClient);

  getRecords(): Observable<RecordSession[]> {
    return this.http.get<RecordSession[]>('/api/records');
  }

  getCurrent(): Observable<RecordSession | null> {
    return this.http.get<RecordSession | null>('/api/records/current');
  }

  /** Soft-delete a record session. */
  deleteRecord(id: number): Observable<void> {
    return this.http.delete<void>(`/api/records/${id}`);
  }

  /** Set an album's 1–5 rating, or pass null to clear it. */
  setRating(albumId: number, rating: number | null): Observable<void> {
    return this.http.put<void>(`/api/albums/${albumId}/rating`, { rating });
  }
}
