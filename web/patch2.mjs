import fs from 'fs';

let content = fs.readFileSync('src/pages/StackEditor.tsx', 'utf-8');

// 1. Add streamStackAction import
content = content.replace("stackUpdate, stackLogs, type Stack } from '../api';", "stackUpdate, stackLogs, streamStackAction, type Stack } from '../api';\nimport { AnsiUp } from 'ansi_up';\n\nconst ansiUp = new AnsiUp();");

// 2. Add state
content = content.replace("const [actionLoading, setActionLoading]", "const [streamModal, setStreamModal] = useState({ show: false, logs: '', title: '' });\n  const streamEndRef = useRef<HTMLDivElement>(null);\n  const [actionLoading, setActionLoading]");

// 3. Replace handleAction
const oldHandleAction = `  const handleAction = async (action: 'up' | 'down' | 'restart' | 'update' | 'delete') => {
    if (!name) return;
    if (action === 'delete' && !confirm(\`Delete stack "\${name}"? This will stop and remove all containers.\`)) return;
    
    setActionLoading(action);
    setError('');
    try {
      if (action === 'up') await stackUp(name);
      else if (action === 'down') await stackDown(name);
      else if (action === 'restart') await stackRestart(name);
      else if (action === 'update') await stackUpdate(name);
      else if (action === 'delete') {
        await deleteStack(name);
        navigate('/');
        return;
      }
      await fetchStackInfo();
      await fetchLogs();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  };`;

const newHandleAction = `  const handleAction = async (action: 'up' | 'down' | 'restart' | 'update' | 'delete') => {
    if (!name) return;
    if (action === 'delete') {
      if (!confirm(\`Delete stack "\${name}"? This will stop and remove all containers.\`)) return;
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
      setStreamModal(prev => ({ ...prev, logs: prev.logs + '\\n[Fehler: ' + err.message + ']' }));
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  };`;

content = content.replace(oldHandleAction, newHandleAction);

// 4. Inject Modal at top level of return structure
const oldReturn = `  return (
    <div className="mx-auto max-w-7xl animate-fade-in space-y-8">`;

const newReturn = `  return (
    <div className="mx-auto max-w-7xl animate-fade-in space-y-8">
      {streamModal.show && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#0c0d12] w-full max-w-4xl p-6 rounded-[1.25rem] border border-dock-border shadow-2xl flex flex-col h-[70vh]">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-medium text-white flex items-center gap-3">
                {actionLoading && <div className="h-4 w-4 rounded-full border-2 border-dock-accent border-t-transparent animate-spin"/>}
                {streamModal.title}
              </h2>
            </div>
            
            <div className="flex-1 bg-black rounded-xl p-4 overflow-y-auto font-mono text-sm text-gray-300 relative border border-dock-border/50">
              <pre className="whitespace-pre-wrap break-all" dangerouslySetInnerHTML={{ __html: ansiUp.ansi_to_html(streamModal.logs || 'Verbinde...') }}></pre>
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
      )}`;

content = content.replace(oldReturn, newReturn);

// Update Log render below as well to use AnsiUp for logs just to be nice
content = content.replace("{logs || 'Keine Logs verfügbar.'}", "<div dangerouslySetInnerHTML={{ __html: ansiUp.ansi_to_html(logs || 'Keine Logs verfügbar.') }} />");

fs.writeFileSync('src/pages/StackEditor.tsx', content);
console.log('Patched');
