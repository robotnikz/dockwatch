import { useState, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { getStacks, getAppVersionStatus, triggerSelfUpdate, type AppVersionStatus, type Stack } from '../api';

export default function Sidebar() {
  const [stacks, setStacks] = useState<Stack[]>([]);
  const [appVersion, setAppVersion] = useState<AppVersionStatus | null>(null);
  const [search, setSearch] = useState('');
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [reloadCountdown, setReloadCountdown] = useState<number | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const fetchStacks = () => getStacks().then(setStacks).catch(console.error);
  const fetchAppVersion = (force = false) =>
    getAppVersionStatus(force).then(setAppVersion).catch(console.error);

  useEffect(() => {
    fetchStacks();
    const id = setInterval(fetchStacks, 10000); // 10s auto-refresh for sidebar
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    fetchAppVersion(true);
    const id = setInterval(() => fetchAppVersion(false), 60 * 60 * 1000); // hourly check
    return () => clearInterval(id);
  }, []);

  const filteredStacks = stacks.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()));
  const selfUpdateSupported = Boolean(appVersion?.selfUpdate?.supported);

  useEffect(() => {
    if (reloadCountdown == null || reloadCountdown <= 0) return;
    const id = setInterval(() => {
      setReloadCountdown((prev) => {
        if (prev == null) return prev;
        if (prev <= 1) {
          window.location.reload();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [reloadCountdown]);

  const onUpdateBadgeClick = () => {
    if (!appVersion?.updateAvailable) return;
    setUpdateError(null);
    setShowUpdateModal(true);
  };

  const startSelfUpdate = async () => {
    setUpdating(true);
    setUpdateError(null);
    try {
      const result = await triggerSelfUpdate();
      setReloadCountdown(result.reloadAfterSeconds || 30);
    } catch (err: any) {
      setUpdateError(err.message || 'Self update failed to start');
      setUpdating(false);
    }
  };

  const versionBadge = (() => {
    if (!appVersion) {
      return <span className="rounded-full bg-dock-border/40 px-2 py-0.5 text-[10px] font-semibold text-dock-muted">Checking...</span>;
    }
    if (appVersion.checkFailed) {
      return <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-semibold text-rose-300">Check Failed</span>;
    }
    if (appVersion.updateAvailable) {
      return (
        <button
          type="button"
          onClick={onUpdateBadgeClick}
          className="cursor-pointer rounded-full border border-amber-400/40 bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-300 transition hover:bg-amber-500/30 hover:text-amber-200"
          title={selfUpdateSupported ? 'Run DockWatch self update' : 'Open release page'}
        >
          Update Available - Click
        </button>
      );
    }
    return <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">Up To Date</span>;
  })();

  return (
    <aside className="w-[280px] shrink-0 border-r border-dock-border/50 bg-dock-card/60 flex flex-col">
      <div className="p-5 flex items-center gap-3 cursor-pointer" onClick={() => navigate('/')}>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-dock-accent text-dock-bg text-xl font-bold shadow-lg shadow-dock-accent/20">
          🐳
        </div>
        <span className="text-xl font-bold text-white tracking-wide">DockWatch</span>
      </div>

      <div className="px-5 pb-4">
        <button
          onClick={() => navigate('/new')}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-dock-accent/15 px-4 py-2.5 text-sm font-semibold text-dock-accent transition hover:bg-dock-accent hover:text-dock-bg"
        >
          <span className="text-lg">+</span> Compose
        </button>
      </div>

      <div className="px-5 pb-4">
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-dock-border/60 bg-dock-bg/50 px-3 py-2 text-sm text-white outline-none transition focus:border-dock-accent/60 focus:bg-dock-bg"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4 scrollbar-thin">
        <div className="space-y-1">
          {filteredStacks.map((stack) => {
            const isActive = stack.status === 'running';
            const navActive = location.pathname === `/stack/${stack.name}`;
            
            return (
              <NavLink
                key={stack.name}
                to={`/stack/${stack.name}`}
                className={`group flex items-center justify-between rounded-xl px-3 py-2.5 transition ${navActive ? 'bg-dock-panel shadow-sm' : 'hover:bg-dock-panel/50'}`}
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${isActive ? 'bg-dock-accent/20 text-dock-accent' : 'bg-dock-border/40 text-dock-muted'}`}>
                    {isActive ? 'active' : 'inactive'}
                  </span>
                  <span className={`truncate text-sm font-medium ${navActive || isActive ? 'text-white' : 'text-dock-muted group-hover:text-white'}`}>
                    {stack.name}
                  </span>
                </div>
              </NavLink>
            );
          })}
        </div>
      </div>

      <div className="p-4 border-t border-dock-border/50 space-y-2">
        <div className="rounded-xl border border-dock-border/60 bg-dock-bg/40 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs uppercase tracking-wide text-dock-muted">DockWatch</span>
            {versionBadge}
          </div>
          <div className="mt-2 text-sm font-medium text-white">
            {appVersion?.currentVersion || '...'}
          </div>
          {appVersion?.latestVersion && appVersion.updateAvailable ? (
            <div className="mt-1 space-y-1">
              <div className="text-xs text-dock-muted">Latest: v{appVersion.latestVersion}</div>
              <div className="text-[11px] text-amber-300/90">
                Click the update badge to view release notes.
              </div>
            </div>
          ) : null}
          <a
            href={appVersion?.releaseUrl || appVersion?.githubUrl || 'https://github.com/robotnikz/dockwatch'}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-xs font-medium text-dock-accent hover:underline"
          >
            Open on GitHub
          </a>
        </div>
        <NavLink 
          to="/" 
          className={({isActive}) => `block rounded-xl px-4 py-2 text-sm font-medium transition ${isActive ? 'text-dock-accent' : 'text-dock-muted hover:text-white'}`}
        >
          Overview
        </NavLink>
        <NavLink 
          to="/cleanup" 
          className={({isActive}) => `block rounded-xl px-4 py-2 text-sm font-medium transition ${isActive ? 'text-dock-accent' : 'text-dock-muted hover:text-white'}`}
        >
          Cleanup
        </NavLink>
        <NavLink 
          to="/settings" 
          className={({isActive}) => `block rounded-xl px-4 py-2 text-sm font-medium transition ${isActive ? 'text-dock-accent' : 'text-dock-muted hover:text-white'}`}
        >
          Settings
        </NavLink>
      </div>

      {showUpdateModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4">
          <div className="w-full max-w-md rounded-2xl border border-dock-border bg-dock-card p-5 shadow-dock">
            <h3 className="text-lg font-bold text-white">Update DockWatch</h3>
            <div className="mt-2 rounded-xl border border-dock-border/60 bg-dock-bg/30 p-3">
              <div className="text-xs uppercase tracking-wide text-dock-muted">Release Notes</div>
              <div className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap text-xs leading-5 text-dock-text">
                {appVersion?.releaseNotes || 'No release notes provided for this version.'}
              </div>
              <a
                href={appVersion?.releaseUrl || appVersion?.githubUrl || 'https://github.com/robotnikz/dockwatch'}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-xs font-semibold text-dock-accent hover:underline"
              >
                Open full release page
              </a>
            </div>

            <p className="mt-3 text-sm text-dock-muted">
              {selfUpdateSupported
                ? (
                  <>
                    This will run <code>docker compose down && docker compose pull && docker compose up -d</code> in
                    <code className="ml-1">{appVersion?.selfUpdate?.workingDir || 'configured directory'}</code>.
                  </>
                )
                : (appVersion?.selfUpdate?.reason || 'Self-update is not available in this environment.')}
            </p>

            {updateError ? (
              <div className="mt-3 rounded-xl border border-dock-red/30 bg-dock-red/10 px-3 py-2 text-sm text-dock-red">{updateError}</div>
            ) : null}

            {reloadCountdown != null ? (
              <div className="mt-4 rounded-xl border border-dock-border/60 bg-dock-bg/30 p-3 text-sm text-dock-text">
                Update started. Reloading in <span className="font-bold text-dock-accent">{reloadCountdown}s</span>.
              </div>
            ) : null}

            {!updating && reloadCountdown == null ? (
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowUpdateModal(false)}
                  className="rounded-xl border border-dock-border px-4 py-2 text-sm font-semibold text-dock-muted hover:text-white"
                >
                  Cancel
                </button>
                {selfUpdateSupported ? (
                  <button
                    type="button"
                    onClick={startSelfUpdate}
                    className="rounded-xl bg-dock-accent px-4 py-2 text-sm font-bold text-dock-bg hover:bg-dock-accent/90"
                  >
                    Update
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="rounded-xl border border-dock-border px-4 py-2 text-sm font-semibold text-white hover:border-dock-accent/40"
                >
                  Refresh Now
                </button>
                <button
                  type="button"
                  onClick={() => setShowUpdateModal(false)}
                  className="rounded-xl border border-dock-border px-4 py-2 text-sm font-semibold text-dock-muted hover:text-white"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
