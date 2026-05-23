import { useState, useEffect, ReactNode } from 'react';

import { useAuth } from '../hooks/AuthContext';
import { ServiceContainer } from '../services/ServiceContainer';

interface LoginFormProps {
  onToggleForm: () => void;
  onForgotPassword: () => void;
  onMagicLink?: () => void;
  fabricButton?: ReactNode;
}

const COOLDOWN_KEY = 'resendVerificationCooldown';
const COOLDOWN_SECONDS = 30;

export function LoginForm({
  onToggleForm,
  onForgotPassword,
  onMagicLink,
  fabricButton,
}: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const { login, loading, error } = useAuth();

  // Initialize cooldown from localStorage on mount
  useEffect(() => {
    const cooldownEnd = localStorage.getItem(COOLDOWN_KEY);
    if (cooldownEnd) {
      const remaining = Math.max(
        0,
        Math.floor((parseInt(cooldownEnd) - Date.now()) / 1000)
      );
      if (remaining > 0) {
        setResendCooldown(remaining);
      } else {
        localStorage.removeItem(COOLDOWN_KEY);
      }
    }
  }, []);

  // Cooldown timer effect
  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => {
        const newCooldown = resendCooldown - 1;
        setResendCooldown(newCooldown);
        if (newCooldown === 0) {
          localStorage.removeItem(COOLDOWN_KEY);
        }
      }, 1000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [resendCooldown]);

  const handleResendVerification = async () => {
    if (!email) {
      setResendMessage('Please enter your email address first.');
      return;
    }

    if (resendCooldown > 0) {
      setResendMessage(
        `Please wait ${resendCooldown} seconds before resending.`
      );
      return;
    }

    setResendMessage(null);
    setResendLoading(true);

    try {
      const result =
        await ServiceContainer.create().authService.resendVerificationEmail(
          email
        );
      setResendMessage(result.message);
      const cooldownEnd = Date.now() + COOLDOWN_SECONDS * 1000;
      localStorage.setItem(COOLDOWN_KEY, cooldownEnd.toString());
      setResendCooldown(COOLDOWN_SECONDS);
    } catch (err) {
      console.error('Resend verification error:', err);
      setResendMessage(
        err instanceof Error
          ? err.message
          : 'Failed to resend verification email'
      );
    } finally {
      setResendLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('LoginForm: Starting login process...');
    try {
      const result = await login(email, password);
      console.log('LoginForm: Login completed successfully, result:', result);
      // Login success - useAuth hook will handle the state update and UI refresh
    } catch (err) {
      console.error('LoginForm: Login failed:', err);
      // Error handled in useAuth hook
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-start items-center bg-gray-50 pt-16">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Sign in to Todo App
          </h2>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              <p>{error}</p>
              {error.toLowerCase().includes('verify your email') && (
                <button
                  type="button"
                  onClick={handleResendVerification}
                  disabled={resendLoading || resendCooldown > 0}
                  className="mt-2 text-sm text-blue-600 hover:text-blue-800 underline disabled:opacity-50"
                >
                  {resendLoading
                    ? 'Resending...'
                    : resendCooldown > 0
                      ? `Resend in ${resendCooldown}s`
                      : 'Resend verification email'}
                </button>
              )}
            </div>
          )}
          {resendMessage && (
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">
              {resendMessage}
            </div>
          )}
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-700"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-white text-gray-900 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              required
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-gray-700"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-white text-gray-900 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              required
            />
            <div className="mt-1 text-right">
              <button
                type="button"
                onClick={onForgotPassword}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                Forgot password?
              </button>
            </div>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        {/* Divider with magic link option */}
        {onMagicLink && (
          <>
            <div className="mt-6 relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-gray-50 text-gray-500">
                  Or continue with
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={onMagicLink}
              className="mt-4 w-full flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              <svg
                className="w-5 h-5 mr-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
              Sign in with magic link
            </button>
          </>
        )}

        {fabricButton && (
          <>
            <div className="mt-6 relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-gray-50 text-gray-500">
                  Or continue with
                </span>
              </div>
            </div>
            <div className="mt-4">{fabricButton}</div>
          </>
        )}

        <div className="mt-4 text-center">
          <button
            onClick={onToggleForm}
            className="text-blue-500 hover:text-blue-700"
          >
            Need an account? Sign up
          </button>
        </div>
      </div>
    </div>
  );
}
