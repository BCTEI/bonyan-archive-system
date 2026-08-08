import { Component, HostListener, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { FolderTreeComponent } from '../folder-tree/folder-tree.component';
import { ToastComponent } from '../toast/toast.component';
import { HeaderComponent } from '../header/header.component';
import { FooterBarComponent } from '../footer-bar/footer-bar.component';
import { AuthService } from '../../services/auth.service';
import { HasPermissionDirective } from '../../directives/has-permission.directive';
import { BarcodeScanService } from '../../services/barcode-scan.service';
import { BarcodeLookupService } from '../../services/barcode-lookup.service';

const MOBILE_BREAKPOINT = 768;
const SIDEBAR_STATE_KEY = 'bonyan_sidebar_open';

@Component({
  selector: 'app-app-shell',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatIconModule,
    FolderTreeComponent,
    ToastComponent,
    HeaderComponent,
    FooterBarComponent,
    HasPermissionDirective
  ],
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.scss'
})
export class AppShellComponent implements OnInit, OnDestroy {
  auth = inject(AuthService);
  router = inject(Router);
  private barcodeScan = inject(BarcodeScanService);
  private barcodeLookup = inject(BarcodeLookupService);
  sidebarOpen = signal(true);
  isMobile = signal(false);
  currentYear = signal(new Date().getFullYear());

  private stopBarcodeScan?: () => void;

  ngOnInit(): void {
    this.updateViewport();
    // Lets a physical barcode scanner open a document's details from anywhere
    // in the app (dashboard, grid, etc.) without the user having to click into
    // a specific field first — see BarcodeScanService for the detection logic.
    this.stopBarcodeScan = this.barcodeScan.start(barcode => {
      void this.barcodeLookup.openByBarcode(barcode);
    });
  }

  ngOnDestroy(): void {
    this.stopBarcodeScan?.();
  }

  @HostListener('window:resize')
  onResize(): void {
    this.updateViewport();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (!this.router.url.includes('/main/dashboard')) {
      this.router.navigate(['/main/dashboard']);
    }
  }

  breadcrumb(): { label: string; link?: string }[] {
    const url = this.router.url.split('?')[0];
    const crumbs: { label: string; link?: string }[] = [{ label: '🏠 الرئيسية', link: '/main/dashboard' }];
    if (url.includes('/documents')) crumbs.push({ label: 'الوثائق' });
    if (url.includes('/audit')) crumbs.push({ label: 'سجل التدقيق' });
    if (url.includes('/users')) crumbs.push({ label: 'إدارة المستخدمين' });
    if (url.includes('/document-types')) crumbs.push({ label: 'أنواع الوثائق' });
    if (url.includes('/master-lists')) crumbs.push({ label: 'القوائم الرئيسية' });
    if (url.includes('/folder-categories')) crumbs.push({ label: 'إدارة التصنيفات' });
    if (url.includes('/security')) crumbs.push({ label: 'مركز الأمان' });
    if (url.includes('/annual-closing')) crumbs.push({ label: 'الجرد السنوي' });
    if (url.includes('/change-password')) crumbs.push({ label: 'تغيير كلمة المرور' });
    if (url.includes('/profile')) crumbs.push({ label: 'الملف الشخصي' });
    return crumbs;
  }

  toggleSidebar(): void {
    this.sidebarOpen.update(v => !v);
    localStorage.setItem(SIDEBAR_STATE_KEY, JSON.stringify(this.sidebarOpen()));
  }

  private updateViewport(): void {
    const mobile = window.innerWidth <= MOBILE_BREAKPOINT;
    const wasMobile = this.isMobile();
    this.isMobile.set(mobile);

    if (mobile) {
      // On mobile the sidebar is an overlay; default to closed
      this.sidebarOpen.set(false);
    } else if (wasMobile && !mobile) {
      // Restore desktop preference when returning to desktop
      this.restoreSidebarState();
    }
  }

  private restoreSidebarState(): void {
    const saved = localStorage.getItem(SIDEBAR_STATE_KEY);
    if (saved) {
      try {
        this.sidebarOpen.set(JSON.parse(saved));
      } catch {
        this.sidebarOpen.set(true);
      }
    } else {
      this.sidebarOpen.set(true);
    }
  }
}
