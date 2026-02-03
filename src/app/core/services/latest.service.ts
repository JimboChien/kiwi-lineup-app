import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, of, Observable } from 'rxjs';

export interface LatestRow {
  Player: string;
  StartSec?: number | '';
  EndSec?: number | '';
  EmbedURL: string;
  Title?: string;
  Volume?: number;
}

type IncomingRow = Partial<LatestRow> & { [key: string]: any };

@Injectable({ providedIn: 'root' })
export class LatestService {
  // TODO: 設定為你的 Apps Script Web App URL
  private endpoint = 'https://script.google.com/macros/s/AKfycbySgT9yqjC3GJ3KqHepmkM1sjwmFhn75aGxYElD6xz8XnkPMnM0w9pHUX3Yv7paHcbo/exec';

  constructor(private http: HttpClient) {}

  fetchLatest(): Observable<LatestRow[]> {
    if (!this.endpoint) {
      const mock: LatestRow[] = [
        { Player: '#1 張一', StartSec: 10, EndSec: 30, EmbedURL: 'https://www.youtube.com/embed/QImBolnTVH8?enablejsapi=1&playsinline=1&modestbranding=1&rel=0', Title: 'Warmup Theme A', Volume: 20 },
        { Player: '#2 李二', StartSec: 0, EndSec: '', EmbedURL: 'https://www.youtube.com/embed/QImBolnTVH8?enablejsapi=1&playsinline=1&modestbranding=1&rel=0', Title: 'Entrance Anthem', Volume: 20 },
      ];
      return of(mock);
    }

    return this.http.get<IncomingRow[]>(this.endpoint).pipe(
      map(rows =>
        rows
          .map(r => ({
            Player: String(r.Player ?? r['Player'] ?? ''),
            StartSec: Number(r.StartSec ?? r['StartSec'] ?? 0),
            EndSec: (r.EndSec ?? r['EndSec'] ?? '') === '' ? '' : Number(r.EndSec ?? r['EndSec']),
            EmbedURL: String(r.EmbedURL ?? r['EmbedURL'] ?? ''),
            Title: String(r.Title ?? r['Title'] ?? ''),
            Volume: r['Volume'] != null ? Number(r['Volume']) : undefined
          }))
      )
    );
  }

  saveVolume(videoId: string, volume: number) {
    const url = `${this.endpoint}?action=setVolume&player=${encodeURIComponent(videoId)}&volume=${volume}`;
    return this.http.get(url, { responseType: 'text' });
  }
}
