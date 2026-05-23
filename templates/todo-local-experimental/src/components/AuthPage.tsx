import { useState } from 'react';

import { useAuth } from '@/hooks/AuthContext';

const msLogo = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 21 21"
    className="mr-2"
  >
    <rect x="1" y="1" width="9" height="9" fill="#f25022" />
    <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
    <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
    <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
  </svg>
);

function FabricAuthPage() {
  const { signIn } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSignIn = async () => {
    setError(null);
    setIsLoading(true);
    try {
      await signIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign in.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleSignIn}
        disabled={isLoading}
        className="flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-3 text-sm font-medium text-white shadow-md shadow-blue-600/25 transition-all hover:shadow-lg hover:shadow-blue-600/30 hover:brightness-110 disabled:opacity-50 disabled:shadow-none"
      >
        {msLogo}
        {isLoading ? 'Opening Fabric...' : 'Sign in with Microsoft'}
      </button>
      {error && (
        <p className="mt-3 text-center text-sm text-red-600">{error}</p>
      )}
    </>
  );
}

function PasswordAuthPage() {
  const { signIn, signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const credentials = { email, password };
      if (isSignUp) {
        await signUp(credentials);
      } else {
        await signIn(credentials);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label
            htmlFor="password"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <button
          type="submit"
          disabled={isLoading}
          className="flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-3 text-sm font-medium text-white shadow-md shadow-blue-600/25 transition-all hover:shadow-lg hover:shadow-blue-600/30 hover:brightness-110 disabled:opacity-50 disabled:shadow-none"
        >
          {isLoading
            ? isSignUp
              ? 'Creating account...'
              : 'Signing in...'
            : isSignUp
              ? 'Create account'
              : 'Sign in'}
        </button>
      </form>

      {error && (
        <p className="mt-3 text-center text-sm text-red-600">{error}</p>
      )}

      <p className="mt-4 text-center text-sm text-gray-500">
        {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
        <button
          type="button"
          onClick={() => {
            setIsSignUp(!isSignUp);
            setError(null);
          }}
          className="font-medium text-blue-600 hover:text-blue-500"
        >
          {isSignUp ? 'Sign in' : 'Create one'}
        </button>
      </p>
    </>
  );
}

export function AuthPage() {
  const { authMode } = useAuth();

  return (
    <div className="relative min-h-screen flex flex-col overflow-hidden bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      {/* Decorative background shapes */}
      <div className="pointer-events-none absolute -top-24 -right-24 h-96 w-96 rounded-full bg-blue-100/50 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -left-32 h-[500px] w-[500px] rounded-full bg-indigo-100/40 blur-3xl" />

      <div className="relative flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="rounded-3xl border border-white/60 bg-white/80 p-8 shadow-xl backdrop-blur-sm">
            <div className="mb-8 text-center">
              <h1 className="text-2xl font-bold text-gray-900">Todo App</h1>
              <p className="mt-2 text-sm text-gray-500">
                Sign in to get started.
              </p>
            </div>

            {authMode === 'fabric' ? <FabricAuthPage /> : <PasswordAuthPage />}
          </div>
        </div>
      </div>
    </div>
  );
}
