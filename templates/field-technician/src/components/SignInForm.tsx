import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

const apiUrl = import.meta.env.VITE_RAYFIN_API_URL || 'http://localhost:5168';
const isLocalEnvironment =
  new URL(apiUrl).hostname === 'localhost' ||
  new URL(apiUrl).hostname === '127.0.0.1';

interface SignInFormProps {
  className?: string;
  onFabricSignIn?: () => Promise<unknown>;
  onPasswordSignIn?: (email: string, password: string) => Promise<unknown>;
  localOnly?: boolean;
}

export function SignInForm({
  className,
  onFabricSignIn,
  onPasswordSignIn,
  localOnly,
}: SignInFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function handleFabricSignIn() {
    setError(null);
    setIsLoading(true);

    try {
      await onFabricSignIn?.();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to sign in with Fabric.'
      );
      setIsLoading(false);
    }
  }

  async function handlePasswordSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (!onPasswordSignIn) return;

    setError(null);
    setIsLoading(true);

    try {
      await onPasswordSignIn(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign in.');
      setIsLoading(false);
    }
  }

  if (localOnly && onPasswordSignIn) {
    return (
      <div className={className}>
        <form onSubmit={handlePasswordSignIn} className="space-y-3">
          <div className="space-y-1">
            <label
              htmlFor="local-email"
              className="text-sm font-medium leading-none"
            >
              Email
            </label>
            <Input
              id="local-email"
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isLoading}
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor="local-password"
              className="text-sm font-medium leading-none"
            >
              Password
            </label>
            <Input
              id="local-password"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isLoading}
            />
          </div>
          <Button
            type="submit"
            disabled={isLoading}
            className="w-full bg-[#117865] text-white hover:bg-[#117865]/90"
          >
            {isLoading ? 'Signing in...' : 'Sign in with Email'}
          </Button>
        </form>
        {error && (
          <p className="mt-2 text-center text-sm text-destructive">{error}</p>
        )}
      </div>
    );
  }

  return (
    <div className={className}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="w-full"
              tabIndex={isLocalEnvironment ? 0 : undefined}
            >
              <Button
                type="button"
                onClick={handleFabricSignIn}
                disabled={isLoading || isLocalEnvironment}
                className="w-full bg-[#117865] text-white hover:bg-[#117865]/90 disabled:opacity-70"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 21 21"
                  className="mr-1"
                >
                  <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                  <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                  <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                  <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
                </svg>
                {isLoading ? 'Opening Fabric...' : 'Sign in with Fabric'}
              </Button>
            </span>
          </TooltipTrigger>
          {isLocalEnvironment && (
            <TooltipContent>
              <p>
                Deploy your app to Fabric with `rayfin up`, then test your UI
                changes against the Fabric backend using `npm run dev:fabric`
              </p>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
      {isLocalEnvironment && onPasswordSignIn && (
        <>
          <div className="relative my-4">
            <Separator />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
              or (local only)
            </span>
          </div>
          <form onSubmit={handlePasswordSignIn} className="space-y-3">
            <Input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isLoading}
            />
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isLoading}
            />
            <Button
              type="submit"
              variant="outline"
              disabled={isLoading}
              className="w-full"
            >
              {isLoading ? 'Signing in...' : 'Sign in with Email'}
            </Button>
            {/* TODO: Add "Forgot password?" link once email sending is enabled (set services.auth.email.enabled: true in rayfin.yml) */}
          </form>
        </>
      )}

      {error && (
        <p className="mt-2 text-center text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
