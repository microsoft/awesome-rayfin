import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SignupForm, type SignupFormValues } from '@/components/ui/signup-form';

const signUpSchema = z
  .object({
    name: z.string().min(1, 'Full name is required'),
    email: z.string().email('Please enter a valid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });

interface SignUpFormProps {
  className?: string;
  onSubmit: (
    email: string,
    password: string,
    name: string
  ) => Promise<{ emailVerified: boolean }>;
  onSwitchToSignIn: () => void;
}

export function SignUpForm({
  className,
  onSubmit,
  onSwitchToSignIn,
}: SignUpFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState<{
    emailVerified: boolean;
    email: string;
  } | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupFormValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      confirmPassword: '',
    },
  });

  async function onFormSubmit(values: SignupFormValues) {
    setError(null);
    setIsLoading(true);

    try {
      const result = await onSubmit(values.email, values.password, values.name);
      setSuccess({ emailVerified: result.emailVerified, email: values.email });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed');
    } finally {
      setIsLoading(false);
    }
  }

  if (success) {
    return (
      <Card className={className}>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Account created!</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertTitle>Success</AlertTitle>
            <AlertDescription>
              {success.emailVerified ? (
                <>
                  Your account is ready. You can now sign in with your
                  credentials.
                </>
              ) : (
                <>
                  We&apos;ve sent a verification email to{' '}
                  <strong>{success.email}</strong>. Please check your inbox and
                  click the verification link to activate your account.
                </>
              )}
            </AlertDescription>
          </Alert>
          <Button onClick={onSwitchToSignIn} className="w-full">
            Go to Sign In
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <SignupForm
      className={className}
      register={register}
      errors={errors}
      onSubmit={handleSubmit(onFormSubmit)}
      isLoading={isLoading}
      error={error}
      onSwitchToSignIn={onSwitchToSignIn}
    />
  );
}
