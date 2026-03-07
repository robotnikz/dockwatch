import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getStack, getStacks, saveStack, deleteStack, stackUp, stackDown, stackRestart, stackUpdate, stackLogs, streamStackAction, type Stack } from '../api';
import { AnsiUp } from 'ansi_up';
import ServiceConfigurator from '../components/ServiceConfigurator';

const ansiUp = new AnsiUp();

function normalizeTerminalText(input: string): string {
  return input
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f]/g, '');
}

const TEMPLATE = `services:
  app:
    image: nginx:latest
    ports:
      - "8080:80"
    restart: unless-stopped
`;

export default function StackEditor() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const isNew = !name;

  const [stackName, setStackName] = useState('');
  const [content, setContent] = useState(TEMPLATE);
  const [envContent, setEnvContent] = useState('');
  const [activeTab, setActiveTab] = useState<'compose.yaml' | '.env'>('compose.yaml');
  const [stackData, setStackData] = useState<Stack | null>(null);
  
  const [isEditing, setIsEditing] = useState(isNew);
  const [loading, setLoading] = useState(!isNew);
  const [streamModal, setStreamModal] = useState({ show: false, logs: '', title: '' });
  const streamEndRef = useRef<HTMLDivElement>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [logs, setLogs] = useState<string>('');
  const [error, setError] = useState('');
  const logsEndRef = useRef<HTMLDivElement>(null);

  const fetchStackInfo = async () => {
    if (!name) return;
    try {
      const [detail, allStacks] = await Promise.all([
        getStack(name),
        getStacks()
      ]);
      setContent(detail.content);
      setEnvContent(detail.envContent || '');
      const found = allStacks.find(s => s.name === name);
      if (found) setStackData(found);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchLogs = async () => {
    if (!name || isNew) return;
    try {
      const res = await stackLogs(name, 100);
      setLogs(normalizeTerminalText(res.output));
    } catch (err) {
      // ignore log fetch errors quietly
    }
  };

  useEffect(() => {
    if (name) {
      setStackName(name);
      fetchStackInfo();
      fetchLogs();
      const interval = setInterval(() => {
        if (!isEditing) {
            getStacks().then(stacks => {
                const found = stacks.find(s => s.name === name);
                if (found) setStackData(found);
            }).catch(() => {});
        }
      }, 10000);
      return () => clearInterval(interval);
    } else {
      const prefill = sessionStorage.getItem('dockwatch_prefill');
      if (prefill) {
        setContent(prefill);
        sessionStorage.removeItem('dockwatch_prefill');
      }
      setIsEditing(true);
    }
  }, [name]);

  useEffect(() => {
    if (logsEndRef.current) {
        logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const handleAction = async (action: 'up' | 'down' | 'restart' | 'update' | 'delete') => {
    if (!name) return;
    if (action === 'delete') {
      if (!confirm(`Delete stack "${name}"? This will stop and remove all containers.`)) return;
      setActionLoading(action);
      try {
        await deleteStack(name);
        navigate('/');
      } catch (err: any) {
        setError(err.message);
      } finally {
        setActionLoading(null);
      }
      return;
    }
    
    setActionLoading(action);
    setError('');
    
    const titleMap: Record<string, string> = {
      up: 'Starte Stack...',
      down: 'Stoppe Stack...',
      restart: 'Starte Stack neu...',
      update: 'Aktualisiere Stack...'
    };
    
    setStreamModal({ show: true, logs: '', title: titleMap[action] });
    
    try {
      await streamStackAction(name, action, (chunk) => {
        setStreamModal(prev => ({ ...prev, logs: prev.logs + chunk }));
        if (streamEndRef.current) {
          streamEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
      });
      await fetchStackInfo();
      await fetchLogs();
    } catch (err: any) {
      setStreamModal(prev => ({ ...prev, logs: prev.logs + '\n[Fehler: ' + err.message + ']' }));
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleSave = async () => {
    if (!stackName.trim()) {
      setError('Stack name is required');
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(stackName)) {
      setError('Stack name can only contain letters, numbers, dashes and underscores');
      return;
    }
    setActionLoading('save');
    setError('');
    try {
      await saveStack(stackName, content, envContent);
      if (isNew) {
        navigate(`/stack/${stackName}`);
      } else {
        setIsEditing(false);
        await fetchStackInfo();
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  if (loading && !isNew) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-dock-border border-t-dock-accent" />
      </div>
    );
  }

  const isActive = stackData?.status === 'running' || stackData?.status === 'partial';

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto">
      {streamModal.show && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#0c0d12] w-full max-w-4xl p-6 rounded-[1.25rem] border border-dock-border shadow-2xl flex flex-col h-[80vh]">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-medium text-white flex items-center gap-3">
                {actionLoading && <div className="h-4 w-4 rounded-full border-2 border-dock-accent border-t-transparent animate-spin"/>}
                {streamModal.title}
              </h2>
            </div>
            
            <div className="flex-1 bg-black rounded-xl p-4 overflow-y-auto font-mono text-sm text-gray-300 relative border border-dock-border/50">
              <div className="whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: ansiUp.ansi_to_html(streamModal.logs || 'Verbinde...') }}></div>
              <div ref={streamEndRef} />
            </div>
            
            {!actionLoading && (
              <div className="mt-4 flex justify-end">
                <button
                  onClick={() => setStreamModal({ show: false, logs: '', title: '' })}
                  className="bg-dock-panel hover:bg-dock-border text-white px-6 py-2 rounded-xl transition font-medium"
                >
                  Schließen
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Header area */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          {!isNew && (
            <span className={`px-3 py-1 rounded-full text-xs font-bold ${isActive ? 'bg-dock-accent text-dock-bg' : 'bg-dock-border text-white'}`}>
              {isActive ? 'aktiv' : 'inaktiv'}
            </span>
          )}
          {isNew ? (
            <input
              type="text"
              value={stackName}
              onChange={(e) => setStackName(e.target.value)}
              placeholder="Neuer Stackname"
              className="bg-transparent text-3xl font-bold tracking-tight text-white outline-none border-b border-dock-border focus:border-dock-accent transition placeholder-dock-muted"
            />
          ) : (
            <h1 className="text-3xl font-bold tracking-tight text-white">{name}</h1>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {isEditing ? (
            <>
              <button onClick={handleSave} disabled={!!actionLoading} className="rounded-xl bg-dock-text px-4 py-2 text-sm font-bold text-dock-bg transition hover:bg-white disabled:opacity-50">
                {actionLoading === 'save' ? 'Speichern...' : 'Speichern'}
              </button>
              {!isNew && (
                <button onClick={() => setIsEditing(false)} disabled={!!actionLoading} className="rounded-xl bg-dock-panel px-4 py-2 text-sm font-bold text-white transition hover:bg-dock-border disabled:opacity-50">
                  Abbrechen
                </button>
              )}
            </>
          ) : (
            <>
              <button onClick={() => setIsEditing(true)} className="flex items-center gap-2 rounded-xl bg-dock-panel px-4 py-2 text-sm font-bold text-white transition hover:bg-dock-border">
                <span>✏️</span> Bearbeiten
              </button>
              <button disabled={!!actionLoading} onClick={() => handleAction('restart')} className="flex items-center gap-2 rounded-xl bg-dock-panel px-4 py-2 text-sm font-bold text-white transition hover:bg-dock-border disabled:opacity-50">
                <span>🔄</span> Neustarten
              </button>
              <button disabled={!!actionLoading} onClick={() => handleAction('update')} className="flex items-center gap-2 rounded-xl bg-dock-panel px-4 py-2 text-sm font-bold text-white transition hover:bg-dock-border disabled:opacity-50">
                <span>☁️</span> Aktualisieren
              </button>
              <button disabled={!!actionLoading} onClick={() => handleAction('down')} className="flex items-center gap-2 rounded-xl bg-dock-panel px-4 py-2 text-sm font-bold text-white transition hover:bg-dock-border disabled:opacity-50">
                <span>⏹</span> Anhalten
              </button>
              <div className="flex-1" />
              <button disabled={!!actionLoading} onClick={() => handleAction('delete')} className="flex items-center gap-2 rounded-xl bg-dock-red text-dock-bg px-4 py-2 text-sm font-bold transition hover:bg-red-400 disabled:opacity-50">
                <span>🗑️</span> Löschen
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-dock-red/40 bg-dock-red/10 px-4 py-3 text-sm text-dock-red">
          {error}
        </div>
      )}

      {/* Main Content Area */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left Side: Services & Terminal */}
        <div className="space-y-6 flex flex-col">
          {isEditing ? <ServiceConfigurator content={content} setContent={setContent} /> : !isNew && (
            <>
              <div>
                <h2 className="text-xl font-medium text-white mb-3 tracking-tight">Container</h2>
                <div className="space-y-3">
                  {stackData?.services.length ? stackData.services.map((svc) => (
                    <div key={svc.Name} className="rounded-[1.25rem] bg-dock-card p-4 border border-dock-border/50">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="text-lg font-medium text-white">{svc.Service}</h3>
                          <div className="flex flex-wrap gap-2 mt-2">
                            <span className={`rounded-xl px-3 py-1 text-xs font-semibold ${svc.State === 'running' ? 'bg-dock-accent/20 text-dock-accent' : 'bg-dock-border/50 text-dock-muted'}`}>
                              {svc.State === 'running' ? 'healthy' : svc.State}
                            </span>
                          </div>
                        </div>
                        <span className="text-xs text-dock-muted">{svc.Status}</span>
                      </div>
                    </div>
                  )) : (
                    <div className="rounded-[1.25rem] bg-dock-card p-6 text-center border border-dock-border/50">
                      <p className="text-dock-muted font-medium">Keine Container gefunden.</p>
                      <button onClick={() => handleAction('up')} className="mt-3 rounded-lg bg-dock-accent/10 px-4 py-2 text-sm font-semibold text-dock-accent transition hover:bg-dock-accent hover:text-dock-bg">
                        Stack starten
                      </button>
                    </div>
          )}
                </div>
              </div>

              <div className="flex-1 flex flex-col min-h-[300px]">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-xl font-medium text-white tracking-tight">Terminal</h2>
                    <button onClick={fetchLogs} className="text-xs text-dock-accent hover:underline">Aktualisieren</button>
                </div>
                <div className="flex-1 rounded-[1.25rem] bg-[#0c0d12] p-4 border border-dock-border/50 overflow-hidden relative">
                  <div className="absolute inset-x-4 inset-y-4 overflow-y-auto scrollbar-thin text-xs font-mono text-gray-300 leading-relaxed break-words whitespace-pre-wrap">
                    <div dangerouslySetInnerHTML={{ __html: ansiUp.ansi_to_html(logs || 'Keine Logs verfügbar.') }} />
                    <div ref={logsEndRef} />
                  </div>
                </div>
              </div>
            </>
          )}

          {isNew && (
            <div>
              <h2 className="text-xl font-medium text-white mb-3 tracking-tight">Hinweise</h2>
              <div className="rounded-[1.25rem] bg-dock-card p-5 border border-dock-border/50">
                <ul className="space-y-3 text-sm leading-6 text-dock-muted">
                    <li>Geben Sie einen Stack-Namen ein und fügen Sie eine Docker Compose YAML-Datei ein.</li>
                    <li>Das Projekt wird unter <code>/opt/stacks/&lt;name&gt;</code> gespeichert und ausgeführt.</li>
                    <li>Port-Bindungen und Volume-Pfade prüfen, bevor der Stack gestartet wird.</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Right Side: Editor Tabs */}
        <div className="flex flex-col h-full">
          <div className="flex items-end gap-2 mb-3">
            <button
              onClick={() => setActiveTab('compose.yaml')}
              className={`px-4 py-2 rounded-t-xl text-sm font-medium transition ${activeTab === 'compose.yaml' ? 'bg-[#161720] text-white border-t border-l border-r border-dock-border/50' : 'text-dock-muted hover:text-white'}`}
            >
              compose.yaml
            </button>
            <button
              onClick={() => setActiveTab('.env')}
              className={`px-4 py-2 rounded-t-xl text-sm font-medium transition ${activeTab === '.env' ? 'bg-[#161720] text-white border-t border-l border-r border-dock-border/50' : 'text-dock-muted hover:text-white'}`}
            >
              .env
              {envContent.trim() && activeTab !== '.env' && <span className="ml-2 inline-block w-2 h-2 rounded-full bg-dock-green"></span>}
            </button>
          </div>
          
          <div className="flex-1 rounded-b-[1.25rem] rounded-tr-[1.25rem] border border-dock-border/50 bg-[#161720] shadow-inner overflow-hidden flex flex-col min-h-[500px] relative -mt-[1px]">
            {activeTab === 'compose.yaml' && (
              isEditing ? (
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  spellCheck={false}
                  className="w-full flex-1 resize-none bg-transparent p-4 text-sm font-mono text-gray-200 outline-none"
                />
              ) : (
                <div className="w-full flex-1 overflow-auto p-4 scrollbar-thin">
                  <pre className="text-sm font-mono text-gray-300">{content}</pre>
                </div>
              )
            )}
            {activeTab === '.env' && (
              isEditing ? (
                <textarea
                  value={envContent}
                  onChange={(e) => setEnvContent(e.target.value)}
                  spellCheck={false}
                  placeholder="KEY=value\nPORT=8080"
                  className="w-full flex-1 resize-none bg-transparent p-4 text-sm font-mono text-gray-200 outline-none"
                />
              ) : (
                <div className="w-full flex-1 overflow-auto p-4 scrollbar-thin">
                  <pre className="text-sm font-mono text-gray-300">
                    {envContent || <span className="text-dock-muted italic">No .env file provided. Click Edit to add one.</span>}
                  </pre>
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
