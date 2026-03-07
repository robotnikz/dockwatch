import { useState, useEffect } from 'react';
import { getSettings, saveSettings, testWebhook } from '../api';

export default function Settings() {
  const [data, setData] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    getSettings()
      .then((res) => {
        setData(res);
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

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await saveSettings(data);
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
                value={data.discord_webhook_url || ''}
                onChange={(e) => handleChange('discord_webhook_url', e.target.value)}
                placeholder="https://discord.com/api/webhooks/..."
                className="w-full rounded-xl border border-dock-border bg-dock-bg/50 px-4 py-2.5 text-sm text-white focus:border-dock-accent outline-none transition"
              />
              <p className="mt-2 text-xs text-dock-muted">
                If provided, DockWatch will send notifications about update availability to this channel.
              </p>
            </div>
            {data.discord_webhook_url && (
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
          <div>
            <label className="mb-2 block text-sm font-medium text-dock-text">Cron Schedule</label>
            <input
              type="text"
              value={data.cron_schedule || ''}
              onChange={(e) => handleChange('cron_schedule', e.target.value)}
              placeholder="0 0 * * *"
              className="w-full rounded-xl border border-dock-border bg-dock-bg/50 px-4 py-2.5 text-sm text-white focus:border-dock-accent outline-none font-mono transition"
            />
            <p className="mt-2 text-xs text-dock-muted">
              Standard cron expression (e.g. <code>0 0 * * *</code> for daily at midnight). 
              Leave empty to disable automatic background checks.
            </p>
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
