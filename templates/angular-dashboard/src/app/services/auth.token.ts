import { InjectionToken } from '@angular/core';

import type { IAuthService } from '../../services/IAuthService';

export const AUTH_SERVICE = new InjectionToken<IAuthService>('AUTH_SERVICE');
