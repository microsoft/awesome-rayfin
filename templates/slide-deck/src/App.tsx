import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AuthPage } from '@/components/AuthPage';
import { useAuth } from '@/hooks/AuthContext';
import { AudiencePage } from '@/pages/AudiencePage';
import { BrowsePage } from '@/pages/BrowsePage';
import { CreateSlideshowPage } from '@/pages/CreateSlideshowPage';
import { HomePage } from '@/pages/HomePage';
import { PresenterPage } from '@/pages/PresenterPage';

function AuthGuard({
  children,
  requireAuth,
}: {
  children: React.ReactNode;
  requireAuth: boolean;
}) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-gray-500 dark:text-gray-400">Loading...</div>
      </div>
    );
  }

  if (requireAuth && !isAuthenticated) return <Navigate to="/auth" replace />;
  if (!requireAuth && isAuthenticated) return <Navigate to="/" replace />;

  return <>{children}</>;
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
          path="/"
          element={
            <AuthGuard requireAuth={true}>
              <HomePage />
            </AuthGuard>
          }
        />
        <Route
          path="/create"
          element={
            <AuthGuard requireAuth={true}>
              <CreateSlideshowPage />
            </AuthGuard>
          }
        />
        <Route
          path="/edit/:slideshowId"
          element={
            <AuthGuard requireAuth={true}>
              <CreateSlideshowPage />
            </AuthGuard>
          }
        />
        <Route
          path="/present/:sessionId"
          element={
            <AuthGuard requireAuth={true}>
              <PresenterPage />
            </AuthGuard>
          }
        />
        <Route
          path="/browse/:slideshowId"
          element={
            <AuthGuard requireAuth={true}>
              <BrowsePage />
            </AuthGuard>
          }
        />
        <Route
          path="/audience/:sessionId"
          element={
            <AuthGuard requireAuth={true}>
              <AudiencePage />
            </AuthGuard>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
