import { Routes } from '@angular/router';
import { LineupComponent } from './features/lineup/lineup.component';
import { AboutComponent } from './features/about/about.component';

export const routes: Routes = [
  { path: '', redirectTo: 'lineup', pathMatch: 'full' },
  { path: 'lineup', component: LineupComponent },
  { path: 'about', component: AboutComponent },
];
