import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStacks, getUpdates, triggerCheck, type Stack, type UpdateStatus } from '../api';
import StatsPanel from '../components/StatsPanel';

export default function Dashboard() {
  const [stacks, setStacks] = useState<Stack[]>([]);
  const [updates, setUpdates] = useState<UpdateStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const [s, u] = await Promise.all([getStacks(), getUpdates()]);
      setStacks(s);
      setUpdates(u);
    } catch (err: any) {
      console.error('Failed to load:', err);
      setError(err?.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  const handleCheckUpdates = async () => {
    setChecking(true);
    setError(null);
    try {
      await triggerCheck();
      await refresh();
    } catch (err: any) {
      setError(err?.message || 'Update check failed');
    } finally {
      setChecking(false);
    }
  };

  const updateCount = updates.filter((u) => u.updateAvailable).length;
  const availableUpdates = updates.filter((u) => u.updateAvailable);
  const runningStacks = stacks.filter((s) => s.status === 'running' || s.status === 'partial').length;
  const runningServices = stacks.reduce(
    (sum, stack) => sum + stack.services.filter((service) => service.State === 'running').length,
    0,
  );

  if (loading) {
    return (
      <div className="flex justify-center pt-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-dock-border border-t-dock-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-3xl font-bold tracking-tight text-white">Dashboard</h1>
        <div className="flex gap-2">
            <button
              onClick={() => navigate('/convert')}
              className="rounded-xl border border-dock-border bg-dock-card px-4 py-2 text-sm font-semibold text-white transition hover:bg-dock-panel"
            >
              Docker Run Converter
            </button>
            <button
              onClick={handleCheckUpdates}
              disabled={checking}
              className="rounded-xl bg-dock-accent px-4 py-2 text-sm font-semibold text-dock-bg transition hover:bg-dock-accent/90 disabled:opacity-50"
            >
              {checking ? 'Checking for updates...' : 'Check for Updates'}
            </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-dock-red/30 bg-dock-red/10 p-4 text-sm text-dock-red">
          <div className="font-semibold">Dashboard data could not be loaded.</div>
          <div className="mt-1 opacity-90">{error}</div>
          <button
            onClick={refresh}
            className="mt-3 rounded-lg border border-dock-red/40 px-3 py-1.5 text-xs font-semibold transition hover:bg-dock-red/10"
          >
            Retry now
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-dock-border/50 bg-dock-card/80 p-4">
          <p className="text-xs uppercase tracking-wider text-dock-muted">Total Stacks</p>
          <p className="mt-1 text-2xl font-bold text-white">{stacks.length}</p>
        </div>
        <div className="rounded-2xl border border-dock-border/50 bg-dock-card/80 p-4">
          <p className="text-xs uppercase tracking-wider text-dock-muted">Active Stacks</p>
          <p className="mt-1 text-2xl font-bold text-dock-accent">{runningStacks}</p>
        </div>
        <div className="rounded-2xl border border-dock-border/50 bg-dock-card/80 p-4">
          <p className="text-xs uppercase tracking-wider text-dock-muted">Running Services</p>
          <p className="mt-1 text-2xl font-bold text-white">{runningServices}</p>
        </div>
        <div className="rounded-2xl border border-dock-border/50 bg-dock-card/80 p-4">
          <p className="text-xs uppercase tracking-wider text-dock-muted">Updates Available</p>
          <p className={`mt-1 text-2xl font-bold ${updateCount > 0 ? 'text-dock-yellow' : 'text-dock-green'}`}>
            {updateCount}
          </p>
        </div>
      </div>

      {availableUpdates.length > 0 && (
        <div className="rounded-2xl border border-dock-yellow/30 bg-dock-yellow/10 p-5">
          <h2 className="text-sm font-bold text-dock-yellow mb-3 flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-dock-yellow/20 text-xs">🔔</span>
            Updates available for the following images:
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {availableUpdates.map((u) => {
              const [stackName] = (u.context || '').split('/');
              return (
                <li key={u.image} className="flex flex-col gap-2 rounded-xl border border-dock-yellow/20 bg-dock-card p-4 text-sm text-white transition hover:border-dock-yellow/40">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <div className="w-1.5 h-1.5 rounded-full bg-dock-yellow shrink-0" />
                      <span className="font-bold truncate text-dock-yellow">
                        {u.context || 'Unknown Container'}
                      </span>
                    </div>
                  </div>
                  <div className="font-mono text-[10px] text-dock-muted break-all opacity-60">
                    {u.image}
                  </div>
                  {stackName && (
                    <button
                      onClick={() => navigate(`/stack/${stackName}`)}
                      className="mt-2 flex items-center justify-center gap-1.5 rounded-lg bg-dock-yellow/10 py-1.5 text-xs font-semibold text-dock-yellow transition hover:bg-dock-yellow/20"
                    >
                      Go to Stack
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <StatsPanel />
    </div>
  );
}
