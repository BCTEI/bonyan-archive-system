import { Routes } from '@angular/router';
import { LoginComponent } from './components/login/login.component';
import { AppShellComponent } from './components/app-shell/app-shell.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { DocumentGridComponent } from './components/document-grid/document-grid.component';
import { AuditTrailComponent } from './components/audit-trail/audit-trail.component';
import { UserManagementComponent } from './components/user-management/user-management.component';
import { SecurityCenterComponent } from './components/security-center/security-center.component';
import { DocumentTypeManagementComponent } from './components/document-type-management/document-type-management.component';
import { FolderCategoryManagementComponent } from './components/folder-category-management/folder-category-management.component';
import { AnnualClosingComponent } from './components/annual-closing/annual-closing.component';
import { ChangePasswordComponent } from './components/change-password/change-password.component';
import { UserProfileComponent } from './components/user-profile/user-profile.component';
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
      { path: 'users', component: UserManagementComponent, canActivate: [adminGuard] },
      { path: 'document-types', component: DocumentTypeManagementComponent, canActivate: [adminGuard] },
      { path: 'folder-categories', component: FolderCategoryManagementComponent, canActivate: [adminGuard] },
      { path: 'security', component: SecurityCenterComponent, canActivate: [adminGuard] },
      { path: 'annual-closing', component: AnnualClosingComponent, canActivate: [adminGuard] },
      { path: 'change-password', component: ChangePasswordComponent },
      { path: 'profile', component: UserProfileComponent }
    ]
  },
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  { path: '**', redirectTo: '/login' }
];
