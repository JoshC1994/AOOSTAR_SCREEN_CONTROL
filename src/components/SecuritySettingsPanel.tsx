import {useEffect, useState, type FormEvent} from 'react';
import {AlertTriangle, Check, Copy, KeyRound, LogOut, RotateCcw, Shield, Trash2} from 'lucide-react';
import type {AuthStatusResponse} from '../types.ts';
import {apiFetch, logoutEverywhere, logoutSession} from '../utils/apiClient.ts';

interface SecuritySettingsPanelProps {
  authStatus: AuthStatusResponse | null;
  onAuthStatusChanged: () => Promise<void> | void;
  onSignedOut: () => void;
  highlightSection?: boolean;
}

function evaluatePasswordStrength(pw: string): {
  label: 'Too short' | 'Weak' | 'Fair' | 'Strong';
  toneClass: string;
} {
  if (pw.length < 8) {
    return {
      label: 'Too short',
      toneClass: 'text-rose-600 dark:text-rose-400',
    };
  }
  let score = 0;
  if (pw.length >= 12) score += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
  if (/\d/.test(pw)) score += 1;
  if (/[^a-zA-Z0-9]/.test(pw)) score += 1;

  if (score >= 3) {
    return {label: 'Strong', toneClass: 'text-emerald-600 dark:text-emerald-400'};
  }
  if (score >= 1) {
    return {label: 'Fair', toneClass: 'text-amber-600 dark:text-amber-400'};
  }
  return {label: 'Weak', toneClass: 'text-amber-700 dark:text-amber-300'};
}

export function SecuritySettingsPanel({
  authStatus,
  onAuthStatusChanged,
  onSignedOut,
  highlightSection,
}: SecuritySettingsPanelProps) {
  const [usernameInput, setUsernameInput] = useState(authStatus?.username || 'admin');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingCreds, setSavingCreds] = useState(false);
  const [credsFeedback, setCredsFeedback] = useState<{ok: boolean; text: string} | null>(null);

  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  const [tokenBusy, setTokenBusy] = useState(false);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);
  const [tokenFeedback, setTokenFeedback] = useState<{ok: boolean; text: string} | null>(null);

  const [sessionBusy, setSessionBusy] = useState(false);

  useEffect(() => {
    if (authStatus?.username) {
      setUsernameInput(authStatus.username);
    }
  }, [authStatus?.username]);

  const envOverrideActive = Boolean(authStatus?.envOverrideActive);
  const strength = newPassword ? evaluatePasswordStrength(newPassword) : null;

  const handleSaveCredentials = async (e: FormEvent) => {
    e.preventDefault();
    setCredsFeedback(null);

    if (!usernameInput.trim()) {
      setCredsFeedback({ok: false, text: 'Username cannot be empty.'});
      return;
    }
    if (!currentPassword) {
      setCredsFeedback({ok: false, text: 'Enter your current password.'});
      return;
    }
    if (newPassword.length < 8) {
      setCredsFeedback({ok: false, text: 'New password must be at least 8 characters.'});
      return;
    }
    if (newPassword !== confirmPassword) {
      setCredsFeedback({ok: false, text: 'New password and confirmation do not match.'});
      return;
    }
    if (newPassword === currentPassword) {
      setCredsFeedback({ok: false, text: 'New password must be different from your current password.'});
      return;
    }

    setSavingCreds(true);
    try {
      const res = await apiFetch('/api/auth/change-credentials', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          currentPassword,
          newUsername: usernameInput.trim(),
          newPassword,
          confirmPassword,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {error?: string; username?: string};
      if (!res.ok) {
        setCredsFeedback({ok: false, text: data.error || `Failed (HTTP ${res.status})`});
        return;
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setCredsFeedback({
        ok: true,
        text: `Credentials updated for "${data.username || usernameInput.trim()}". Other sessions have been signed out.`,
      });
      await onAuthStatusChanged();
    } catch {
      setCredsFeedback({ok: false, text: 'Failed to reach authentication endpoint.'});
    } finally {
      setSavingCreds(false);
    }
  };

  const handleResetDefault = async () => {
    setResetBusy(true);
    setCredsFeedback(null);
    try {
      const res = await apiFetch('/api/auth/reset-default', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({confirmed: true}),
      });
      const data = (await res.json().catch(() => ({}))) as {error?: string};
      if (!res.ok) {
        setCredsFeedback({ok: false, text: data.error || `Reset failed (HTTP ${res.status})`});
        return;
      }
      setConfirmResetOpen(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setCredsFeedback({
        ok: true,
        text: 'Credentials reset to default (admin / admin). Other sessions have been signed out.',
      });
      await onAuthStatusChanged();
    } finally {
      setResetBusy(false);
    }
  };

  const handleRotateApiToken = async () => {
    setTokenBusy(true);
    setTokenFeedback(null);
    setCopiedToken(false);
    try {
      const res = await apiFetch('/api/auth/api-token/rotate', {method: 'POST'});
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        token?: string;
        prefix?: string;
      };
      if (!res.ok || !data.token) {
        setTokenFeedback({ok: false, text: data.error || `Failed (HTTP ${res.status})`});
        return;
      }
      setRevealedToken(data.token);
      setTokenFeedback({
        ok: true,
        text: 'API token generated. Copy it now — only its salted hash is stored on disk.',
      });
      await onAuthStatusChanged();
    } finally {
      setTokenBusy(false);
    }
  };

  const handleRevokeApiToken = async () => {
    setTokenBusy(true);
    setTokenFeedback(null);
    setRevealedToken(null);
    try {
      const res = await apiFetch('/api/auth/api-token', {method: 'DELETE'});
      if (res.ok) {
        setTokenFeedback({ok: true, text: 'Stored script API token revoked.'});
        await onAuthStatusChanged();
      } else {
        setTokenFeedback({ok: false, text: `Failed to revoke token (HTTP ${res.status})`});
      }
    } finally {
      setTokenBusy(false);
    }
  };

  const handleCopyRevealedToken = async () => {
    if (!revealedToken) return;
    try {
      await navigator.clipboard.writeText(revealedToken);
      setCopiedToken(true);
      window.setTimeout(() => setCopiedToken(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleSignOutCurrent = async () => {
    setSessionBusy(true);
    await logoutSession();
    setSessionBusy(false);
    onSignedOut();
  };

  const handleSignOutEverywhere = async () => {
    setSessionBusy(true);
    await logoutEverywhere();
    setSessionBusy(false);
    onSignedOut();
  };

  return (
    <section
      id="settings-security-section"
      className={`rounded-lg border ${
        highlightSection
          ? 'border-amber-500 dark:border-amber-500/80'
          : 'border-slate-200 dark:border-[#1F2937]'
      } bg-white dark:bg-[#0F131C] p-5 space-y-6 shadow-xs dark:shadow-none`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-[#1F2937]">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Shield className="w-4 h-4 text-amber-500 dark:text-amber-400" />
            Security &amp; Access
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
            Signed in as <span className="font-mono font-medium text-slate-900 dark:text-slate-100">{authStatus?.username || 'admin'}</span>
            {' · '}
            {authStatus?.envOverrideActive
              ? 'Managed by AOOSTAR_ADMIN_USER / AOOSTAR_ADMIN_PASSWORD'
              : authStatus?.usingDefaultPassword
                ? 'Using default password (local network only)'
                : 'Custom credentials active'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleSignOutCurrent()}
            disabled={sessionBusy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 dark:border-[#263042] bg-slate-100 dark:bg-[#141A26] text-xs font-medium text-slate-800 dark:text-slate-200 hover:border-amber-500/60 disabled:opacity-50 whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
          <button
            type="button"
            onClick={() => void handleSignOutEverywhere()}
            disabled={sessionBusy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 text-xs font-medium text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/40 disabled:opacity-50 whitespace-nowrap"
          >
            Sign Out Everywhere
          </button>
        </div>
      </div>

      {/* Username & Password Form */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
            Username &amp; Password
          </h3>
          {!envOverrideActive && (
            <button
              type="button"
              onClick={() => setConfirmResetOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-slate-300 dark:border-[#263042] bg-slate-50 dark:bg-[#0B0E14] text-xs text-slate-700 dark:text-slate-300 hover:border-amber-500/60"
            >
              <RotateCcw className="w-3 h-3" />
              Reset to default (admin/admin)
            </button>
          )}
        </div>

        {confirmResetOpen && !envOverrideActive && (
          <div className="p-3 rounded border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/30 text-xs flex flex-wrap items-center justify-between gap-3">
            <span className="text-amber-900 dark:text-amber-200">
              Reset login credentials back to <code className="font-mono">admin / admin</code> and sign out other sessions?
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmResetOpen(false)}
                className="px-2.5 py-1 rounded border border-slate-300 dark:border-[#263042] bg-white dark:bg-[#141A26] text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={resetBusy}
                onClick={() => void handleResetDefault()}
                className="px-3 py-1 rounded bg-amber-500 text-slate-950 font-semibold text-xs hover:bg-amber-400 disabled:opacity-50"
              >
                {resetBusy ? 'Resetting...' : 'Confirm Reset'}
              </button>
            </div>
          </div>
        )}

        {envOverrideActive ? (
          <div className="p-3 rounded border border-slate-200 dark:border-[#1F2937] bg-slate-50 dark:bg-[#0B0E14] text-xs text-slate-600 dark:text-slate-400">
            Credentials are currently overridden by container environment variables{' '}
            <code className="font-mono">AOOSTAR_ADMIN_USER</code> and{' '}
            <code className="font-mono">AOOSTAR_ADMIN_PASSWORD</code>. Remove those variables to manage credentials in the UI.
          </div>
        ) : (
          <form onSubmit={(e) => void handleSaveCredentials(e)} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="sec-new-username"
                className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
              >
                Username
              </label>
              <input
                id="sec-new-username"
                type="text"
                autoComplete="username"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label
                htmlFor="sec-current-password"
                className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
              >
                Current Password
              </label>
              <input
                id="sec-current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Required to save changes"
                className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="sec-new-password"
                  className="text-[11px] font-medium text-slate-600 dark:text-slate-400"
                >
                  New Password (min 8 characters)
                </label>
                {strength && (
                  <span className={`text-[11px] font-medium ${strength.toneClass}`}>
                    Strength: {strength.label}
                  </span>
                )}
              </div>
              <input
                id="sec-new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label
                htmlFor="sec-confirm-password"
                className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
              >
                Confirm New Password
              </label>
              <input
                id="sec-confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
                className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-3 pt-1">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Updating credentials rotates the session secret and invalidates all other logged-in sessions.
              </span>
              <button
                type="submit"
                disabled={savingCreds}
                className="px-4 py-2 rounded bg-amber-500 text-slate-950 hover:bg-amber-400 disabled:opacity-50 text-xs font-semibold transition-colors whitespace-nowrap"
              >
                {savingCreds ? 'Updating...' : 'Update Credentials'}
              </button>
            </div>
          </form>
        )}

        {credsFeedback && (
          <div
            className={`p-2.5 rounded border text-xs flex items-start gap-2 ${
              credsFeedback.ok
                ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/25 text-emerald-800 dark:text-emerald-300'
                : 'border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200'
            }`}
          >
            {!credsFeedback.ok && <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
            <span>{credsFeedback.text}</span>
          </div>
        )}
      </div>

      {/* Optional API Token for Scripts */}
      <div className="pt-5 border-t border-slate-200 dark:border-[#1F2937] space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
              Optional API Token for Scripts
            </h3>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
              For <code className="font-mono">Authorization: Bearer &lt;token&gt;</code> automation calls. Stored salted and hashed only.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={tokenBusy}
              onClick={() => void handleRotateApiToken()}
              className="px-3 py-1.5 rounded border border-slate-300 dark:border-[#263042] bg-slate-100 dark:bg-[#141A26] text-xs font-medium text-slate-800 dark:text-slate-200 hover:border-amber-500/60 disabled:opacity-50 whitespace-nowrap"
            >
              {authStatus?.apiTokenConfigured ? 'Rotate Token' : 'Generate Token'}
            </button>
            {authStatus?.apiTokenConfigured && (
              <button
                type="button"
                disabled={tokenBusy}
                onClick={() => void handleRevokeApiToken()}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 text-xs font-medium text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/40 disabled:opacity-50 whitespace-nowrap"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Revoke
              </button>
            )}
          </div>
        </div>

        <div className="text-xs text-slate-600 dark:text-slate-400 font-mono">
          {authStatus?.apiTokenConfigured
            ? `Active token: ${authStatus.apiTokenPrefix || 'aoo_...'} (created ${
                authStatus.apiTokenCreatedAt ? new Date(authStatus.apiTokenCreatedAt).toLocaleString() : 'recently'
              })`
            : 'No generated script token configured.'}
          {authStatus?.envApiTokenConfigured ? ' · AOOSTAR_API_TOKEN env token is also active.' : ''}
        </div>

        {revealedToken && (
          <div className="p-3 rounded border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/30 space-y-2">
            <div className="text-xs font-medium text-amber-900 dark:text-amber-200">
              One-time API token (save this now — it will not be shown again):
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-2.5 py-1.5 rounded bg-white dark:bg-[#0B0E14] border border-amber-300/70 dark:border-amber-800 text-xs font-mono text-slate-900 dark:text-slate-100 break-all">
                {revealedToken}
              </code>
              <button
                type="button"
                onClick={() => void handleCopyRevealedToken()}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400 shrink-0"
              >
                {copiedToken ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedToken ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        {tokenFeedback && (
          <div
            className={`p-2.5 rounded border text-xs ${
              tokenFeedback.ok
                ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/25 text-emerald-800 dark:text-emerald-300'
                : 'border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200'
            }`}
          >
            {tokenFeedback.text}
          </div>
        )}
      </div>

      {/* Recovery Note */}
      <div className="pt-4 border-t border-slate-200 dark:border-[#1F2937] text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
        Account recovery: deleting <code className="font-mono">data/credentials.json</code> and restarting the container recreates{' '}
        <code className="font-mono">admin / admin</code> without affecting saved screens, layouts, or uploaded media.
      </div>
    </section>
  );
}
