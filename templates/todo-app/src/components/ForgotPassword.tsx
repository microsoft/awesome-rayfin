import { useState } from 'react';

import { getRayfinClient } from '../services/rayfin/RayfinClientService';

interface ForgotPasswordProps {
  onBackToLogin: () => void;
}

export function ForgotPassword({ onBackToLogin }: ForgotPasswordProps) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const client = getRayfinClient();
      const result = await client.auth.requestPasswordReset(email);

      if (result.success) {
        setSuccess(true);
      } else {
        setError(result.message || 'Failed to send reset email');
      }
    } catch (err: any) {
      console.error('Password reset request error:', err);
      setError(err.message || 'Failed to send reset email. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="p-6 bg-white rounded-lg shadow-md">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 mb-4">
            <svg
              className="w-10 h-10 text-blue-600"
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
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Check Your Email
          </h2>
          <p className="text-gray-600 mb-4">
            If an account exists with <strong>{email}</strong>, we've sent a
            password reset link to that address.
          </p>
          <p className="text-sm text-gray-600">
            Please check your inbox and follow the instructions to reset your
            password.
          </p>
        </div>
        <button
          onClick={onBackToLogin}
          className="w-full bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 px-4 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Back to Sign In
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold mb-2 text-center">Reset Password</h2>
      <p className="text-gray-600 mb-6 text-center text-sm">
        Enter your email address and we'll send you a link to reset your
        password.
      </p>

      {error && (
        <div className="p-3 mb-4 text-sm text-red-700 bg-red-100 rounded-lg">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="mb-6">
          <label
            htmlFor="email"
            className="block text-gray-700 font-medium mb-2"
          >
            Email Address
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="you@example.com"
            required
            disabled={loading}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 px-4 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 mb-3"
        >
          {loading ? 'Sending...' : 'Send Reset Link'}
        </button>

        <button
          type="button"
          onClick={onBackToLogin}
          className="w-full text-gray-600 hover:text-gray-800 text-sm"
        >
          Back to Sign In
        </button>
      </form>
    </div>
  );
}
