import { Routes } from '@angular/router';
import { LoginComponent } from './components/login/login.component';
import { AppShellComponent } from './components/app-shell/app-shell.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { DocumentGridComponent } from './components/document-grid/document-grid.component';
import { AuditTrailComponent } from './components/audit-trail/audit-trail.component';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  {
    path: 'main',
    component: AppShellComponent,
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      { path: 'dashboard', component: DashboardComponent },
      { path: 'documents', component: DocumentGridComponent },
      { path: 'audit', component: AuditTrailComponent }
    ]
  },
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  { path: '**', redirectTo: '/login' }
];
