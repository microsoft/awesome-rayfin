import { useState, useEffect } from 'react';

import { ServiceContainer } from '../services/ServiceContainer';

import { ProfileImageUpload } from './ProfileImageUpload';

const COOLDOWN_KEY = 'resendVerificationCooldown';
const COOLDOWN_SECONDS = 30;

interface SignupFormProps {
  onToggleForm: () => void;
}

export function SignupForm({ onToggleForm }: SignupFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [emailVerificationRequired, setEmailVerificationRequired] =
    useState(false);
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendMessage, setResendMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  // Preview is handled inside the ProfileImageUpload; only keep pending file for deferred upload
  const [_, setPendingFile] = useState<File | null>(null);

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

  // TODO: In future iterations, profileImageUrl will be passed to the auth service
  // to associate the uploaded image with the new user account

  const handleResendVerification = async () => {
    if (resendCooldown > 0) {
      setResendMessage({
        type: 'error',
        text: `Please wait ${resendCooldown} seconds before resending.`,
      });
      return;
    }

    setResendMessage(null);
    setResendLoading(true);

    try {
      const result =
        await ServiceContainer.create().authService.resendVerificationEmail(
          email
        );
      setResendMessage({ type: 'success', text: result.message });
      const cooldownEnd = Date.now() + COOLDOWN_SECONDS * 1000;
      localStorage.setItem(COOLDOWN_KEY, cooldownEnd.toString());
      setResendCooldown(COOLDOWN_SECONDS);
    } catch (err) {
      console.error('Resend verification error:', err);
      setResendMessage({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Failed to resend verification email',
      });
    } finally {
      setResendLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    // Basic validation
    if (!email || !password) {
      setError('Email and password are required');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);

    try {
      // Use auth service from ServiceContainer to support both mock and rayfin modes
      const authService = ServiceContainer.create().authService;

      // Sign up the user
      const result = await authService.signUp(email, password);
      setSuccess(true);

      // Check if email verification is required
      setEmailVerificationRequired(!result.emailVerified);

      // Profile image upload is deferred until after first login
      setPendingFile(null);
    } catch (err) {
      console.error('Signup error:', err);
      setError(err instanceof Error ? err.message : 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  // Show success message after signup
  if (success) {
    // If email verification is not required, show simple success message
    if (!emailVerificationRequired) {
      return (
        <div className="p-6 bg-white rounded-lg shadow-md">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 mb-4">
              <svg
                className="w-10 h-10 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              Account Created Successfully!
            </h2>
            <p className="text-gray-600 mb-4">
              Your account has been created for:
            </p>
            <p className="text-lg font-medium text-gray-900 mb-4">{email}</p>
            <p className="text-sm text-gray-600">
              You can now sign in with your credentials.
            </p>
          </div>

          <button
            onClick={onToggleForm}
            className="w-full bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 px-4 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Go to Sign In
          </button>
        </div>
      );
    }

    // Email verification required - show verification instructions
    return (
      <div className="p-6 bg-white rounded-lg shadow-md">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 mb-4">
            <svg
              className="w-10 h-10 text-green-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Account Created!
          </h2>
          <p className="text-gray-600 mb-4">
            We've sent a verification email to:
          </p>
          <p className="text-lg font-medium text-gray-900 mb-4">{email}</p>
          <p className="text-sm text-gray-600">
            Please check your inbox and click the verification link to activate
            your account before signing in.
          </p>
        </div>

        {resendMessage && (
          <div
            className={`p-3 mb-4 text-sm rounded-lg ${
              resendMessage.type === 'success'
                ? 'text-green-700 bg-green-100'
                : 'text-red-700 bg-red-100'
            }`}
          >
            {resendMessage.text}
          </div>
        )}

        <div className="space-y-3">
          <button
            onClick={handleResendVerification}
            disabled={resendLoading || resendCooldown > 0}
            className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-2 px-4 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {resendLoading
              ? 'Resending...'
              : resendCooldown > 0
                ? `Resend in ${resendCooldown}s`
                : 'Resend Verification Email'}
          </button>
          <button
            onClick={onToggleForm}
            className="w-full bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 px-4 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Back to Sign In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold mb-6 text-center">Create Account</h2>

      {error && (
        <div className="p-3 mb-4 text-sm text-red-700 bg-red-100 rounded-lg">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Profile Image Upload */}
        <div className="mb-6">
          <label className="block text-gray-700 font-medium mb-2">
            Profile Image (Optional)
          </label>
          <ProfileImageUpload
            onImageSelected={(file) => {
              setPendingFile(file);
            }}
            className="bg-gray-50 p-4 rounded-lg"
          />
        </div>
        <div className="mb-4">
          <label
            htmlFor="email"
            className="block text-gray-700 font-medium mb-2"
          >
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>

        <div className="mb-4">
          <label
            htmlFor="password"
            className="block text-gray-700 font-medium mb-2"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>

        <div className="mb-6">
          <label
            htmlFor="confirmPassword"
            className="block text-gray-700 font-medium mb-2"
          >
            Confirm Password
          </label>
          <input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 px-4 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
        >
          {loading ? 'Creating Account...' : 'Sign Up'}
        </button>
      </form>

      <div className="mt-4 text-center">
        <button
          onClick={onToggleForm}
          className="text-blue-500 hover:text-blue-700"
        >
          Already have an account? Sign in
        </button>
      </div>
    </div>
  );
}
