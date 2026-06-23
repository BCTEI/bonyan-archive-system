import { Routes } from '@angular/router';
import { LoginComponent } from './components/login/login.component';
import { AppShellComponent } from './components/app-shell/app-shell.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { DocumentGridComponent } from './components/document-grid/document-grid.component';
import { AuditTrailComponent } from './components/audit-trail/audit-trail.component';
import { UserManagementComponent } from './components/user-management/user-management.component';
import { authGuard } from './guards/auth.guard';
import { adminGuard } from './guards/admin.guard';
import { permissionGuard } from './guards/permission.guard';

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
      { path: 'documents/new', component: DocumentGridComponent, canActivate: [permissionGuard], data: { permission: 'canCreateDocument' } },
      { path: 'documents/edit/:id', component: DocumentGridComponent, canActivate: [permissionGuard], data: { permission: 'canEditDocument' } },
      { path: 'audit', component: AuditTrailComponent, canActivate: [permissionGuard], data: { permission: 'canViewAudit' } },
      { path: 'users', component: UserManagementComponent, canActivate: [adminGuard] }
    ]
  },
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  { path: '**', redirectTo: '/login' }
];
