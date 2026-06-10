import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';

import { AuthState } from '../../services/auth-state';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-auth',
  imports: [
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  template: `
    <div class="auth-page">
      <button
        mat-icon-button
        class="theme-toggle"
        (click)="theme.toggle()"
        [matTooltip]="
          theme.theme() === 'dark' ? 'Switch to light' : 'Switch to dark'
        "
        aria-label="Toggle theme"
      >
        <mat-icon>
          {{ theme.theme() === 'dark' ? 'light_mode' : 'dark_mode' }}
        </mat-icon>
      </button>

      <mat-card appearance="outlined" class="auth-card">
        <mat-card-header>
          <mat-card-title>Blank App</mat-card-title>
          <mat-card-subtitle>Sign in to get started.</mat-card-subtitle>
        </mat-card-header>
        <mat-card-content>
          <button
            mat-flat-button
            color="primary"
            class="sign-in"
            [disabled]="authState.loading()"
            (click)="signIn()"
          >
            <span class="sign-in-content">
              @if (authState.loading()) {
                <mat-spinner diameter="18" />
              } @else {
                <mat-icon>login</mat-icon>
              }
              <span>{{ buttonLabel }}</span>
            </span>
          </button>
          @if (authState.error(); as message) {
            <p class="error">{{ message }}</p>
          }
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: `
    .auth-page {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
      position: relative;
    }
    .theme-toggle {
      position: absolute;
      top: 1rem;
      right: 1rem;
    }
    .auth-card {
      width: 100%;
      max-width: 22rem;
    }
    .sign-in {
      width: 100%;
      margin-top: 1rem;
    }
    .sign-in-content {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      justify-content: center;
    }
    .error {
      color: var(--mat-sys-error);
      text-align: center;
      font-size: 0.875rem;
      margin: 0.75rem 0 0;
    }
  `,
})
export class Auth {
  protected readonly authState = inject(AuthState);
  protected readonly theme = inject(ThemeService);
  private readonly router = inject(Router);

  protected get buttonLabel(): string {
    if (this.authState.loading()) {
      return this.authState.fabricAuthEnabled
        ? 'Opening Fabric…'
        : 'Signing in…';
    }
    return this.authState.fabricAuthEnabled
      ? 'Sign in with Microsoft Fabric'
      : 'Sign in';
  }

  protected async signIn(): Promise<void> {
    try {
      await this.authState.signIn();
    } catch {
      // Surfaced via authState.error()
      return;
    }
    const ok = await this.router.navigateByUrl('/');
    if (!ok) {
      this.authState.error.set(
        'Signed in, but routing was blocked. Reload the page to continue.'
      );
    }
  }
}
