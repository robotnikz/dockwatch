import { useState, useEffect, useCallback } from 'react';
import { getStats, getStacks, getStackResources, updateServiceResources, type ContainerStats, type HostInfo } from '../api';

type ContainerUpdateMeta = {
  stack: string;
  service: string;
  excluded: boolean;
};

export default function StatsPanel() {
  const [host, setHost] = useState<HostInfo | null>(null);
  const [containers, setContainers] = useState<ContainerStats[]>([]);
  const [sortCol, setSortCol] = useState<string>('cpu_percent');
  const [sortDesc, setSortDesc] = useState<boolean>(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [updateMeta, setUpdateMeta] = useState<Record<string, ContainerUpdateMeta>>({});
  const [toggling, setToggling] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    try {
      const data = await getStats();
      setHost(data.host);
      setContainers(data.containers);
      setError(null);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err) {
      console.error('Stats fetch failed:', err);
      setError('Docker stats could not be loaded. Check Docker socket access for the DockWatch server.');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshUpdateMeta = useCallback(async () => {
    try {
      const stacks = await getStacks();
      const entries = await Promise.all(
        stacks.map(async (stack) => {
          try {
            const resources = await getStackResources(stack.name);
            return { stack, resources };
          } catch {
            return { stack, resources: {} as Record<string, { update_excluded?: boolean }> };
          }
        })
      );

      const next: Record<string, ContainerUpdateMeta> = {};
      for (const { stack, resources } of entries) {
        for (const svc of stack.services) {
          const containerName = String(svc.Name || '').replace(/^\//, '');
          if (!containerName) continue;
          next[containerName] = {
            stack: stack.name,
            service: svc.Service,
            excluded: Boolean(resources[svc.Service]?.update_excluded),
          };
        }
      }
      setUpdateMeta(next);
    } catch {
      // Non-critical metadata; table should still render stats if this fails.
    }
  }, []);

  useEffect(() => {
    refresh();
    refreshUpdateMeta();
  }, [refresh, refreshUpdateMeta]);

  // Live refresh every 5 seconds
  useEffect(() => {
    const id = setInterval(refresh, 5_000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const id = setInterval(refreshUpdateMeta, 20_000);
    return () => clearInterval(id);
  }, [refreshUpdateMeta]);

  const toggleUpdateExclusion = async (containerName: string) => {
    const meta = updateMeta[containerName];
    if (!meta) return;
    const nextExcluded = !meta.excluded;

    setToggling((prev) => ({ ...prev, [containerName]: true }));
    setUpdateMeta((prev) => ({
      ...prev,
      [containerName]: { ...meta, excluded: nextExcluded },
    }));

    try {
      await updateServiceResources(meta.stack, meta.service, { update_excluded: nextExcluded });
    } catch {
      // Roll back optimistic state on error.
      setUpdateMeta((prev) => ({
        ...prev,
        [containerName]: { ...meta, excluded: meta.excluded },
      }));
    } finally {
      setToggling((prev) => ({ ...prev, [containerName]: false }));
    }
  };

  if (loading) {
    return (
      <div className="rounded-[28px] border border-dock-border/70 bg-dock-card/80 p-5 shadow-dock">
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((index) => (
            <div key={index} className="h-24 animate-pulse rounded-3xl bg-dock-panel/80" />
          ))}
        </div>
      </div>
    );
  }

  const totalCpu = containers.reduce((s, c) => s + c.cpu_percent, 0);
  const totalMem = containers.reduce((s, c) => s + c.mem_percent, 0);

  const sortedContainers = [...containers].sort((a, b) => {
    let valA: any = a[sortCol as keyof ContainerStats];
    let valB: any = b[sortCol as keyof ContainerStats];

    const parseMem = (str: string) => {
      if (!str) return 0;
      const num = parseFloat(str);
      if (str.includes('GiB')) return num * 1024 * 1024 * 1024;
      if (str.includes('MiB')) return num * 1024 * 1024;
      if (str.includes('KiB')) return num * 1024;
      if (str.includes('B')) return num;
      return num;
    };

    if (sortCol === 'mem_usage') {
      valA = parseMem(a.mem_usage);
      valB = parseMem(b.mem_usage);
    } else if (sortCol === 'net_io') {
      valA = parseMem(a.net_io?.split(' / ')[0] || '0');
      valB = parseMem(b.net_io?.split(' / ')[0] || '0');
    } else if (sortCol === 'block_io') {
      valA = parseMem(a.block_io?.split(' / ')[0] || '0');
      valB = parseMem(b.block_io?.split(' / ')[0] || '0');
    } else if (sortCol === 'name') {
      valA = a.name.toLowerCase();
      valB = b.name.toLowerCase();
    }

    if (valA < valB) return sortDesc ? 1 : -1;
    if (valA > valB) return sortDesc ? -1 : 1;
    return 0;
  });

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDesc(!sortDesc);
    } else {
      setSortCol(col);
      setSortDesc(col !== 'name'); // default desc for metric numbers
    }
  };

  const SortIcon = ({ col }: { col: string }) => {
    if (sortCol !== col) return <span className="opacity-0 group-hover:opacity-40 inline-block w-4 text-center">↕</span>;
    return <span className="inline-block w-4 text-center text-dock-accent">{sortDesc ? '↓' : '↑'}</span>;
  };

  const topConsumers = [...containers].sort((a, b) => b.cpu_percent - a.cpu_percent).slice(0, 3).map((c) => c.name).join(', ');

  return (
    <section className="space-y-4 rounded-[28px] border border-dock-border/70 bg-dock-card/80 p-5 shadow-dock lg:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.28em] text-dock-muted">Live Runtime</p>
          <h3 className="mt-1 text-2xl font-bold tracking-tight text-white">Docker host telemetry</h3>
        </div>
        <div className="text-sm text-dock-muted">
          {error ? error : `Last refresh ${lastUpdated ?? 'just now'}`}
        </div>
      </div>

      {host && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Containers"
            value={`${host.containers_running} / ${host.containers_total}`}
            sub={`${containers.length} reporting live stats`}
            accent="text-dock-green"
          />
          <StatCard
            label="CPU Load"
            value={`${totalCpu.toFixed(1)}%`}
            sub={`${host.cpus} cores available`}
            accent={totalCpu > 80 ? 'text-dock-red' : totalCpu > 50 ? 'text-dock-yellow' : 'text-dock-green'}
          />
          <StatCard
            label="Memory Pressure"
            value={`${totalMem.toFixed(1)}%`}
            sub={host.memory_total}
            accent={totalMem > 80 ? 'text-dock-red' : totalMem > 50 ? 'text-dock-yellow' : 'text-dock-green'}
          />
          <StatCard
            label="Docker"
            value={`v${host.server_version}`}
            sub={`${host.os} (${host.architecture})`}
            accent="text-dock-accent"
          />
        </div>
      )}

      <div className="rounded-[24px] border border-dock-border/70 bg-dock-panel/55 overflow-hidden">
        <div className="flex flex-col gap-2 border-b border-dock-border/70 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-[0.22em] text-dock-muted">Container Stats</h4>
            <p className="mt-1 text-sm text-white">
              {sortedContainers.length > 0 ? `Top consumers: ${topConsumers || 'n/a'}` : 'No active containers reported.'}
            </p>
          </div>
        </div>

        {sortedContainers.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-dock-border/70 text-dock-muted">
                  <th className="px-4 py-3 text-left font-medium cursor-pointer group hover:text-dock-accent transition select-none" onClick={() => handleSort('name')}>Container <SortIcon col="name"/></th>
                  <th className="px-4 py-3 text-right font-medium cursor-pointer group hover:text-dock-accent transition select-none" onClick={() => handleSort('cpu_percent')}><SortIcon col="cpu_percent"/> CPU</th>
                  <th className="px-4 py-3 text-right font-medium cursor-pointer group hover:text-dock-accent transition select-none" onClick={() => handleSort('mem_usage')}><SortIcon col="mem_usage"/> Memory</th>
                  <th className="hidden px-4 py-3 text-right font-medium md:table-cell cursor-pointer group hover:text-dock-accent transition select-none" onClick={() => handleSort('mem_percent')}><SortIcon col="mem_percent"/> Mem %</th>
                  <th className="hidden px-4 py-3 text-right font-medium lg:table-cell cursor-pointer group hover:text-dock-accent transition select-none" onClick={() => handleSort('net_io')}><SortIcon col="net_io"/> Net I/O</th>
                  <th className="hidden px-4 py-3 text-right font-medium lg:table-cell cursor-pointer group hover:text-dock-accent transition select-none" onClick={() => handleSort('block_io')}><SortIcon col="block_io"/> Block I/O</th>
                  <th className="hidden px-4 py-3 text-right font-medium md:table-cell cursor-pointer group hover:text-dock-accent transition select-none" onClick={() => handleSort('pids')}><SortIcon col="pids"/> PIDs</th>
                  <th className="px-4 py-3 text-right font-medium">Updates</th>
                </tr>
              </thead>
              <tbody>
                {sortedContainers.map((container) => (
                  <tr key={container.id} className="border-b border-dock-border/40 transition hover:bg-dock-bg/18">
                    <td className="max-w-[240px] truncate px-4 py-3 text-sm font-semibold text-white">{container.name}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={container.cpu_percent > 80 ? 'text-dock-red' : container.cpu_percent > 50 ? 'text-dock-yellow' : 'text-dock-text'}>
                        {container.cpu_percent.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-dock-text">
                      {container.mem_usage} / {container.mem_limit}
                    </td>
                    <td className="hidden px-4 py-3 text-right md:table-cell">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-dock-border/60">
                          <div
                            className={`h-full rounded-full ${container.mem_percent > 80 ? 'bg-dock-red' : container.mem_percent > 50 ? 'bg-dock-yellow' : 'bg-dock-green'}`}
                            style={{ width: `${Math.min(container.mem_percent, 100)}%` }}
                          />
                        </div>
                        <span className="w-10 text-right text-dock-muted">{container.mem_percent.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 text-right text-dock-muted lg:table-cell">{container.net_io}</td>
                    <td className="hidden px-4 py-3 text-right text-dock-muted lg:table-cell">{container.block_io}</td>
                    <td className="hidden px-4 py-3 text-right text-dock-muted md:table-cell">{container.pids}</td>
                    <td className="px-4 py-3 text-right">
                      {updateMeta[container.name] ? (
                        <button
                          type="button"
                          onClick={() => toggleUpdateExclusion(container.name)}
                          disabled={Boolean(toggling[container.name])}
                          className="inline-flex items-center justify-end disabled:opacity-60"
                          title={updateMeta[container.name].excluded ? 'Container ist von Updates ausgeschlossen' : 'Container wird bei Updates berücksichtigt'}
                        >
                          <span className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${updateMeta[container.name].excluded ? 'bg-dock-border/70' : 'bg-dock-accent/80'}`}>
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${updateMeta[container.name].excluded ? 'translate-x-1' : 'translate-x-6'}`} />
                          </span>
                        </button>
                      ) : (
                        <span className="text-dock-muted/70">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-4 py-10 text-center text-sm text-dock-muted">
            No running containers reported by Docker at the moment.
          </div>
        )}
      </div>
    </section>
  );
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div className="rounded-3xl border border-dock-border/70 bg-dock-bg/26 p-4">
      <p className="text-[11px] uppercase tracking-[0.22em] text-dock-muted">{label}</p>
      <p className={`mt-3 text-3xl font-bold tracking-tight ${accent}`}>{value}</p>
      <p className="mt-1 text-sm text-dock-muted">{sub}</p>
    </div>
  );
}
