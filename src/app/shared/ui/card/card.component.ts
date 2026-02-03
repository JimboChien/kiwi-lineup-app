import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DragDropModule } from '@angular/cdk/drag-drop';
import type { LatestRow } from '../../../core/services/latest.service';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';

@Component({
  standalone: true,
  selector: 'app-card',
  imports: [CommonModule, DragDropModule, MatCardModule, MatButtonModule],
  templateUrl: './card.component.html',
  styleUrls: ['./card.component.css']
})
export class CardComponent {
  @Input() player!: LatestRow;
  @Input() canDrag = true;

   /** 是否為目前「被選取的那張」（正在播或暫停中） */
  @Input() active = false;
  /** 若為 active，是否為暫停狀態 */
  @Input() paused = false;

  @Output() toggle = new EventEmitter<LatestRow>();

  onToggle() { this.toggle.emit(this.player); }

}
