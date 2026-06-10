import type { Routes } from '@angular/router';

import { authGuard, noAuthGuard } from './auth.guard';
import { setupGuard } from './setup.guard';

export const routes: Routes = [
  {
    path: 'auth',
    canActivate: [noAuthGuard],
    loadComponent: () => import('./pages/auth/auth').then((m) => m.Auth),
  },
  {
    path: 'setup',
    canActivate: [authGuard, setupGuard],
    loadComponent: () => import('./pages/setup/setup').then((m) => m.Setup),
  },
  {
    path: '',
    canActivate: [authGuard, setupGuard],
    loadComponent: () => import('./shell/shell').then((m) => m.Shell),
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () =>
          import('./pages/dashboard/dashboard').then((m) => m.Dashboard),
      },
      {
        path: 'projects',
        loadComponent: () =>
          import('./pages/projects/projects-list').then((m) => m.ProjectsList),
      },
      {
        path: 'projects/:id',
        loadComponent: () =>
          import('./pages/projects/project-detail').then((m) => m.ProjectDetail),
      },
      {
        path: 'tasks',
        loadComponent: () =>
          import('./pages/tasks/tasks-list').then((m) => m.TasksList),
      },
      {
        path: 'tasks/:id',
        loadComponent: () =>
          import('./pages/tasks/task-detail').then((m) => m.TaskDetail),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./pages/settings/settings').then((m) => m.Settings),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];

