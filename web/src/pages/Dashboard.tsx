import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStacks, getUpdates, triggerCheck, type Stack, type UpdateStatus } from '../api';
import StatsPanel from '../components/StatsPanel';

export default function Dashboard() {
  const [stacks, setStacks] = useState<Stack[]>([]);
  const [updates, setUpdates] = useState<UpdateStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    try {
      const [s, u] = await Promise.all([getStacks(), getUpdates()]);
      setStacks(s);
      setUpdates(u);
    } catch (err) {
      console.error('Failed to load:', err);
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
    try {
      await triggerCheck();
      await refresh();
    } finally {
      setChecking(false);
    }
  };

  const updateCount = updates.filter((u) => u.updateAvailable).length;
  const availableUpdates = updates.filter((u) => u.updateAvailable);
  const runningStacks = stacks.filter((s) => s.status === 'running' || s.status === 'partial').length;

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
          <p className="text-xs uppercase tracking-wider text-dock-muted">Stopped Stacks</p>
          <p className="mt-1 text-2xl font-bold text-dock-muted">{stacks.length - runningStacks}</p>
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
          <ul className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
            {availableUpdates.map((u) => (
              <li key={u.image} className="rounded-xl border border-dock-yellow/20 bg-dock-card px-3 py-2 text-sm text-white font-mono break-all flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-dock-yellow shrink-0" />
                {u.image}
              </li>
            ))}
          </ul>
        </div>
      )}

      <StatsPanel />
    </div>
  );
}
