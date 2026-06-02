import { InfoIcon } from 'lucide-react';
import { useState } from 'react';

import { SignInForm } from '@/components/SignInForm';
import { SignUpForm } from '@/components/SignUpForm';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/AuthContext';

type AuthView = 'login' | 'signup';

export function AuthPage() {
  const [view, setView] = useState<AuthView>('login');
  const {
    signInWithFabric,
    signIn,
    signUp,
    usernameAuthEnabled,
    fabricAuthEnabled,
  } = useAuth();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        {usernameAuthEnabled &&
          fabricAuthEnabled && ( // This message is only relevant if both auth methods are enabled, which is currently the case in local development
            <Alert className="border-amber-200 bg-amber-50 text-amber-900 [&>svg]:text-amber-600">
              <InfoIcon className="h-4 w-4" />
              <AlertDescription className="text-amber-800">
                This is what will show when you deploy your app. If you want to
                be able to sign in with Fabric, deploy your app to Fabric with
                <code className="mx-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-mono">
                  npx rayfin up
                </code>
                then run
                <code className="mx-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-mono">
                  npm run dev:fabric
                </code>
                to have a locally hosted frontend targeting your Fabric backend.
              </AlertDescription>
            </Alert>
          )}

        {fabricAuthEnabled && (
          <Card>
            <CardHeader className="text-center">
              <CardTitle className="text-2xl">Field Technician App</CardTitle>
              <CardDescription>
                Sign in with your Fabric account
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SignInForm onFabricSignIn={signInWithFabric} />
            </CardContent>
          </Card>
        )}

        {usernameAuthEnabled && (
          <>
            {fabricAuthEnabled && (
              <Alert className="border-amber-200 bg-amber-50 text-amber-900 [&>svg]:text-amber-600">
                <InfoIcon className="h-4 w-4" />
                <AlertDescription className="text-amber-800">
                  Below is used for local testing purposes only
                </AlertDescription>
              </Alert>
            )}
            <Card>
              <CardHeader className="text-center">
                <CardTitle className="text-2xl">
                  {fabricAuthEnabled ? 'Local Sign In' : 'Field Technician App'}
                </CardTitle>
                <CardDescription>
                  {fabricAuthEnabled
                    ? 'Sign in with email and password'
                    : 'Sign in to continue'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs
                  value={view}
                  onValueChange={(v) => setView(v as AuthView)}
                  className="w-full"
                >
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="login">Sign In</TabsTrigger>
                    <TabsTrigger value="signup">Sign Up</TabsTrigger>
                  </TabsList>
                  <TabsContent value="login" className="mt-4">
                    <SignInForm localOnly onPasswordSignIn={signIn} />
                  </TabsContent>
                  <TabsContent value="signup" className="mt-4">
                    <SignUpForm
                      onSubmit={signUp}
                      onSwitchToSignIn={() => setView('login')}
                    />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
