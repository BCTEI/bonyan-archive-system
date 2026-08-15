import { Directive, Input, TemplateRef, ViewContainerRef, effect, inject, signal } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { RolePermissions, getRolePermissions } from '../models/user.model';

@Directive({
  selector: '[appHasPermission]',
  standalone: true
})
export class HasPermissionDirective {
  private templateRef = inject(TemplateRef<unknown>);
  private viewContainer = inject(ViewContainerRef);
  private auth = inject(AuthService);

  private permission = signal<keyof RolePermissions | null>(null);
  private hasView = false;

  @Input({ required: true }) set appHasPermission(value: keyof RolePermissions) {
    this.permission.set(value);
  }

  constructor() {
    effect(() => {
      const key = this.permission();
      const user = this.auth.currentUser();
      if (!key) return;

      const role = user?.role ?? 'employee';
      const perms = getRolePermissions(role);
      const allowed = perms[key];

      if (allowed && !this.hasView) {
        this.viewContainer.createEmbeddedView(this.templateRef);
        this.hasView = true;
      } else if (!allowed && this.hasView) {
        this.viewContainer.clear();
        this.hasView = false;
      }
    });
  }
}
