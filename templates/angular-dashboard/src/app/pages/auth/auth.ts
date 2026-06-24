import { Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';

import { AuthState } from '../../services/auth-state';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-auth',
  imports: [MatIconModule, MatProgressSpinnerModule, MatTooltipModule],
  template: `
    <div class="stage">
      <div class="grain"></div>
      <div class="glow"></div>

      <header class="brand-row">
        <div class="brand">
          <span class="brand__mark" aria-hidden="true">
            <mat-icon>work</mat-icon>
          </span>
          <span class="brand__name">Atelier</span>
        </div>

        <button
          type="button"
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
      </header>

      <main class="hero">
        <p class="eyebrow">Project &amp; task workspace</p>
        <h1 class="hero__title">
          Where <em>work</em> takes<br />
          its proper shape.
        </h1>
        <p class="hero__lead">
          A quiet, considered place for projects and the work they hold.
          Sign in to continue.
        </p>

        <div class="hero__action">
          <button
            type="button"
            class="signin"
            [disabled]="authState.loading()"
            (click)="signIn()"
          >
            <span class="signin__face">
              @if (authState.loading()) {
                <mat-spinner diameter="16" strokeWidth="2" />
              } @else {
                <mat-icon class="signin__icon">arrow_forward</mat-icon>
              }
              <span class="signin__label">{{ buttonLabel }}</span>
            </span>
            <span class="signin__glow"></span>
          </button>

          @if (authState.error(); as message) {
            <p class="error">
              <mat-icon class="error__icon">error_outline</mat-icon>
              <span>{{ message }}</span>
            </p>
          }
        </div>
      </main>

      <footer class="meta">
        <span>© Atelier {{ year }}</span>
        <span class="meta__dot">·</span>
        <span>Built on Rayfin</span>
      </footer>
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100vh;
    }

    .stage {
      position: relative;
      min-height: 100vh;
      padding: 2.5rem 2rem 2rem;
      display: grid;
      grid-template-rows: auto 1fr auto;
      gap: 2rem;
      overflow: hidden;
      isolation: isolate;
    }

    /* Layered ambient effects */
    .glow {
      position: absolute;
      inset: -10rem -10rem auto auto;
      width: 45rem;
      height: 45rem;
      background: radial-gradient(
        circle,
        rgba(212, 255, 58, 0.18),
        rgba(212, 255, 58, 0) 60%
      );
      filter: blur(20px);
      z-index: -2;
      animation: drift 18s var(--ease-in-out) infinite alternate;
      pointer-events: none;
    }

    @keyframes drift {
      from {
        transform: translate(0, 0) scale(1);
      }
      to {
        transform: translate(-3rem, 2rem) scale(1.05);
      }
    }

    .grain {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: -1;
      opacity: 0.5;
      mix-blend-mode: overlay;
      background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='1.2' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.16 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
    }

    /* Brand row (logo + theme toggle) */
    .brand-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      color: var(--cream);
    }

    .theme-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2.25rem;
      height: 2.25rem;
      background: transparent;
      color: var(--cream-muted);
      border: 1px solid var(--ink-border-soft);
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: color var(--d-1) var(--ease-out),
        border-color var(--d-1) var(--ease-out);
    }

    .theme-toggle:hover {
      color: var(--accent);
      border-color: var(--accent-border);
    }

    .theme-toggle mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .brand__mark {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.75rem;
      height: 1.75rem;
      flex-shrink: 0;
      color: var(--lime-on);
      background: var(--lime);
      border-radius: 7px;
      box-shadow: 0 0 0 1px rgba(212, 255, 58, 0.4),
        0 6px 16px -4px var(--accent-glow);
    }

    .brand__mark mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .brand__name {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 96, 'SOFT' 50, 'wght' 500;
      font-size: 1.375rem;
      letter-spacing: -0.02em;
    }

    /* Hero */
    .hero {
      max-width: 56rem;
      margin: 0 auto;
      align-self: center;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
      animation: rise 700ms var(--ease-out) both;
    }

    @keyframes rise {
      from {
        opacity: 0;
        transform: translateY(12px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .hero__title {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 144, 'SOFT' 30, 'wght' 400;
      font-size: clamp(2.75rem, 7vw, 5.5rem);
      line-height: 0.98;
      letter-spacing: -0.04em;
      color: var(--cream);
      margin: 0;
    }

    .hero__title em {
      font-style: italic;
      font-variation-settings: 'opsz' 144, 'SOFT' 90, 'wght' 400;
      color: var(--accent);
      /* Italic Fraunces terminals overshoot their bounding box; add
       * breathing room so the next word doesn't visually kiss them. */
      padding-right: 0.18em;
    }

    .hero__lead {
      font-size: 1.0625rem;
      line-height: 1.55;
      color: var(--cream-muted);
      max-width: 32rem;
    }

    .hero__action {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      margin-top: 0.5rem;
    }

    /* Sign-in button — pill with lime accent + traveling glow */
    .signin {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: flex-start;
      gap: 0;
      height: 3.5rem;
      padding: 0 1.75rem 0 1.5rem;
      background: var(--accent);
      color: var(--ink-bg);
      border: none;
      border-radius: var(--radius-pill);
      cursor: pointer;
      font-family: var(--font-sans);
      font-size: 1.0625rem;
      font-weight: 600;
      letter-spacing: -0.01em;
      width: max-content;
      max-width: 100%;
      overflow: hidden;
      isolation: isolate;
      box-shadow: 0 0 0 0 var(--accent-glow), 0 20px 50px -20px rgba(212, 255, 58, 0.4);
      transition: transform var(--d-2) var(--ease-out),
        box-shadow var(--d-2) var(--ease-out);
    }

    .signin:hover:not([disabled]) {
      transform: translateY(-1px);
      box-shadow: 0 0 0 4px var(--accent-soft),
        0 24px 60px -16px rgba(212, 255, 58, 0.5);
    }

    .signin:active:not([disabled]) {
      transform: translateY(0);
    }

    .signin[disabled] {
      opacity: 0.7;
      cursor: progress;
    }

    .signin__face {
      position: relative;
      z-index: 1;
      display: inline-flex;
      align-items: center;
      gap: 0.75rem;
    }

    .signin__icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      transition: transform var(--d-2) var(--ease-out);
    }

    .signin:hover:not([disabled]) .signin__icon {
      transform: translateX(3px);
    }

    .signin__glow {
      position: absolute;
      inset: 0;
      background: linear-gradient(
        90deg,
        transparent,
        rgba(255, 255, 255, 0.4),
        transparent
      );
      transform: translateX(-100%);
      transition: transform 700ms var(--ease-out);
      pointer-events: none;
    }

    .signin:hover:not([disabled]) .signin__glow {
      transform: translateX(100%);
    }

    .signin .mat-mdc-progress-spinner {
      --mat-progress-spinner-active-indicator-color: var(--ink-bg);
    }

    /* Error message */
    .error {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      background: var(--rose-soft);
      color: var(--rose);
      border: 1px solid rgba(251, 113, 133, 0.25);
      border-radius: var(--radius-md);
      font-family: var(--font-mono);
      font-size: var(--text-small);
      line-height: 1.45;
      max-width: 36rem;
      white-space: pre-line;
    }

    .error__icon {
      flex-shrink: 0;
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    /* Meta footer */
    .meta {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-family: var(--font-mono);
      font-size: var(--text-caption);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--cream-dim);
    }

    .meta__dot {
      opacity: 0.5;
    }
  `,
})
export class Auth {
  protected readonly authState = inject(AuthState);
  protected readonly theme = inject(ThemeService);
  private readonly router = inject(Router);
  protected readonly year = new Date().getFullYear();

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
