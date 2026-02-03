import { Component, signal, AfterViewInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CdkDragDrop, DragDropModule, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { LatestService, LatestRow } from '../../core/services/latest.service';
import { CardComponent } from '../../shared/ui/card/card.component';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatSliderModule } from '@angular/material/slider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { FormsModule } from '@angular/forms';
import { MatInputModule } from '@angular/material/input';

declare const YT: any;

@Component({
  standalone: true,
  selector: 'app-lineup',
  imports: [CommonModule, DragDropModule, CardComponent, MatButtonModule, MatListModule, MatProgressSpinnerModule, MatToolbarModule, MatSliderModule, MatFormFieldModule, FormsModule, MatInputModule],
  templateUrl: './lineup.component.html',
  styleUrls: ['./lineup.component.css']
})
export class LineupComponent implements AfterViewInit, OnDestroy {
  // UI 狀態
  mode = signal<'select' | 'list'>('select');
  loading = signal(true);
  error = signal<string | null>(null);

  // 資料
  allPlayers = signal<LatestRow[]>([]);
  starters = signal<LatestRow[]>([]);
  bench = signal<LatestRow[]>([]);
  query = '';
  activeSelect = new Set<string>();
  inActiveSelect = new Set<string>();
  selected = signal<LatestRow[]>([]);
  filteredAll = signal<LatestRow[]>([]);
  filteredSelected = signal<LatestRow[]>([]);

  // 播放狀態
  currentDisplay = signal<string | null>(null);
  paused = signal(false);
  volume = signal(0);

  // YT Player 與片段循環
  private ytPlayer?: any;
  private playerReady = false;
  private pendingToPlay: LatestRow | null = null; // 若使用者太早按播放，就先排隊
  private apiReadyPromise!: Promise<void>;
  private apiReadyResolve!: () => void;

  private segStart = 0;
  private segEnd: number | null | undefined = null;
  private loopTimer: any = null;

  constructor(private latest: LatestService, private cdr: ChangeDetectorRef) {
    this.latest.fetchLatest().subscribe({
    next: rows => {
      this.allPlayers.set(rows);

      // 初次進來 selected 先用 starters+bench 回推（若都空就為空）
      this.rebuildSelectFromLists();

      // 依目前 query 做一次過濾（沒有 query 就顯示全部）
      this.refreshFilters();

      this.loading.set(false);
      // 某些環境（standalone + signals）需要手動推一把
      queueMicrotask(() => this.cdr.detectChanges());
    },
    error: err => {
      this.error.set('載入 Latest 失敗，請稍後再試');
      this.loading.set(false);
    }
    });
  }

  // -------------------------------------
  // Angular 生命週期
  // -------------------------------------
  ngAfterViewInit() {
    // 準備等待 YT IFrame API
    this.apiReadyPromise = new Promise<void>((resolve) => (this.apiReadyResolve = resolve));
    this.ensureYouTubeApiLoaded();
    this.initPlayerWhenApiReady();
  }

  ngOnDestroy(): void {
    this.clearLoopGuard_();
    try { this.ytPlayer?.destroy?.(); } catch {}
  }

  // -------------------------------------
  // 模式切換 / 選人 / 拖拉
  // -------------------------------------
  toggleMode() {
    const was = this.mode() as 'select'|'list';
    const next = was === 'select' ? 'list' : 'select';

    if (was === 'select' && next === 'list') {
      // 使用者要離開選擇模式 → 先套用選擇結果到 starters/bench
      this.applySelectionToLists();
    }

    this.mode.set(next as any);

    if (next === 'select') {
      // 回到選擇模式 → 以目前 starters/bench 重建左右欄狀態
      this.rebuildSelectFromLists();
    }
  }

  private contains(list: LatestRow[], p: LatestRow) {
    return list.some(x => x.Player === p.Player);
  }

  trackByDisplay = (_: number, item: LatestRow) => item.Player;

  togglePlayer(p: LatestRow, checked: boolean) {
    if (checked) {
      // 勾選 → 加入板凳（若已存在任一清單就不重複加入）
      if (!this.contains(this.starters(), p) && !this.contains(this.bench(), p)) {
        this.bench.set([...this.bench(), p]);
      }
    } else {
      if (this.isActive(p)) {
        this.stop();
      }

      this.starters.set(this.starters().filter(x => x.Player !== p.Player));
      this.bench.set(this.bench().filter(x => x.Player !== p.Player));
    }
  }

  drop(event: CdkDragDrop<LatestRow[]>, target: 'starters' | 'bench') {
    let moved: LatestRow | null = null;

    if (event.previousContainer === event.container) {
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
      moved = event.container.data[event.currentIndex] ?? null;
    } else {
      moved = event.previousContainer.data[event.previousIndex] ?? null;
      transferArrayItem(
        event.previousContainer.data,
        event.container.data,
        event.previousIndex,
        event.currentIndex
      );
    }

    const curId = this.currentDisplay();
    if (moved && curId === moved.Player) {
      if (target === 'bench' || !this.starters().some(p => p.Player === curId)) {
        this.stop();
      } else {
        // console.log(`保持播放：${moved.Player} 移動到新的先發位置`);
      }
    }
  }

  isSelected(p: LatestRow) {
    return this.starters().some(x => x.Player === p.Player) || this.bench().some(x => x.Player === p.Player);
  }

  rebuildSelectFromLists() {
    const ids = new Set<string>([
      ...this.starters().map(p => p.Player),
      ...this.bench().map(p => p.Player),
    ]);
    const src = this.allPlayers().filter(p => ids.has(p.Player));
    this.selected.set(src);
    this.refreshFilters();
    this.activeSelect.clear();
    this.inActiveSelect.clear();
  }

  refreshFilters() {
    const q = (this.query || '').trim().toLowerCase();
    const inSelected = new Set(this.selected().map(p => p.Player));

    const all = this.allPlayers().filter(p => !inSelected.has(p.Player));
    const sel = this.selected();

    const hit = (p: LatestRow) => {
      if (!q) return true;
      const s = [
        p.Player ?? p.Player ?? '',
      ].join(' ').toLowerCase();
      return s.includes(q);
    };

    this.filteredAll.set(all.filter(hit));
    this.filteredSelected.set(sel.filter(hit));

    // 清除已不在清單的選取
    this.activeSelect.forEach(id => { if (!all.some(p => p.Player===id)) this.activeSelect.delete(id); });
    this.inActiveSelect.forEach(id => { if (!sel.some(p => p.Player===id)) this.inActiveSelect.delete(id); });
  }

  clearQuery(){ this.query=''; this.refreshFilters(); }

  toggleLeft(p: LatestRow){ this.activeSelect.has(p.Player) ? this.activeSelect.delete(p.Player) : this.activeSelect.add(p.Player); }
  toggleRight(p: LatestRow){ this.inActiveSelect.has(p.Player) ? this.inActiveSelect.delete(p.Player) : this.inActiveSelect.add(p.Player); }
  selectAllLeft(){ this.filteredAll().forEach(p => this.activeSelect.add(p.Player)); }
  clearLeft(){ this.activeSelect.clear(); }

  moveSelectedToRight() {
    if (!this.activeSelect.size) return;
    const ids = this.activeSelect;
    const toAdd = this.filteredAll().filter(p => ids.has(p.Player));
    this.selected.set([...this.selected(), ...toAdd]);
    this.activeSelect.clear();
    this.refreshFilters();
  }

  moveSelectedToLeft() {
    if (!this.inActiveSelect.size) return;
    const ids = this.inActiveSelect;
    this.selected.set(this.selected().filter(p => !ids.has(p.Player)));
    // 若移除了正在播放的人 → 停止
    const cur = this.currentDisplay?.();
    if (cur && !this.selected().some(p => p.Player===cur)) this.stop();
    this.inActiveSelect.clear();
    this.refreshFilters();
  }

  moveAllToRight() {
    const toAdd = this.filteredAll();
    if (!toAdd.length) return;
    this.selected.set([...this.selected(), ...toAdd]);
    this.activeSelect.clear();
    this.refreshFilters();
  }

  moveAllToLeft() {
    const toKeep = new Set(this.filteredSelected().map(p => p.Player));
    this.selected.set(this.selected().filter(p => !toKeep.has(p.Player)));
    const cur = this.currentDisplay?.();
    if (cur && !this.selected().some(p => p.Player===cur)) this.stop();
    this.inActiveSelect.clear();
    this.refreshFilters();
  }

  // 套用到 bench/starters 並返回清單模式
  private applySelectionToLists() {
    const targetIds = new Set(this.selected().map(p => p.Player));

    // 先把不在 target 的移掉
    this.starters.set(this.starters().filter(p => targetIds.has(p.Player)));
    this.bench.set(this.bench().filter(p => targetIds.has(p.Player)));

    // 若播放中的球員不在 target → 停止
    const cur = typeof this.currentDisplay === 'function' ? this.currentDisplay() : this.currentDisplay;
    if (cur && !targetIds.has(cur)) this.stop();

    // 再把缺少的補到板凳（保留現有順序，新增的接在後面）
    const present = new Set<string>([
      ...this.starters().map(p => p.Player),
      ...this.bench().map(p => p.Player),
    ]);
    const toAdd = this.selected().filter(p => !present.has(p.Player));
    if (toAdd.length) this.bench.set([...this.bench(), ...toAdd]);
  }

  // -------------------------------------
  // YouTube IFrame API：載入與初始化
  // -------------------------------------
  /** 確保 IFrame API 已載入；若 index.html 未放 script，這裡會自動補上 */
  private ensureYouTubeApiLoaded() {
    const w = window as any;
    if (w.YT && w.YT.Player) {
      console.log('[YT] API already loaded');
      this.apiReadyResolve();
      return;
    }
    w.onYouTubeIframeAPIReady = () => {
      console.log('[YT] onYouTubeIframeAPIReady');
      this.apiReadyResolve();
    };
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.body.appendChild(s);
    }
  }

  /** 等 API 就緒後建立隱藏 Player（用 div 容器，讓 API 自生 iframe） */
  private async initPlayerWhenApiReady() {
    await this.apiReadyPromise;

    const ensureHostEl = (): Promise<HTMLElement> =>
      new Promise((resolve) => {
        const tryGet = () => {
          const el = document.getElementById('yt-hidden') as HTMLElement | null;
          if (el) return resolve(el);
          setTimeout(tryGet, 50);
        };
        tryGet();
      });

    await ensureHostEl();

    // console.log('[YT] creating player …');
    this.ytPlayer = new YT.Player('yt-hidden', {
      height: '180',
      width: '320',
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
      events: {
        onReady: () => {
          console.log('[YT] player ready');
          this.playerReady = true;
          if (this.pendingToPlay) {
            const p = this.pendingToPlay;
            this.pendingToPlay = null;
            this.play(p);
          }
        },
        onStateChange: (e: any) => {
          // console.log('[YT] state =', e.data);
          if (e.data === YT.PlayerState.ENDED) this.seekToStart_();
        }
      }
    });
  }

  // -------------------------------------
  // 播放控制（段落循環）
  // -------------------------------------
  /** 從小卡點播（或播放下一首） */
  play(p: LatestRow) {
    // 若 Player 未就緒：排隊等待
    if (!this.playerReady || !this.ytPlayer || typeof this.ytPlayer.loadVideoById !== 'function') {
      this.pendingToPlay = p;
      return;
    }

    const vid = this.extractVideoIdFromEmbed(p.EmbedURL || '');
    if (!vid) {
      console.warn('[YT] No video id from', p);
      return;
    }

    this.segStart = Number(p.StartSec || 0);
    this.segEnd = typeof p.EndSec === 'number' ? p.EndSec : undefined;
    // console.log('[YT] loadVideoById', { vid, segStart: this.segStart, segEnd: this.segEnd });
    this.ytPlayer.loadVideoById({
      videoId: vid,
      startSeconds: this.segStart,
      endSeconds: this.segEnd ?? undefined
    });

    // 片段循環保險機制（endSeconds 在某些裝置不準時）
    this.startLoopGuard_();

    this.currentDisplay.set(p.Player);
    this.paused.set(false);
    this.applyVolumeFor(p);
  }

  /** 暫停/繼續 */
  pause() {
    if (this.paused()) {
      this.ytPlayer.playVideo?.();
      this.paused.set(false);
    } else {
      this.ytPlayer.pauseVideo?.();
      this.paused.set(true);
    }
  }

  resume() {
    this.ytPlayer?.playVideo?.();
    this.paused.set(false);
  }

  /** 小卡按鈕的事件：切換或開始播放 */
  onToggle(p: LatestRow) {
    if (this.isActive(p)) {
      if (this.paused()) this.resume(); else this.pause();
    } else {
      this.play(p);
    }
  }

  /** 判斷是否為作用卡 */
  isActive(p: LatestRow) {
    return this.currentDisplay() === p.Player;
  }

  /** 停止播放並清掉輪詢 */
  stop() {
     try {
      if (this.ytPlayer && this.ytPlayer.stopVideo) {
        this.ytPlayer.stopVideo();
      } else if (this.ytPlayer && this.ytPlayer.pauseVideo) {
        this.ytPlayer.pauseVideo();
      }
    } catch (err) {
      console.warn('stopVideo failed', err);
    }
    this.currentDisplay.set(null);
    this.paused.set(false);
    this.volume.set(0);
    this.clearLoopGuard_();
  }

  /** 播放下一首（循環） */
  playNext() {
    const list = this.starters();
    if (!list.length) return;

    const curId = this.currentDisplay();
    if (!curId)
      return this.play(list[0]);

    const idx = list.findIndex(p => p.Player === curId);
    if (idx < 0)
      return this.play(list[0]);
    
    const nextIdx = (idx + 1) % list.length;
    this.play(list[nextIdx]);
  }

  onVolumeChange(v: number) {
    const vol = Math.max(0, Math.min(100, Math.floor(v ?? 0)));
    this.volume.set(vol);
    try {
      this.ytPlayer?.setVolume?.(vol);
      this.ytPlayer?.unMute?.();
    } catch {}

    const cid = this.currentDisplay();
    if (!cid) return;
    const cur = this.starters().find(p => p.Player === cid) ?? this.bench().find(p => p.Player === cid);
    if (!cur) return;

    this.updateLocalVolume(cid, vol);

    this.latest.saveVolume(cur.Player, vol).subscribe({
      next: _ => {},
      error: err => console.warn('saveVolume faildes', err)
    });
  }

  displayOf(id: string | null): string {
    if (!id) return '';
    // 先在先發/板凳找，找不到再回退到所有球員清單
    const hit =
      this.starters().find(p => p.Player === id) ??
      this.bench().find(p => p.Player === id) ??
      this.allPlayers().find(p => p.Player === id);
    return hit?.Player || id;
  }

  isIOSSafari = (() => {
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isSafari = /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(ua);
    return isIOS && isSafari;
  })();

  private applyVolumeFor(p: LatestRow) {
    const vol = (p.Volume ?? 20);
    this.volume.set(vol);
    if (!this.isIOSSafari) {
      try {
        this.ytPlayer?.setVolume?.(vol);
        this.ytPlayer?.unMute?.();
      } catch {}
    }
  }

  private updateLocalVolume(playerId: string, vol: number) {
    const patch = (arr: LatestRow[]) => arr.map(x => x.Player === playerId ? ({ ...x, Volume: vol }) : x);
    this.starters.set(patch(this.starters()));
    this.bench.set(patch(this.bench()));
    this.allPlayers.set(patch(this.allPlayers()));
  }

  // -------------------------------------
  // 片段循環保險（精準在 end 重新跳回 start）
  // -------------------------------------
  private startLoopGuard_() {
    this.clearLoopGuard_();
    if (this.segEnd == null || !this.ytPlayer?.getCurrentTime) return;

    // 每 200ms 檢查；接近 end（提早 0.3s）就 seek 回 start 再播放
    this.loopTimer = setInterval(() => {
      try {
        const t = this.ytPlayer.getCurrentTime?.();
        if (typeof t === 'number' && t >= (this.segEnd! - 0.3)) {
          this.seekToStart_();
        }
      } catch {}
    }, 200);
  }

  private clearLoopGuard_() {
    if (this.loopTimer) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
  }

  private seekToStart_() {
    if (!this.ytPlayer?.seekTo) return;
    this.ytPlayer.seekTo(this.segStart, true);
    this.ytPlayer.playVideo?.();
  }

  // -------------------------------------
  // 小工具
  // -------------------------------------
  /** 從 EmbedURL 萃取 videoId（支援 embed / watch / youtu.be） */
  private extractVideoIdFromEmbed(url: string): string {
    if (!url) return '';
    let m = url.match(/\/embed\/([a-zA-Z0-9_-]{6,})/); if (m) return m[1];
    m = url.match(/[?&]v=([a-zA-Z0-9_-]{6,})/); if (m) return m[1];
    m = url.match(/youtu\.be\/([a-zA-Z0-9_-]{6,})/); if (m) return m[1];
    return '';
  }
}
