import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getCleanupDashboard,
  getCleanupPreview,
  saveCleanupConfig,
  streamCleanupRun,
  type CleanupConfig,
  type CleanupDashboard,
  type CleanupPreview,
  type CleanupRunResult,
} from '../api';

const defaultConfig: CleanupConfig = {
  scheduleEnabled: false,
  scheduleFrequency: 'daily',
  scheduleTime: '00:00',
  protectionEnabled: true,
  protectedImageLabels: [],
  protectedVolumeLabels: [],
  options: {
    containers: false,
    images: false,
    networks: false,
    volumes: false,
    buildCache: false,
  },
};

function formatDateTime(value: string | null): string {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function CleanupPage() {
  const [config, setConfig] = useState<CleanupConfig>(defaultConfig);
  const [stats, setStats] = useState<CleanupDashboard['stats'] | null>(null);
  const [preview, setPreview] = useState<CleanupPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [liveLog, setLiveLog] = useState('');
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [lastRun, setLastRun] = useState<CleanupRunResult | null>(null);

  const protectedImageLabelsText = config.protectedImageLabels.join(', ');
  const protectedVolumeLabelsText = config.protectedVolumeLabels.join(', ');

  const parseLabelList = (value: string): string[] => {
    return [...new Set(value.split(',').map((s) => s.trim()).filter(Boolean))];
  };

  const refresh = useCallback(async () => {
    const dashboard = await getCleanupDashboard();
    setConfig(dashboard.config);
    setStats(dashboard.stats);
    setPreview(dashboard.preview);
    setLastRun(dashboard.stats.latestRun);
  }, []);

  useEffect(() => {
    refresh()
      .catch((err: any) => setMessage({ tone: 'error', text: err.message || 'Failed to load cleanup dashboard' }))
      .finally(() => setLoading(false));
  }, [refresh]);

  const saveSchedule = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const result = await saveCleanupConfig(config);
      setConfig(result.config);
      setMessage({ tone: 'success', text: 'Cleanup schedule saved.' });
      await refresh();
    } catch (err: any) {
      setMessage({ tone: 'error', text: err.message || 'Failed to save schedule' });
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    setMessage(null);
    setLiveLog('');
    try {
      const result = await streamCleanupRun(
        { options: config.options, dryRun },
        (chunk) => setLiveLog((prev) => `${prev}${chunk}`),
      );
      setLastRun(result);
      setMessage({ tone: 'success', text: `${result.dryRun ? 'Dry-run' : 'Cleanup'} finished. Reclaimed ${result.reclaimedHuman}.` });
      const newPreview = await getCleanupPreview().catch(() => null);
      setPreview(newPreview);
      await refresh();
    } catch (err: any) {
      setMessage({ tone: 'error', text: err.message || 'Cleanup failed' });
    } finally {
      setRunning(false);
    }
  };

  const totals = useMemo(() => {
    if (!stats) {
      return {
        reclaimed: '0 B',
        runs: 0,
        containers: 0,
        images: 0,
        networks: 0,
        volumes: 0,
        buildCache: 0,
      };
    }
    return {
      reclaimed: stats.totalReclaimedHuman,
      runs: stats.pruneRuns,
      containers: stats.deleted.containers,
      images: stats.deleted.images,
      networks: stats.deleted.networks,
      volumes: stats.deleted.volumes,
      buildCache: stats.deleted.buildCache,
    };
  }, [stats]);

  if (loading) {
    return (
      <div className="flex justify-center pt-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-dock-border border-t-dock-accent" />
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      <div className="flex flex-col gap-2">
        <p className="text-[11px] uppercase tracking-[0.26em] text-dock-muted">Maintenance</p>
        <h1 className="text-3xl font-bold tracking-tight text-white">Cleanup Scheduler</h1>
        <p className="text-sm text-dock-muted">Automated Docker prune jobs with all-time stats and manual run control.</p>
      </div>

      {message && (
        <div className={`rounded-xl px-4 py-3 text-sm font-medium ${message.tone === 'success' ? 'bg-dock-green/10 text-dock-green border border-dock-green/20' : 'bg-dock-red/10 text-dock-red border border-dock-red/20'}`}>
          {message.text}
        </div>
      )}

      <section className="rounded-[24px] border border-dock-border/70 bg-dock-card/85 p-5">
        <h2 className="text-lg font-bold text-white mb-4">All-Time Statistics</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Total Reclaimed" value={totals.reclaimed} color="text-dock-green" />
          <StatTile label="Prune Runs" value={String(totals.runs)} color="text-dock-accent" />
          <StatTile label="Containers" value={String(totals.containers)} color="text-dock-yellow" />
          <StatTile label="Images" value={String(totals.images)} color="text-dock-accent" />
          <StatTile label="Networks" value={String(totals.networks)} color="text-dock-yellow" />
          <StatTile label="Volumes" value={String(totals.volumes)} color="text-dock-red" />
          <StatTile label="Build Cache" value={String(totals.buildCache)} color="text-dock-green" />
          <StatTile label="Failed Runs" value={String(stats?.failedRuns || 0)} color={(stats?.failedRuns || 0) > 0 ? 'text-dock-red' : 'text-dock-muted'} />
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 text-sm text-dock-muted">
          <div className="rounded-xl border border-dock-border/50 bg-dock-bg/20 p-3">
            <div className="uppercase tracking-[0.16em] text-[11px]">First Run</div>
            <div className="mt-1 text-white font-medium">{formatDateTime(stats?.firstRunAt || null)}</div>
          </div>
          <div className="rounded-xl border border-dock-border/50 bg-dock-bg/20 p-3">
            <div className="uppercase tracking-[0.16em] text-[11px]">Last Run</div>
            <div className="mt-1 text-white font-medium">{formatDateTime(stats?.lastRunAt || null)}</div>
          </div>
        </div>
      </section>

      <section className="rounded-[24px] border border-dock-border/70 bg-dock-card/85 p-5 space-y-4">
        <h2 className="text-lg font-bold text-white">Schedule</h2>

        <div className="flex items-center justify-between rounded-xl border border-dock-border/50 bg-dock-bg/20 px-4 py-3">
          <div>
            <div className="text-sm text-white font-medium">Enable automatic schedule</div>
            <div className="text-xs text-dock-muted">Runs docker prune based on frequency and time.</div>
          </div>
          <Toggle
            checked={config.scheduleEnabled}
            onChange={(value) => setConfig((prev) => ({ ...prev, scheduleEnabled: value }))}
          />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="rounded-xl border border-dock-border/50 bg-dock-bg/20 p-3 text-sm text-dock-text">
            <div className="mb-2 text-xs uppercase tracking-[0.16em] text-dock-muted">Frequency</div>
            <select
              value={config.scheduleFrequency}
              onChange={(e) => setConfig((prev) => ({ ...prev, scheduleFrequency: e.target.value as CleanupConfig['scheduleFrequency'] }))}
              className="w-full rounded-lg border border-dock-border bg-dock-bg/60 px-3 py-2 text-white outline-none focus:border-dock-accent"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly (Sunday)</option>
              <option value="monthly">Monthly (1st day)</option>
            </select>
          </label>

          <label className="rounded-xl border border-dock-border/50 bg-dock-bg/20 p-3 text-sm text-dock-text">
            <div className="mb-2 text-xs uppercase tracking-[0.16em] text-dock-muted">Time</div>
            <input
              type="time"
              value={config.scheduleTime}
              onChange={(e) => setConfig((prev) => ({ ...prev, scheduleTime: e.target.value }))}
              className="w-full rounded-lg border border-dock-border bg-dock-bg/60 px-3 py-2 text-white outline-none focus:border-dock-accent"
            />
          </label>
        </div>
      </section>

      <section className="rounded-[24px] border border-dock-border/70 bg-dock-card/85 p-5 space-y-4">
        <h2 className="text-lg font-bold text-white">Cleanup Options</h2>

        <div className="flex items-center justify-between rounded-xl border border-dock-border/50 bg-dock-bg/20 px-4 py-3">
          <div>
            <div className="text-sm text-white font-medium">Protection Mode</div>
            <div className="text-xs text-dock-muted">Protect labeled images and volumes from prune. Recommended.</div>
          </div>
          <Toggle
            checked={config.protectionEnabled}
            onChange={(value) => setConfig((prev) => ({ ...prev, protectionEnabled: value }))}
          />
        </div>

        <ToggleRow
          label="All unused containers"
          checked={config.options.containers}
          onChange={(value) => setConfig((prev) => ({ ...prev, options: { ...prev.options, containers: value } }))}
        />
        <ToggleRow
          label="All unused images"
          checked={config.options.images}
          onChange={(value) => setConfig((prev) => ({ ...prev, options: { ...prev.options, images: value } }))}
        />
        <ToggleRow
          label="All unused networks"
          checked={config.options.networks}
          onChange={(value) => setConfig((prev) => ({ ...prev, options: { ...prev.options, networks: value } }))}
        />
        <ToggleRow
          label="All unused volumes"
          checked={config.options.volumes}
          onChange={(value) => setConfig((prev) => ({ ...prev, options: { ...prev.options, volumes: value } }))}
        />
        <ToggleRow
          label="All build cache"
          checked={config.options.buildCache}
          onChange={(value) => setConfig((prev) => ({ ...prev, options: { ...prev.options, buildCache: value } }))}
        />

        {config.protectionEnabled ? (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="rounded-xl border border-dock-border/50 bg-dock-bg/20 p-3 text-sm text-dock-text">
              <div className="mb-2 text-xs uppercase tracking-[0.16em] text-dock-muted">Protected Image Labels</div>
              <input
                type="text"
                value={protectedImageLabelsText}
                onChange={(e) => setConfig((prev) => ({ ...prev, protectedImageLabels: parseLabelList(e.target.value) }))}
                placeholder="keep=true, com.dockwatch.keep=true"
                className="w-full rounded-lg border border-dock-border bg-dock-bg/60 px-3 py-2 text-white outline-none focus:border-dock-accent"
              />
              <p className="mt-2 text-xs text-dock-muted">
                Image labels that should never be pruned. Applied as <code>--filter label!=...</code>.
              </p>
            </label>

            <label className="rounded-xl border border-dock-border/50 bg-dock-bg/20 p-3 text-sm text-dock-text">
              <div className="mb-2 text-xs uppercase tracking-[0.16em] text-dock-muted">Protected Volume Labels</div>
              <input
                type="text"
                value={protectedVolumeLabelsText}
                onChange={(e) => setConfig((prev) => ({ ...prev, protectedVolumeLabels: parseLabelList(e.target.value) }))}
                placeholder="keep=true, com.dockwatch.keep=true"
                className="w-full rounded-lg border border-dock-border bg-dock-bg/60 px-3 py-2 text-white outline-none focus:border-dock-accent"
              />
              <p className="mt-2 text-xs text-dock-muted">
                Volume labels that should never be pruned. Applied as <code>--filter label!=...</code>.
              </p>
            </label>
          </div>
        ) : null}
      </section>

      <section className="rounded-[24px] border border-dock-border/70 bg-dock-card/85 p-5 space-y-4">
        <h2 className="text-lg font-bold text-white">Current Reclaimable (Preview)</h2>
        {preview ? (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <PreviewTile label="Containers" total={preview.containers.total} reclaimable={preview.containers.reclaimable} />
            <PreviewTile label="Images" total={preview.images.total} reclaimable={preview.images.reclaimable} />
            <PreviewTile label="Volumes" total={preview.volumes.total} reclaimable={preview.volumes.reclaimable} />
            <PreviewTile label="Build Cache" total={preview.buildCache.total} reclaimable={preview.buildCache.reclaimable} />
          </div>
        ) : (
          <p className="text-sm text-dock-muted">Preview could not be loaded right now.</p>
        )}
      </section>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => setDryRun((v) => !v)}
          className={`rounded-xl border px-5 py-3 text-sm font-bold transition ${dryRun ? 'border-dock-yellow/60 bg-dock-yellow/10 text-dock-yellow' : 'border-dock-border bg-dock-panel text-white hover:border-dock-accent/40'}`}
        >
          Dry Run: {dryRun ? 'On' : 'Off'}
        </button>
        <button
          onClick={saveSchedule}
          disabled={saving}
          className="rounded-xl bg-dock-accent px-5 py-3 text-sm font-bold text-dock-bg transition hover:bg-dock-accent/90 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save & Schedule'}
        </button>
        <button
          onClick={runNow}
          disabled={running}
          className="rounded-xl border border-dock-border bg-dock-panel px-5 py-3 text-sm font-bold text-white transition hover:border-dock-accent/40 hover:bg-dock-panel/85 disabled:opacity-50"
        >
          {running ? (dryRun ? 'Running dry-run...' : 'Running cleanup...') : (dryRun ? 'Preview & Run (Dry)' : 'Preview & Run')}
        </button>
      </div>

      <section className="rounded-[24px] border border-dock-border/70 bg-dock-card/85 p-5 space-y-3">
        <h2 className="text-lg font-bold text-white">Live Output</h2>
        <div className="rounded-xl border border-dock-border/60 bg-[#050b18] p-3">
          <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap text-xs leading-5 text-emerald-200">{liveLog || 'No run output yet. Start a dry-run or cleanup run.'}</pre>
        </div>
      </section>

      {lastRun && (
        <section className="rounded-[24px] border border-dock-border/70 bg-dock-card/85 p-5 space-y-3">
          <h2 className="text-lg font-bold text-white">Last Run Result</h2>
          <div className="grid gap-3 md:grid-cols-4 text-sm">
            <InfoCell label="Status" value={lastRun.success ? 'Success' : 'Failed'} />
            <InfoCell label="Reason" value={lastRun.reason} />
            <InfoCell label="Mode" value={lastRun.dryRun ? 'Dry-run' : 'Live'} />
            <InfoCell label="Reclaimed" value={lastRun.reclaimedHuman} />
          </div>
          {lastRun.error ? (
            <div className="rounded-xl border border-dock-red/30 bg-dock-red/10 px-4 py-3 text-sm text-dock-red">{lastRun.error}</div>
          ) : null}
        </section>
      )}
    </div>
  );
}

function StatTile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl border border-dock-border/60 bg-dock-bg/24 p-3">
      <div className="text-[11px] uppercase tracking-[0.2em] text-dock-muted">{label}</div>
      <div className={`mt-2 text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

function PreviewTile({ label, total, reclaimable }: { label: string; total: number; reclaimable: string }) {
  return (
    <div className="rounded-xl border border-dock-border/60 bg-dock-bg/24 p-3">
      <div className="text-[11px] uppercase tracking-[0.2em] text-dock-muted">{label}</div>
      <div className="mt-2 text-lg font-semibold text-white">{total}</div>
      <div className="text-xs text-dock-muted">Reclaimable: {reclaimable}</div>
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-dock-border/60 bg-dock-bg/24 px-3 py-2">
      <div className="text-[11px] uppercase tracking-[0.2em] text-dock-muted">{label}</div>
      <div className="mt-1 text-white font-medium">{value}</div>
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-dock-border/50 bg-dock-bg/20 px-4 py-3">
      <span className="text-sm text-white">{label}</span>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 items-center rounded-full transition ${checked ? 'bg-dock-green/80' : 'bg-dock-border/70'}`}
      aria-pressed={checked}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}
