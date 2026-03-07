import type { Stack, UpdateStatus } from '../api';

interface Props {
  stack: Stack;
  updates: UpdateStatus[];
  actionLoading: string | null;
  onAction: (name: string, action: 'up' | 'down' | 'update' | 'logs' | 'resources') => void;
  onEdit: () => void;
}

const statusBadgeClasses: Record<Stack['status'], string> = {
  running: 'border-dock-green/30 bg-dock-green/12 text-dock-green',
  partial: 'border-dock-yellow/30 bg-dock-yellow/12 text-dock-yellow',
  stopped: 'border-dock-red/30 bg-dock-red/12 text-dock-red',
  unknown: 'border-dock-border bg-dock-panel/60 text-dock-muted',
};

export default function StackCard({ stack, updates, actionLoading, onAction, onEdit }: Props) {
  const hasUpdate = updates.some(
    (update) => update.updateAvailable && stack.services.some((service) => service.Name?.includes(stack.name))
  );
  const runningServices = stack.services.filter((service) => service.State === 'running').length;
  const isLoading = (action: string) => actionLoading === `${stack.name}-${action}`;

  return (
    <div className="rounded-[26px] border border-dock-border/70 bg-dock-card/90 p-5 shadow-dock transition duration-200 hover:-translate-y-0.5 hover:border-dock-accent/35">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xl font-bold tracking-tight text-white">{stack.name}</h3>
            {hasUpdate && (
              <span className="rounded-full border border-dock-yellow/30 bg-dock-yellow/12 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-dock-yellow">
                Update ready
              </span>
            )}
          </div>
          <p className="text-sm text-dock-muted">
            {runningServices} of {stack.services.length} service{stack.services.length === 1 ? '' : 's'} running
          </p>
        </div>

        <span className={[
          'rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em]',
          statusBadgeClasses[stack.status],
        ].join(' ')}>
          {stack.status}
        </span>
      </div>

      <div className="mb-5 rounded-2xl border border-dock-border/60 bg-dock-panel/65 p-3">
        {stack.services.length > 0 ? (
          <div className="space-y-2">
            {stack.services.map((service) => (
              <div key={service.Name} className="flex items-center gap-3 rounded-2xl bg-dock-bg/30 px-3 py-2 text-sm">
                <div className={`h-2 w-2 rounded-full ${service.State === 'running' ? 'bg-dock-green' : 'bg-dock-red'}`} />
                <span className="min-w-0 flex-1 truncate text-white">{service.Service || service.Name}</span>
                <span className="text-xs text-dock-muted">{service.Status}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-dock-muted">No compose services are running for this stack.</p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {stack.status === 'stopped' || stack.status === 'unknown' ? (
          <ActionButton
            label="Start"
            loading={isLoading('up')}
            onClick={() => onAction(stack.name, 'up')}
            color="bg-dock-green text-dock-bg hover:bg-dock-green/90"
          />
        ) : (
          <ActionButton
            label="Stop"
            loading={isLoading('down')}
            onClick={() => onAction(stack.name, 'down')}
            color="bg-dock-red text-white hover:bg-dock-red/90"
          />
        )}

        <ActionButton
          label="Update"
          loading={isLoading('update')}
          onClick={() => onAction(stack.name, 'update')}
          color="border border-dock-border bg-dock-panel text-white hover:border-dock-accent/40 hover:bg-dock-panel/80"
        />

        <ActionButton
          label="Logs"
          loading={isLoading('logs')}
          onClick={() => onAction(stack.name, 'logs')}
          color="border border-dock-border bg-transparent text-dock-muted hover:border-dock-border hover:bg-dock-panel/50 hover:text-white"
        />

        <button
          onClick={() => onAction(stack.name, 'resources')}
          className="rounded-2xl border border-dock-border bg-transparent px-4 py-2 text-sm font-semibold text-dock-muted transition hover:border-dock-accent/40 hover:bg-dock-panel/50 hover:text-white"
        >
          Resources
        </button>

        <button
          onClick={onEdit}
          className="rounded-2xl border border-dock-border bg-transparent px-4 py-2 text-sm font-semibold text-dock-muted transition hover:border-dock-accent/40 hover:bg-dock-panel/50 hover:text-white"
        >
          Edit
        </button>
      </div>
    </div>
  );
}

function ActionButton({ label, loading, onClick, color }: {
  label: string;
  loading: boolean;
  onClick: () => void;
  color: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={[
        'rounded-2xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
        color,
      ].join(' ')}
    >
      {loading ? 'Working...' : label}
    </button>
  );
}
