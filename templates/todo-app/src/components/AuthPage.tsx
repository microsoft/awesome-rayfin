import { useState, useEffect } from 'react';

import { useAuthSettings } from '../hooks/AuthSettingsContext';

import { FabricLoginButton } from './FabricLoginButton';
import { ForgotPassword } from './ForgotPassword';
import { LoginForm } from './LoginForm';
import { MagicLinkForm } from './MagicLinkForm';
import { ResetPassword } from './ResetPassword';
import { SignupForm } from './SignupForm';

type AuthView =
  | 'login'
  | 'signup'
  | 'forgot-password'
  | 'reset-password'
  | 'magic-link';

export function AuthPage() {
  const {
    isPasswordAuthAvailable,
    isMagicLinkAuthAvailable,
    isFabricAuthAvailable,
    loading,
  } = useAuthSettings();

  const [currentView, setCurrentView] = useState<AuthView>('login');
  const [resetToken, setResetToken] = useState<string | null>(null);

  // Update default view when auth settings are loaded
  useEffect(() => {
    if (!loading) {
      // Show login if password auth is available, otherwise magic link if available
      if (isPasswordAuthAvailable) {
        setCurrentView('login');
      } else if (isMagicLinkAuthAvailable) {
        setCurrentView('magic-link');
      }
    }
  }, [loading, isPasswordAuthAvailable, isMagicLinkAuthAvailable]);

  // Check for password reset token in URL on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('resetToken');
    if (token && isPasswordAuthAvailable) {
      setResetToken(token);
      setCurrentView('reset-password');
    }
  }, [isPasswordAuthAvailable]);

  const handleBackToLogin = () => {
    if (isPasswordAuthAvailable) {
      setCurrentView('login');
    } else if (isMagicLinkAuthAvailable) {
      setCurrentView('magic-link');
    }
    setResetToken(null);
    // Clear reset token from URL if present
    if (window.location.search.includes('resetToken')) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  };

  const toggleSignup = () => {
    setCurrentView(currentView === 'signup' ? 'login' : 'signup');
  };

  const showForgotPassword = () => {
    setCurrentView('forgot-password');
  };

  const showMagicLink = () => {
    setCurrentView('magic-link');
  };

  const showPasswordLogin = () => {
    setCurrentView('login');
  };

  // Show loading state while fetching auth settings
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col justify-start items-center bg-gray-50 pt-16">
        <div className="max-w-md w-full text-center">
          <div className="animate-pulse text-gray-500">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col justify-start items-center bg-gray-50 pt-16">
      <div className="max-w-md w-full">
        {/* Password-based authentication views */}
        {isPasswordAuthAvailable && currentView === 'signup' && (
          <SignupForm onToggleForm={toggleSignup} />
        )}
        {isPasswordAuthAvailable && currentView === 'login' && (
          <LoginForm
            onToggleForm={toggleSignup}
            onForgotPassword={showForgotPassword}
            onMagicLink={isMagicLinkAuthAvailable ? showMagicLink : undefined}
            fabricButton={
              isFabricAuthAvailable ? <FabricLoginButton /> : undefined
            }
          />
        )}
        {isPasswordAuthAvailable && currentView === 'forgot-password' && (
          <ForgotPassword onBackToLogin={handleBackToLogin} />
        )}
        {isPasswordAuthAvailable &&
          currentView === 'reset-password' &&
          resetToken && (
            <ResetPassword
              token={resetToken}
              onBackToLogin={handleBackToLogin}
            />
          )}

        {/* Magic link authentication */}
        {isMagicLinkAuthAvailable && currentView === 'magic-link' && (
          <MagicLinkForm
            onBackToLogin={
              isPasswordAuthAvailable ? showPasswordLogin : undefined
            }
            fabricButton={
              isFabricAuthAvailable ? <FabricLoginButton /> : undefined
            }
          />
        )}
      </div>
    </div>
  );
}
