import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';

import { AuthState } from '../../services/auth-state';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-home',
  imports: [MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    <div class="home">
      <div class="home__actions">
        <button
          mat-icon-button
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
        <button
          mat-icon-button
          aria-label="Sign out"
          matTooltip="Sign out"
          (click)="signOut()"
        >
          <mat-icon>logout</mat-icon>
        </button>
      </div>
      <h1>Hello, World.</h1>
      <p class="subtitle">I am a Blank App.</p>
    </div>
  `,
  styles: `
    .home {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
      position: relative;
    }
    .home__actions {
      position: absolute;
      top: 1rem;
      right: 1rem;
      display: flex;
      gap: 0.25rem;
    }
    h1 {
      font-size: clamp(2.5rem, 8vw, 4rem);
      font-weight: 700;
      letter-spacing: -0.025em;
      margin: 0;
    }
    .subtitle {
      color: var(--mat-sys-on-surface-variant);
      margin: 0.5rem 0 0;
      font-weight: 300;
    }
  `,
})
export class Home {
  protected readonly theme = inject(ThemeService);
  private readonly authState = inject(AuthState);
  private readonly router = inject(Router);

  protected async signOut(): Promise<void> {
    await this.authState.signOut();
    await this.router.navigate(['/auth']);
  }
}
