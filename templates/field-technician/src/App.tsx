import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AdminPage } from '@/pages/AdminPage';
import { AuthPage } from '@/components/AuthPage';
import { useAuth } from '@/hooks/AuthContext';
import { useUserProfile } from '@/hooks/useUserProfile';
import { AuthCallback } from '@/pages/AuthCallback.tsx';
import { CreateJob } from '@/pages/CreateJob';
import { CustomerLookup } from '@/pages/CustomerLookup';
import { DispatcherDashboard } from '@/pages/DispatcherDashboard';
import { JobDetailPage } from '@/pages/JobDetail';
import { ProfileSetup } from '@/pages/ProfileSetup';
import { TechnicianDashboard } from '@/pages/TechnicianDashboard';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/auth" replace />;
  }

  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function RoleRedirect() {
  const { profile, loading } = useUserProfile();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading profile...</div>
      </div>
    );
  }

  if (!profile) {
    return <Navigate to="/profile-setup" replace />;
  }

  if (profile.role === 'technician') {
    return <Navigate to="/technician" replace />;
  }

  return <Navigate to="/dispatcher" replace />;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route
          path="/auth"
          element={
            <PublicRoute>
              <AuthPage />
            </PublicRoute>
          }
        />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <RoleRedirect />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile-setup"
          element={
            <ProtectedRoute>
              <ProfileSetup />
            </ProtectedRoute>
          }
        />
        <Route
          path="/technician"
          element={
            <ProtectedRoute>
              <TechnicianDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/technician/jobs/:id"
          element={
            <ProtectedRoute>
              <JobDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatcher"
          element={
            <ProtectedRoute>
              <DispatcherDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatcher/jobs/new"
          element={
            <ProtectedRoute>
              <CreateJob />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatcher/jobs/:id"
          element={
            <ProtectedRoute>
              <JobDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatcher/customers"
          element={
            <ProtectedRoute>
              <CustomerLookup />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute>
              <AdminPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
