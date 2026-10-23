import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AuthPage } from '@/components/AuthPage';
import { useAuth } from '@/hooks/AuthContext';
import { useT } from '@/i18n';
import { UmLayout } from '@/um/components/UmLayout';
import { UM_PATHS } from '@/um/domain/profile';
import { UmProvider } from '@/um/hooks/UmContext';
import { umRouteElements } from '@/um/UmRoutes';

function Loading() {
  const t = useT();
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-gray-500">{t('common.loading')}</div>
    </div>
  );
}

function AuthGuard({ children, requireAuth }: { children: React.ReactNode; requireAuth: boolean }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) return <Loading />;
  if (requireAuth && !isAuthenticated) return <Navigate to="/auth" replace />;
  if (!requireAuth && isAuthenticated) return <Navigate to="/" replace />;

  return <>{children}</>;
}

/** The four tabs: workspaces, audiences, RLS/OLS and the Power BI Guidelines, plus Setup for app admins. */
function UserManager() {
  return (
    <UmProvider>
      <Routes>
        <Route element={<UmLayout />}>{umRouteElements()}</Route>
        <Route path="*" element={<Navigate to={UM_PATHS.workspaces} replace />} />
      </Routes>
    </UmProvider>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/auth"
          element={
            <AuthGuard requireAuth={false}>
              <AuthPage />
            </AuthGuard>
          }
        />
        <Route
          path="*"
          element={
            <AuthGuard requireAuth={true}>
              <UserManager />
            </AuthGuard>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
