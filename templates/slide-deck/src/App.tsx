import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AuthPage } from '@/components/AuthPage';
import { useAuth } from '@/hooks/AuthContext';
import { AudiencePage } from '@/pages/AudiencePage';
import { BrowsePage } from '@/pages/BrowsePage';
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
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
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
