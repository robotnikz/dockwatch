import { useState, useEffect } from 'react';
import { getSettings, saveSettings, testWebhook } from '../api';

type ScheduleMode = 'disabled' | 'daily' | 'weekly' | 'monthly' | 'custom';

function parseCronToUi(cron: string): {
  mode: ScheduleMode;
  time: string;
  weekday: string;
  monthday: string;
  customCron: string;
} {
  const trimmed = String(cron || '').trim();
  if (!trimmed) {
    return { mode: 'disabled', time: '00:00', weekday: '0', monthday: '1', customCron: '' };
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length === 5) {
    const [min, hour, dom, mon, dow] = parts;
    const mm = String(parseInt(min, 10));
    const hh = String(parseInt(hour, 10));
    const validTime = /^\d+$/.test(mm) && /^\d+$/.test(hh) && Number(mm) >= 0 && Number(mm) <= 59 && Number(hh) >= 0 && Number(hh) <= 23;
    const time = validTime ? `${String(Number(hh)).padStart(2, '0')}:${String(Number(mm)).padStart(2, '0')}` : '00:00';

    if (validTime && dom === '*' && mon === '*' && dow === '*') {
      return { mode: 'daily', time, weekday: '0', monthday: '1', customCron: trimmed };
    }
    if (validTime && dom === '*' && mon === '*' && /^([0-6]|7)$/.test(dow)) {
      return { mode: 'weekly', time, weekday: dow === '7' ? '0' : dow, monthday: '1', customCron: trimmed };
    }
    if (validTime && /^([1-9]|[12]\d|3[01])$/.test(dom) && mon === '*' && dow === '*') {
      return { mode: 'monthly', time, weekday: '0', monthday: dom, customCron: trimmed };
    }
  }

  return { mode: 'custom', time: '00:00', weekday: '0', monthday: '1', customCron: trimmed };
}

function buildCronFromUi(mode: ScheduleMode, time: string, weekday: string, monthday: string, customCron: string): string {
  const [hhRaw, mmRaw] = (time || '00:00').split(':');
  const hh = Math.min(23, Math.max(0, parseInt(hhRaw || '0', 10) || 0));
  const mm = Math.min(59, Math.max(0, parseInt(mmRaw || '0', 10) || 0));

  if (mode === 'disabled') return '';
  if (mode === 'daily') return `${mm} ${hh} * * *`;
  if (mode === 'weekly') return `${mm} ${hh} * * ${weekday || '0'}`;
  if (mode === 'monthly') {
    const day = Math.min(31, Math.max(1, parseInt(monthday || '1', 10) || 1));
    return `${mm} ${hh} ${day} * *`;
  }
  return customCron.trim();
}

export default function Settings() {
  const [data, setData] = useState<Record<string, string>>({});
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('daily');
  const [scheduleTime, setScheduleTime] = useState('00:00');
  const [scheduleWeekday, setScheduleWeekday] = useState('0');
  const [scheduleMonthday, setScheduleMonthday] = useState('1');
  const [customCron, setCustomCron] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    getSettings()
      .then((res) => {
        setData(res);
        const parsed = parseCronToUi(String(res.check_cron || ''));
        setScheduleMode(parsed.mode);
        setScheduleTime(parsed.time);
        setScheduleWeekday(parsed.weekday);
        setScheduleMonthday(parsed.monthday);
        setCustomCron(parsed.customCron);
        setLoading(false);
      })
      .catch((err) => {
        setMessage({ tone: 'error', text: err.message });
        setLoading(false);
      });
  }, []);

  const handleChange = (key: string, value: string) => {
    setData((prev) => ({ ...prev, [key]: value }));
  };

  const boolValue = (key: string, defaultValue = false) => {
    const raw = data[key];
    if (raw == null || raw === '') return defaultValue;
    return String(raw).toLowerCase() === 'true';
  };

  const handleToggle = (key: string, defaultValue = false) => {
    const next = !boolValue(key, defaultValue);
    handleChange(key, String(next));
  };

  const updateSchedule = (
    mode: ScheduleMode,
    time: string,
    weekday: string,
    monthday: string,
    cron: string,
  ) => {
    const expression = buildCronFromUi(mode, time, weekday, monthday, cron);
    handleChange('check_cron', expression);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const payload: Record<string, string> = { ...data };
      delete payload.discord_webhook_set;

      // Keep existing webhook unchanged when the field still contains masked text from GET.
      if (payload.discord_webhook && payload.discord_webhook.includes('...')) {
        delete payload.discord_webhook;
      }

      await saveSettings(payload);
      setMessage({ tone: 'success', text: 'Settings saved successfully.' });
    } catch (err: any) {
      setMessage({ tone: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setMessage(null);
    try {
      await testWebhook();
      setMessage({ tone: 'success', text: 'Test webhook sent.' });
    } catch (err: any) {
      setMessage({ tone: 'error', text: err.message || 'Test failed' });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-dock-border border-t-dock-accent" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="pb-4 border-b border-dock-border/50">
        <p className="text-[11px] uppercase tracking-[0.26em] text-dock-muted">System Configuration</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-white">Settings</h1>
      </div>

      {message && (
        <div className={`rounded-xl px-4 py-3 text-sm font-medium ${message.tone === 'success' ? 'bg-dock-green/10 text-dock-green border border-dock-green/20' : 'bg-dock-red/10 text-dock-red border border-dock-red/20'}`}>
          {message.text}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        <div className="rounded-2xl border border-dock-border/50 bg-dock-card p-6">
          <h2 className="text-xl font-bold text-white mb-4">Discord Notifications</h2>
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-dock-text">Webhook URL</label>
              <input
                type="url"
                value={data.discord_webhook || ''}
                onChange={(e) => handleChange('discord_webhook', e.target.value)}
                placeholder="https://discord.com/api/webhooks/..."
                className="w-full rounded-xl border border-dock-border bg-dock-bg/50 px-4 py-2.5 text-sm text-white focus:border-dock-accent outline-none transition"
              />
              <p className="mt-2 text-xs text-dock-muted">
                If provided, DockWatch will send notifications about update availability to this channel.
              </p>
            </div>

            <div className="space-y-2">
              <ToggleRow
                label="Container-Update notifications"
                description="Send a message when image updates are detected."
                checked={boolValue('discord_notify_container_updates', true)}
                onToggle={() => handleToggle('discord_notify_container_updates', true)}
              />
              <ToggleRow
                label="Prune messages"
                description="Send a message after cleanup runs (success/failure)."
                checked={boolValue('discord_notify_prune_messages', true)}
                onToggle={() => handleToggle('discord_notify_prune_messages', true)}
              />
            </div>

            {data.discord_webhook && (
              <button
                type="button"
                onClick={handleTest}
                disabled={testing}
                className="rounded-xl border border-dock-border bg-dock-panel px-4 py-2 text-sm font-semibold text-white transition hover:bg-dock-border disabled:opacity-50"
              >
                {testing ? 'Sending...' : 'Test Webhook'}
              </button>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-dock-border/50 bg-dock-card p-6">
          <h2 className="text-xl font-bold text-white mb-4">Update Checker</h2>

          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-dock-text">Schedule Mode</label>
              <select
                value={scheduleMode}
                onChange={(e) => {
                  const next = e.target.value as ScheduleMode;
                  setScheduleMode(next);
                  updateSchedule(next, scheduleTime, scheduleWeekday, scheduleMonthday, customCron);
                }}
                className="w-full rounded-xl border border-dock-border bg-dock-bg/50 px-4 py-2.5 text-sm text-white focus:border-dock-accent outline-none transition"
              >
                <option value="disabled">Disabled</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="custom">Custom (Cron)</option>
              </select>
            </div>

            {scheduleMode !== 'disabled' && scheduleMode !== 'custom' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-dock-text">Time</label>
                  <input
                    type="time"
                    value={scheduleTime}
                    onChange={(e) => {
                      setScheduleTime(e.target.value);
                      updateSchedule(scheduleMode, e.target.value, scheduleWeekday, scheduleMonthday, customCron);
                    }}
                    className="w-full rounded-xl border border-dock-border bg-dock-bg/50 px-4 py-2.5 text-sm text-white focus:border-dock-accent outline-none transition"
                  />
                </div>

                {scheduleMode === 'weekly' ? (
                  <div>
                    <label className="mb-2 block text-sm font-medium text-dock-text">Weekday</label>
                    <select
                      value={scheduleWeekday}
                      onChange={(e) => {
                        setScheduleWeekday(e.target.value);
                        updateSchedule(scheduleMode, scheduleTime, e.target.value, scheduleMonthday, customCron);
                      }}
                      className="w-full rounded-xl border border-dock-border bg-dock-bg/50 px-4 py-2.5 text-sm text-white focus:border-dock-accent outline-none transition"
                    >
                      <option value="0">Sunday</option>
                      <option value="1">Monday</option>
                      <option value="2">Tuesday</option>
                      <option value="3">Wednesday</option>
                      <option value="4">Thursday</option>
                      <option value="5">Friday</option>
                      <option value="6">Saturday</option>
                    </select>
                  </div>
                ) : null}

                {scheduleMode === 'monthly' ? (
                  <div>
                    <label className="mb-2 block text-sm font-medium text-dock-text">Day of Month</label>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={scheduleMonthday}
                      onChange={(e) => {
                        const value = e.target.value || '1';
                        setScheduleMonthday(value);
                        updateSchedule(scheduleMode, scheduleTime, scheduleWeekday, value, customCron);
                      }}
                      className="w-full rounded-xl border border-dock-border bg-dock-bg/50 px-4 py-2.5 text-sm text-white focus:border-dock-accent outline-none transition"
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

            {scheduleMode === 'custom' ? (
              <div>
                <label className="mb-2 block text-sm font-medium text-dock-text">Cron Expression</label>
                <input
                  type="text"
                  value={customCron}
                  onChange={(e) => {
                    setCustomCron(e.target.value);
                    updateSchedule(scheduleMode, scheduleTime, scheduleWeekday, scheduleMonthday, e.target.value);
                  }}
                  placeholder="0 0 * * *"
                  className="w-full rounded-xl border border-dock-border bg-dock-bg/50 px-4 py-2.5 text-sm text-white focus:border-dock-accent outline-none font-mono transition"
                />
              </div>
            ) : null}

            <details className="rounded-xl border border-dock-border/60 bg-dock-bg/20 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-white">Advanced Filters</summary>
              <div className="mt-3 space-y-2">
                <label className="block text-sm font-medium text-dock-text">Excluded Containers / Images (optional)</label>
                <textarea
                  value={data.update_exclusions || ''}
                  onChange={(e) => handleChange('update_exclusions', e.target.value)}
                  placeholder="e.g. linuxserver/mariadb, portainer (comma separated)"
                  rows={3}
                  className="w-full rounded-xl border border-dock-border bg-dock-bg/50 px-4 py-2.5 text-sm text-white focus:border-dock-accent outline-none font-mono transition"
                />
                <p className="text-xs text-dock-muted">
                  Usually not needed if you use per-container check toggles. Keep this for global exclusions across all stacks.
                </p>

                <div className="rounded-lg border border-dock-border/60 bg-dock-bg/30 px-3 py-2 text-xs text-dock-muted font-mono">
                  Effective cron: {data.check_cron?.trim() || '(disabled)'}
                </div>
              </div>
            </details>
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-xl bg-dock-accent px-5 py-3 text-sm font-bold text-dock-bg transition hover:bg-dock-accent/90 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </form>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onToggle,
}: {
  label: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-dock-border/60 bg-dock-bg/25 px-3 py-2.5">
      <div>
        <div className="text-sm font-medium text-white">{label}</div>
        <div className="text-xs text-dock-muted">{description}</div>
      </div>
      <button
        type="button"
        onClick={onToggle}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${checked ? 'bg-dock-accent/80' : 'bg-dock-border/70'}`}
        aria-pressed={checked}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  );
}
