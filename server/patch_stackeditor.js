const fs = require('fs');

let code = fs.readFileSync('/root/Github/dockwatch/web/src/pages/StackEditor.tsx', 'utf8');

if (!code.includes('import { streamStackAction')) {
  code = code.replace("import {\n  getStack,", "import {\n  getStack,\n  streamStackAction,");
}

if (!code.includes('streamModal')) {
  code = code.replace("const [actionLoading,", "const [streamModal, setStreamModal] = useState({ show: false, logs: '', title: '' });\n  const streamEndRef = useRef<HTMLDivElement>(null);\n  const [actionLoading,");
  
  code = code.replace("const handleAction = async (action: 'up' | 'down' | 'restart' | 'update' | 'delete') => {", `const handleAction = async (action: 'up' | 'down' | 'restart' | 'update' | 'delete') => {
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
      // Wait a moment then close or keep open? Users might want to close manually. We'll show a Close button.
    }`);
    
    // remove the old try catch inside handleAction
    code = code.replace(/try {\n[ \t]*if \(action === 'up'\)[^]+?} catch \(err: any\) \{\n[ \t]*setError\(err\.message\);\n[ \t]*\} finally \{\n[ \t]*setActionLoading\(null\);\n[ \t]*\}/, '');

    // Add stream modal content at the end of return
    code = code.replace("return (\n    <div", `return (
    <div className="relative">
      {streamModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#0c0d12] w-full max-w-4xl p-6 rounded-2xl border border-dock-border shadow-2xl flex flex-col h-[70vh]">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-white flex items-center gap-3">
                {actionLoading ? <div className="h-5 w-5 rounded-full border-2 border-dock-accent border-t-transparent animate-spin"/> : null}
                {streamModal.title}
              </h2>
              <button 
                onClick={() => setStreamModal({ show: false, logs: '', title: '' })}
                className="text-dock-muted hover:text-white transition"
              >
                ✕
              </button>
            </div>
            
            <div className="flex-1 bg-black rounded-xl p-4 overflow-y-auto font-mono text-sm text-gray-300">
              <pre className="whitespace-pre-wrap break-all">{streamModal.logs || 'Verbinde...'}</pre>
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
    <div`);
}

fs.writeFileSync('/root/Github/dockwatch/web/src/pages/StackEditor.tsx', code);
