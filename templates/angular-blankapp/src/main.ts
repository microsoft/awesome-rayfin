import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideAppInitializer, inject } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';

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
    { provide: AUTH_SERVICE, useFactory: () => bootstrapAuth() },
    provideAppInitializer(() => {
      const authState = inject(AuthState);
      // Restore the session before routing kicks in. Errors and "not signed
      // in" are non-fatal — the guards handle redirection from there.
      return authState.restoreSession();
    }),
  ],
}).catch((err) => console.error(err));
