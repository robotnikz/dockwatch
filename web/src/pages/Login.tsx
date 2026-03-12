import { useMemo, useState } from 'react';
import { loginAuth, setupAuth, type AuthMe } from '../api';

export default function LoginPage({
  me,
  onAuthenticated,
}: {
  me: AuthMe;
  onAuthenticated: (next: AuthMe) => void;
}) {
  const [username, setUsername] = useState(me.username || 'admin');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mode = useMemo(() => (me.configured ? 'login' : 'setup'), [me.configured]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!username.trim()) {
      setError('Username is required');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    if (mode === 'setup' && password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setBusy(true);
    try {
      const response = mode === 'setup'
        ? await setupAuth(username.trim(), password)
        : await loginAuth(username.trim(), password);
      onAuthenticated(response.me);
      setPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setError(err?.message || 'Authentication failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-dock-bg text-dock-text flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-dock-border/60 bg-dock-card/90 p-6 shadow-2xl">
        <div className="mb-5 text-center">
          <div className="text-3xl">🐳</div>
          <h1 className="mt-2 text-2xl font-bold text-white">DockWatch {mode === 'setup' ? 'Setup' : 'Login'}</h1>
          <p className="mt-1 text-sm text-dock-muted">
            {mode === 'setup' ? 'Create your local admin account to protect DockWatch.' : 'Sign in to continue.'}
          </p>
        </div>

        {error ? (
          <div className="mb-4 rounded-xl border border-dock-red/30 bg-dock-red/10 px-3 py-2 text-sm text-dock-red">
            {error}
          </div>
        ) : null}

        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm text-dock-muted">Username</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border border-dock-border bg-dock-bg/70 px-3 py-2 text-white outline-none focus:border-dock-accent"
              autoComplete="username"
              required
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm text-dock-muted">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-dock-border bg-dock-bg/70 px-3 py-2 text-white outline-none focus:border-dock-accent"
              autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
              required
            />
          </label>

          {mode === 'setup' ? (
            <label className="block">
              <span className="mb-1 block text-sm text-dock-muted">Confirm Password</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-lg border border-dock-border bg-dock-bg/70 px-3 py-2 text-white outline-none focus:border-dock-accent"
                autoComplete="new-password"
                required
              />
            </label>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-dock-accent px-4 py-2.5 font-semibold text-dock-bg transition hover:bg-dock-accent/90 disabled:opacity-50"
          >
            {busy ? (mode === 'setup' ? 'Setting up...' : 'Signing in...') : (mode === 'setup' ? 'Create account' : 'Sign in')}
          </button>
        </form>
      </div>
    </div>
  );
}
