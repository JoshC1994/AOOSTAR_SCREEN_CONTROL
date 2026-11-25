import {useState, type FormEvent} from 'react';
import {AlertTriangle, Eye, EyeOff, Lock} from 'lucide-react';
import type {AuthStatusResponse} from '../types.ts';
import {loginWithPassword} from '../utils/apiClient.ts';

interface LoginViewProps {
  authStatus: AuthStatusResponse | null;
  onSuccess: (result: {
    username: string;
    usingDefaultPassword: boolean;
    envOverrideActive: boolean;
  }) => void;
}

export function LoginView({authStatus, onSuccess}: LoginViewProps) {
  const [username, setUsername] = useState(authStatus?.usingDefaultPassword ? 'admin' : '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const displayedError =
    error ||
    (authStatus?.defaultPasswordPublicBlocked
      ? 'Change the default password to allow access from outside your local network.'
      : null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Enter both username and password.');
      return;
    }

    setSubmitting(true);
    setError(null);
    const res = await loginWithPassword(username, password);
    setSubmitting(false);

    if (!res.ok) {
      setError(res.error || 'Sign in failed.');
      return;
    }

    setPassword('');
    onSuccess({
      username: res.username || username.trim(),
      usingDefaultPassword: Boolean(res.usingDefaultPassword),
      envOverrideActive: Boolean(res.envOverrideActive),
    });
  };

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-[#0B0E14] text-slate-900 dark:text-[#E6EDF3] flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-[#1F2937] bg-white dark:bg-[#0F131C] p-6 space-y-5 shadow-xl dark:shadow-none">
        <div className="flex items-start gap-3 pb-4 border-b border-slate-200 dark:border-[#1F2937]">
          <div className="w-10 h-10 rounded-lg bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
            <Lock className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-lg font-display font-bold text-slate-900 dark:text-slate-100">
              Aoostar Display Studio
            </h1>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
              Sign in to manage screens, telemetry connections, and hardware output.
            </p>
          </div>
        </div>

        {authStatus?.usingDefaultPassword && (
          <div className="px-3 py-2.5 rounded border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-900 dark:text-amber-200 font-mono">
            Default login: admin / admin
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label
              htmlFor="aoostar-login-username"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Username
            </label>
            <input
              id="aoostar-login-username"
              type="text"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label
              htmlFor="aoostar-login-password"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Password
            </label>
            <div className="relative">
              <input
                id="aoostar-login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full px-3 py-2 pr-10 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {displayedError && (
            <div
              role="alert"
              className="p-3 rounded border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 text-xs text-rose-800 dark:text-rose-200 flex items-start gap-2"
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{displayedError}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !username.trim() || !password}
            className="w-full px-4 py-2.5 rounded bg-amber-500 text-slate-950 hover:bg-amber-400 disabled:opacity-50 text-xs font-semibold transition-colors whitespace-nowrap"
          >
            {submitting ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="pt-3 border-t border-slate-200 dark:border-[#1F2937] text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
          Recovery: deleting <code className="font-mono">data/credentials.json</code> and restarting the container restores{' '}
          <code className="font-mono">admin / admin</code> without losing screens or settings.
        </div>
      </div>
    </div>
  );
}
