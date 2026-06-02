import { Loader2Icon } from 'lucide-react';
import type { UseFormRegister, FieldErrors } from 'react-hook-form';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface SignupFormValues {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export interface SignupFormProps extends React.ComponentProps<'div'> {
  register: UseFormRegister<SignupFormValues>;
  errors: FieldErrors<SignupFormValues>;
  onSubmit: (e: React.FormEvent) => void;
  isLoading?: boolean;
  error?: string | null;
  onSwitchToSignIn?: () => void;
}

export function SignupForm({
  className,
  register,
  errors,
  onSubmit,
  isLoading = false,
  error,
  onSwitchToSignIn,
  ...props
}: SignupFormProps) {
  return (
    <div className={cn('flex flex-col gap-6', className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Create your account</CardTitle>
          <CardDescription>
            Enter your email below to create your account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit}>
            <FieldGroup>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Field data-invalid={!!errors.name}>
                <FieldLabel htmlFor="name">Full Name</FieldLabel>
                <Input
                  id="name"
                  type="text"
                  placeholder="John Doe"
                  autoComplete="name"
                  {...register('name')}
                />
                <FieldError>{errors.name?.message}</FieldError>
              </Field>

              <Field data-invalid={!!errors.email}>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  placeholder="m@example.com"
                  autoComplete="email"
                  {...register('email')}
                />
                <FieldError>{errors.email?.message}</FieldError>
              </Field>

              <Field>
                <Field className="grid grid-cols-2 gap-4">
                  <Field data-invalid={!!errors.password}>
                    <FieldLabel htmlFor="password">Password</FieldLabel>
                    <Input
                      id="password"
                      type="password"
                      placeholder="••••••••"
                      autoComplete="new-password"
                      {...register('password')}
                    />
                    <FieldError>{errors.password?.message}</FieldError>
                  </Field>
                  <Field data-invalid={!!errors.confirmPassword}>
                    <FieldLabel htmlFor="confirmPassword">
                      Confirm Password
                    </FieldLabel>
                    <Input
                      id="confirmPassword"
                      type="password"
                      placeholder="••••••••"
                      autoComplete="new-password"
                      {...register('confirmPassword')}
                    />
                    <FieldError>{errors.confirmPassword?.message}</FieldError>
                  </Field>
                </Field>
                <FieldDescription>
                  Must be at least 8 characters long.
                </FieldDescription>
              </Field>

              <Field>
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                      Creating account...
                    </>
                  ) : (
                    'Create Account'
                  )}
                </Button>
                <FieldDescription className="text-center">
                  Already have an account?{' '}
                  {onSwitchToSignIn ? (
                    <button
                      type="button"
                      onClick={onSwitchToSignIn}
                      className="underline underline-offset-4 hover:text-primary"
                    >
                      Sign in
                    </button>
                  ) : (
                    <a
                      href="#"
                      className="underline underline-offset-4 hover:text-primary"
                    >
                      Sign in
                    </a>
                  )}
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
      <FieldDescription className="px-6 text-center">
        By clicking continue, you agree to our <a href="#">Terms of Service</a>{' '}
        and <a href="#">Privacy Policy</a>.
      </FieldDescription>
    </div>
  );
}
