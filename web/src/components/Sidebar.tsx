import { useState, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { getStacks, getAppVersionStatus, type AppVersionStatus, type Stack } from '../api';

export default function Sidebar() {
  const [stacks, setStacks] = useState<Stack[]>([]);
  const [appVersion, setAppVersion] = useState<AppVersionStatus | null>(null);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();
  const location = useLocation();

  const fetchStacks = () => getStacks().then(setStacks).catch(console.error);
  const fetchAppVersion = (force = false) =>
    getAppVersionStatus(force).then(setAppVersion).catch(console.error);

  useEffect(() => {
    fetchStacks();

    const onStacksChanged = () => {
      fetchStacks();
    };

    window.addEventListener('dockwatch:stacks-changed', onStacksChanged);
    const id = setInterval(fetchStacks, 10000); // 10s auto-refresh for sidebar
    return () => {
      clearInterval(id);
      window.removeEventListener('dockwatch:stacks-changed', onStacksChanged);
    };
  }, []);

  useEffect(() => {
    fetchAppVersion(true);
    const id = setInterval(() => fetchAppVersion(false), 60 * 60 * 1000); // hourly check
    return () => clearInterval(id);
  }, []);

  const filteredStacks = stacks.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()));

  const versionBadge = (() => {
    if (!appVersion) {
      return <span className="rounded-full bg-dock-border/40 px-2 py-0.5 text-[10px] font-semibold text-dock-muted">Checking...</span>;
    }
    if (appVersion.checkFailed) {
      return <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-semibold text-rose-300">Check Failed</span>;
    }
    if (appVersion.updateAvailable) {
      return (
        <a
          href={appVersion.releaseUrl || appVersion.githubUrl || 'https://github.com/robotnikz/dockwatch'}
          target="_blank"
          rel="noreferrer"
          className="cursor-pointer rounded-full border border-amber-400/40 bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-300 transition hover:bg-amber-500/30 hover:text-amber-200"
          title="Open release page"
        >
          Update Available
        </a>
      );
    }
    return <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">Up To Date</span>;
  })();

  return (
    <aside className="w-[280px] shrink-0 border-r border-dock-border/50 bg-dock-card/60 flex flex-col">
      <div className="p-5 flex items-center gap-3 cursor-pointer" onClick={() => navigate('/')}>
        <div className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border border-cyan-300/25 bg-slate-950">
          <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(30,41,59,0.7),rgba(15,23,42,0.98)_62%)]" />
          <span className="pointer-events-none absolute inset-[2px] rounded-[10px] border border-cyan-200/10" />
          <span className="relative text-lg leading-none">🐳</span>
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
      </div>

    </aside>
  );
}
