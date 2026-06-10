import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideAppInitializer, inject } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';

import { App } from './app/app';
import { routes } from './app/app.routes';
import { AuthState } from './app/services/auth-state';
import { AUTH_SERVICE } from './app/services/auth.token';
import { bootstrapAuth } from './services/bootstrap';

bootstrapApplication(App, {
  providers: [
    provideRouter(routes),
    provideAnimationsAsync(),
    provideHttpClient(withFetch()),
    // Chart.js v4 dropped auto-registration of controllers/scales. Register
    // the defaults once at bootstrap so any `<canvas baseChart>` works.
    provideCharts(withDefaultRegisterables()),
    { provide: AUTH_SERVICE, useFactory: () => bootstrapAuth() },
    provideAppInitializer(async () => {
      const authState = inject(AuthState);
      // Restore the session before routing kicks in. Errors and "not signed
      // in" are non-fatal — the guards handle redirection from there.
      // AppConfig is loaded lazily by `setupGuard` (off the auth gate), so a
      // failed load can't block bootstrap.
      await authState.restoreSession();
    }),
  ],
}).catch((err) => console.error(err));
