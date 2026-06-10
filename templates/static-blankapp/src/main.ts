import { bootstrapAuth } from './services/bootstrap';

type ViewName = 'loading' | 'auth' | 'home';

const loadingView = document.querySelector<HTMLElement>('#loading-view')!;
const authView = document.querySelector<HTMLElement>('#auth-view')!;
const homeView = document.querySelector<HTMLElement>('#home-view')!;
const signInBtn = document.querySelector<HTMLButtonElement>('#sign-in-btn')!;
const signOutBtn = document.querySelector<HTMLButtonElement>('#sign-out-btn')!;
const errorEl = document.querySelector<HTMLElement>('#auth-error')!;

const authService = bootstrapAuth();
const signInLabel = signInBtn.textContent ?? 'Sign in with Microsoft';

function show(view: ViewName): void {
  loadingView.hidden = view !== 'loading';
  authView.hidden = view !== 'auth';
  homeView.hidden = view !== 'home';
}

function showError(message: string | null): void {
  errorEl.textContent = message ?? '';
  errorEl.hidden = !message;
}

async function refreshSession(): Promise<void> {
  show('loading');
  showError(null);
  try {
    const embedded = await authService.initEmbeddedAuth();
    const user = embedded ?? (await authService.getCurrentUser());
    show(user ? 'home' : 'auth');
  } catch {
    show('auth');
  }
}

signInBtn.addEventListener('click', async () => {
  signInBtn.disabled = true;
  showError(null);
  signInBtn.textContent = authService.fabricAuthEnabled
    ? 'Opening Fabric…'
    : 'Signing in…';
  try {
    await authService.signIn();
    show('home');
  } catch (err) {
    showError(err instanceof Error ? err.message : 'Failed to sign in.');
  } finally {
    signInBtn.disabled = false;
    signInBtn.textContent = signInLabel;
  }
});

signOutBtn.addEventListener('click', async () => {
  signOutBtn.disabled = true;
  try {
    await authService.signOut();
  } catch (err) {
    console.error('Sign-out error:', err);
  } finally {
    signOutBtn.disabled = false;
    show('auth');
  }
});

void refreshSession();
