import { useState, useEffect } from 'react';
import { getStackResources, updateServiceResources, stackRestart, type ResourceConfig } from '../api';
import AppModal from './AppModal';

interface Props {
  stackName: string;
  onClose: () => void;
}

interface Notice {
  tone: 'success' | 'error';
  text: string;
}

export default function ResourceModal({ stackName, onClose }: Props) {
  const [services, setServices] = useState<Record<string, ResourceConfig>>({});
  const [selected, setSelected] = useState('');
  const [config, setConfig] = useState<ResourceConfig>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [showRestart, setShowRestart] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    void loadResources();
  }, [stackName]);

  const loadResources = async () => {
    setLoading(true);
    try {
      const res = await getStackResources(stackName);
      setServices(res);
      const names = Object.keys(res);
      if (names.length > 0) {
        setSelected(names[0]);
        setConfig(normalizeConfig(res[names[0]]));
      }
    } catch (err: any) {
      setNotice({ tone: 'error', text: err.message || 'Resources could not be loaded.' });
    } finally {
      setLoading(false);
    }
  };

  const handleServiceChange = (name: string) => {
    setSelected(name);
    setConfig(normalizeConfig(services[name] || {}));
    setShowRestart(false);
    setNotice(null);
  };

  const handleSave = async () => {
    const normalized = normalizeConfig(config);
    const validationError = validateConfig(normalized);

    if (validationError) {
      setNotice({ tone: 'error', text: validationError });
      return;
    }

    setSaving(true);
    setNotice(null);
    try {
      await updateServiceResources(stackName, selected, normalized);
      setShowRestart(true);
      setNotice({
        tone: 'success',
        text: 'Compose resources updated. Restart the stack to apply runtime changes.',
      });
      setConfig(normalized);
      setServices((prev) => ({ ...prev, [selected]: normalized }));
    } catch (err: any) {
      setNotice({ tone: 'error', text: err.message || 'Saving resource limits failed.' });
    } finally {
      setSaving(false);
    }
  };

  const handleRestart = async () => {
    setRestarting(true);
    try {
      await stackRestart(stackName);
      setNotice({ tone: 'success', text: 'Stack restarted successfully.' });
      setShowRestart(false);
    } catch (err: any) {
      setNotice({ tone: 'error', text: err.message || 'Stack restart failed.' });
    } finally {
      setRestarting(false);
    }
  };

  const serviceNames = Object.keys(services);
  const selectedConfig = normalizeConfig(services[selected] || {});
  const hasChanges = JSON.stringify(normalizeConfig(config)) !== JSON.stringify(selectedConfig);
  const currentPreview = generatePreview(selected, normalizeConfig(config));

  return (
    <AppModal
      isOpen={true}
      onClose={onClose}
      subtitle="Resource Management"
      title={stackName}
      maxWidthClassName="max-w-3xl"
      footer={(
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="rounded-2xl border border-dock-border bg-transparent px-4 py-2 text-sm font-semibold text-dock-muted transition hover:border-dock-accent/40 hover:text-white"
          >
            Close
          </button>
        </div>
      )}
    >
      <p className="max-w-2xl text-sm leading-6 text-dock-muted">
        DockWatch reads existing compose limits, mirrors compatible service-level keys, and writes a clean
        deploy.resources block for limits and reservations.
      </p>

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
        {loading ? (
          <div className="col-span-full flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-dock-border border-t-dock-accent" />
          </div>
        ) : serviceNames.length === 0 ? (
          <div className="col-span-full rounded-3xl border border-dock-border/70 bg-dock-panel/60 p-6 text-sm text-dock-muted">
            No services were found in this compose stack.
          </div>
        ) : (
          <>
            <div className="space-y-5">
              <div className="rounded-3xl border border-dock-border/70 bg-dock-panel/55 p-4">
                <p className="text-[11px] uppercase tracking-[0.22em] text-dock-muted">Services</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {serviceNames.map((serviceName) => (
                    <button
                      key={serviceName}
                      onClick={() => handleServiceChange(serviceName)}
                      className={[
                        'rounded-2xl border px-4 py-2 text-sm font-semibold transition',
                        selected === serviceName
                          ? 'border-dock-accent bg-dock-accent text-dock-bg'
                          : 'border-dock-border bg-dock-bg/20 text-dock-muted hover:border-dock-accent/35 hover:text-white',
                      ].join(' ')}
                    >
                      {serviceName}
                    </button>
                  ))}
                </div>
              </div>

              <fieldset className="rounded-3xl border border-dock-border/70 bg-dock-panel/55 p-4">
                <legend className="px-2 text-xs font-semibold uppercase tracking-[0.18em] text-dock-red">Limits</legend>
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  <ResourceInput
                    label="CPU cores"
                    value={config.limits_cpus || ''}
                    onChange={(value) => setConfig({ ...config, limits_cpus: value || undefined })}
                    placeholder="2"
                    hint="Hard runtime cap. Stored as deploy.resources.limits.cpus and mirrored to cpus."
                  />
                  <ResourceInput
                    label="Memory"
                    value={config.limits_memory || ''}
                    onChange={(value) => setConfig({ ...config, limits_memory: value || undefined })}
                    placeholder="4096m or 4g"
                    hint="Hard memory cap. Mirrored to mem_limit for broader Compose compatibility."
                  />
                </div>
              </fieldset>

              <fieldset className="rounded-3xl border border-dock-border/70 bg-dock-panel/55 p-4">
                <legend className="px-2 text-xs font-semibold uppercase tracking-[0.18em] text-dock-yellow">Reservations</legend>
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  <ResourceInput
                    label="CPU cores"
                    value={config.reservations_cpus || ''}
                    onChange={(value) => setConfig({ ...config, reservations_cpus: value || undefined })}
                    placeholder="1"
                    hint="Guaranteed CPU request. Stored in deploy.resources.reservations.cpus."
                  />
                  <ResourceInput
                    label="Memory"
                    value={config.reservations_memory || ''}
                    onChange={(value) => setConfig({ ...config, reservations_memory: value || undefined })}
                    placeholder="2048m or 2g"
                    hint="Guaranteed memory request. Also mirrored to mem_reservation."
                  />
                </div>
              </fieldset>

              {notice && (
                <div className={[
                  'rounded-2xl border px-4 py-3 text-sm',
                  notice.tone === 'error'
                    ? 'border-dock-red/40 bg-dock-red/12 text-dock-red'
                    : 'border-dock-green/40 bg-dock-green/12 text-dock-green',
                ].join(' ')}>
                  {notice.text}
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleSave}
                  disabled={saving || !selected || !hasChanges}
                  className="rounded-2xl bg-dock-accent px-5 py-3 text-sm font-semibold text-dock-bg transition hover:bg-dock-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save to Compose'}
                </button>
                <button
                  onClick={() => setConfig({})}
                  className="rounded-2xl border border-dock-border bg-transparent px-5 py-3 text-sm font-semibold text-dock-muted transition hover:border-dock-red/35 hover:text-white"
                >
                  Clear Constraints
                </button>
                {showRestart && (
                  <button
                    onClick={handleRestart}
                    disabled={restarting}
                    className="rounded-2xl border border-dock-yellow/45 bg-dock-yellow/14 px-5 py-3 text-sm font-semibold text-dock-yellow transition hover:bg-dock-yellow/18 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {restarting ? 'Restarting...' : 'Restart Stack'}
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-3xl border border-dock-border/70 bg-dock-panel/55 p-4">
                <p className="text-[11px] uppercase tracking-[0.22em] text-dock-muted">Compose Preview</p>
                <pre className="mt-3 overflow-x-auto rounded-2xl border border-dock-border/60 bg-black/18 p-4 text-xs text-dock-text">{currentPreview}</pre>
              </div>

              <div className="rounded-3xl border border-dock-border/70 bg-dock-bg/24 p-4">
                <p className="text-[11px] uppercase tracking-[0.22em] text-dock-muted">Current Detection</p>
                <dl className="mt-3 space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-dock-muted">Limit CPU</dt>
                    <dd className="font-medium text-white">{selectedConfig.limits_cpus || 'not set'}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-dock-muted">Limit memory</dt>
                    <dd className="font-medium text-white">{selectedConfig.limits_memory || 'not set'}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-dock-muted">Reservation CPU</dt>
                    <dd className="font-medium text-white">{selectedConfig.reservations_cpus || 'not set'}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-dock-muted">Reservation memory</dt>
                    <dd className="font-medium text-white">{selectedConfig.reservations_memory || 'not set'}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </>
        )}
      </div>
    </AppModal>
  );
}

function ResourceInput({ label, value, onChange, placeholder, hint }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string; hint: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-semibold text-white">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-dock-border bg-dock-bg/30 px-3 py-2.5 text-sm text-white outline-none transition focus:border-dock-accent"
      />
      <p className="mt-1 text-xs leading-5 text-dock-muted">{hint}</p>
    </div>
  );
}

function normalizeConfig(config: ResourceConfig): ResourceConfig {
  return {
    limits_cpus: config.limits_cpus?.trim() || undefined,
    limits_memory: config.limits_memory?.trim() || undefined,
    reservations_cpus: config.reservations_cpus?.trim() || undefined,
    reservations_memory: config.reservations_memory?.trim() || undefined,
  };
}

function validateConfig(config: ResourceConfig): string | null {
  const cpuFields = [
    ['limit CPU', config.limits_cpus],
    ['reservation CPU', config.reservations_cpus],
  ] as const;

  for (const [label, value] of cpuFields) {
    if (value && !/^\d+(\.\d+)?$/.test(value)) {
      return `${label} must be a plain numeric core value such as 0.5, 1, or 2.5.`;
    }
  }

  const memoryFields = [
    ['limit memory', config.limits_memory],
    ['reservation memory', config.reservations_memory],
  ] as const;

  for (const [label, value] of memoryFields) {
    if (value && !/^\d+(\.\d+)?([bkmgtepBKMGTEP])?$/i.test(value)) {
      return `${label} must look like 512m, 2g, or 1024.`;
    }
  }

  return null;
}

function generatePreview(service: string, config: ResourceConfig): string {
  const hasLimits = config.limits_cpus || config.limits_memory;
  const hasReservations = config.reservations_cpus || config.reservations_memory;
  if (!service) return '# No service selected';
  if (!hasLimits && !hasReservations) return `# No resource constraints set for ${service}`;

  const lines = ['services:', `  ${service}:`];

  if (hasLimits) {
    if (config.limits_cpus) lines.push(`    cpus: "${config.limits_cpus}"`);
    if (config.limits_memory) lines.push(`    mem_limit: ${config.limits_memory}`);
  }
  if (hasReservations) {
    if (config.reservations_memory) lines.push(`    mem_reservation: ${config.reservations_memory}`);
  }

  lines.push('    deploy:', '      resources:');

  if (hasLimits) {
    lines.push('        limits:');
    if (config.limits_cpus) lines.push(`          cpus: "${config.limits_cpus}"`);
    if (config.limits_memory) lines.push(`          memory: ${config.limits_memory}`);
  }

  if (hasReservations) {
    lines.push('        reservations:');
    if (config.reservations_cpus) lines.push(`          cpus: "${config.reservations_cpus}"`);
    if (config.reservations_memory) lines.push(`          memory: ${config.reservations_memory}`);
  }

  return lines.join('\n');
}
