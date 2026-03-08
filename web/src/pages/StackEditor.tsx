import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getStack, getStacks, saveStack, deleteStack, stackUp, stackDown, stackRestart, stackUpdate, stackLogs, streamStackAction, type Stack } from '../api';
import { AnsiUp } from 'ansi_up';
import { parseDocument } from 'yaml';
import ServiceConfigurator from '../components/ServiceConfigurator';
import ConfirmModal from '../components/ConfirmModal';

const ansiUp = new AnsiUp();

function normalizeTerminalText(input: string): string {
  return input
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f]/g, '');
}

function appendStreamChunk(lines: string[], currentLine: string, chunk: string): { lines: string[]; currentLine: string } {
  const normalized = chunk
    .replace(/\r\n/g, '\n')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f]/g, '');

  const nextLines = [...lines];
  let nextCurrent = currentLine;

  for (const char of normalized) {
    if (char === '\r') {
      // Docker progress lines often use CR to update one line in place.
      nextCurrent = '';
      continue;
    }
    if (char === '\n') {
      if (nextCurrent.length > 0) {
        nextLines.push(nextCurrent);
      }
      nextCurrent = '';
      continue;
    }
    nextCurrent += char;
  }

  return { lines: nextLines, currentLine: nextCurrent };
}

function stripAnsi(input: string): string {
  return input.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
}

function progressKeyForLine(line: string): string | null {
  const plain = stripAnsi(line)
    .replace(/^\s*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✔✘✖●•·]+\s*/u, '')
    .replace(/\s+\d+(?:\.\d+)?s\s*$/i, '')
    .trim();

  if (!plain) return null;

  const summary = plain.match(/^\[\+\]\s+(Running|Pulling)\s+\d+\/\d+/i);
  if (summary) {
    return `summary:${summary[1].toLowerCase()}`;
  }

  const objectLine = plain.match(/^(Container|Network|Volume|Image)\s+([^\s]+)/i);
  if (objectLine) {
    return `object:${objectLine[1].toLowerCase()}:${objectLine[2].toLowerCase()}`;
  }

  const serviceLine = plain.match(/^([^\s]+)\s+(Pulling|Waiting|Downloading|Extracting|Verifying|Complete|Pulled)\b/i);
  if (serviceLine) {
    return `service:${serviceLine[1].toLowerCase()}`;
  }

  return null;
}

function mergeProgressLines(lines: string[], progressLineIndexes: Map<string, number>): string[] {
  const merged: string[] = [];
  const nextIndexes = new Map<string, number>();

  for (const line of lines) {
    const key = progressKeyForLine(line);
    if (!key) {
      if (merged.length > 0 && merged[merged.length - 1] === line) {
        continue;
      }
      merged.push(line);
      continue;
    }

    const existingIndex = nextIndexes.get(key);
    if (existingIndex == null) {
      nextIndexes.set(key, merged.length);
      merged.push(line);
      continue;
    }

    merged[existingIndex] = line;
  }

  progressLineIndexes.clear();
  for (const [key, index] of nextIndexes.entries()) {
    progressLineIndexes.set(key, index);
  }

  return merged;
}

const TEMPLATE = `services:
  app:
    image: nginx:latest
    ports:
      - "8080:80"
    restart: unless-stopped
`;

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function highlightYaml(input: string): string {
  return input
    .split('\n')
    .map((line) => {
      let html = escapeHtml(line);
      html = html.replace(/(#.*)$/g, '<span class="yaml-comment">$1</span>');
      html = html.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, '<span class="yaml-string">$1</span>');
      html = html.replace(/^(\s*-\s*)?([A-Za-z0-9_.-]+)(\s*:)/, '$1<span class="yaml-key">$2</span>$3');
      html = html.replace(/\b(true|false|yes|no|on|off|null)\b/gi, '<span class="yaml-bool">$1</span>');
      html = html.replace(/\b\d+(?:\.\d+)?\b/g, '<span class="yaml-number">$&</span>');
      return html;
    })
    .join('\n');
}

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
  const [actionStream, setActionStream] = useState<{
    visible: boolean;
    title: string;
    content: string;
    tone: 'running' | 'success' | 'error';
  }>({ visible: false, title: '', content: '', tone: 'running' });
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [logs, setLogs] = useState<string>('');
  const [error, setError] = useState('');
  const logsEndRef = useRef<HTMLDivElement>(null);
  const actionStreamContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollActionRef = useRef(true);
  const hideActionStreamTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionLinesRef = useRef<string[]>([]);
  const actionCurrentLineRef = useRef('');
  const actionProgressIndexesRef = useRef<Map<string, number>>(new Map());
  const composeTextareaRef = useRef<HTMLTextAreaElement>(null);
  const composeHighlightRef = useRef<HTMLPreElement>(null);

  const yamlHighlightHtml = useMemo(() => highlightYaml(content), [content]);
  const yamlValidation = useMemo(() => {
    try {
      const doc = parseDocument(content);
      if (doc.errors.length > 0) {
        return { valid: false, message: doc.errors[0].message };
      }
      return { valid: true, message: 'YAML syntax looks good.' };
    } catch (err: any) {
      return {
        valid: false,
        message: err?.message || 'YAML parse error',
      };
    }
  }, [content]);

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
      setLoading(true);
      setIsEditing(false);
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
      setLoading(false);
      setStackData(null);
      setStackName('');
      setLogs('');
      setError('');
      setEnvContent('');
      setActiveTab('compose.yaml');
      const prefill = sessionStorage.getItem('dockwatch_prefill');
      if (prefill) {
        setContent(prefill);
        sessionStorage.removeItem('dockwatch_prefill');
      } else {
        setContent(TEMPLATE);
      }
      setIsEditing(true);
    }
  }, [name]);

  useEffect(() => {
    if (logsEndRef.current) {
        logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  useEffect(() => {
    if (!actionStream.visible || !actionStreamContainerRef.current || !shouldAutoScrollActionRef.current) {
      return;
    }
    const container = actionStreamContainerRef.current;
    container.scrollTop = container.scrollHeight;
  }, [actionStream.content, actionStream.visible]);

  useEffect(() => {
    return () => {
      if (hideActionStreamTimer.current) {
        clearTimeout(hideActionStreamTimer.current);
      }
    };
  }, []);

  const handleAction = async (action: 'up' | 'down' | 'restart' | 'update' | 'delete') => {
    if (!name) return;
    if (action === 'delete') {
      setShowDeleteConfirm(true);
      return;
    }
    
    setActionLoading(action);
    setError('');
    
    const titleMap: Record<string, string> = {
      up: 'Starting stack...',
      down: 'Stopping stack...',
      restart: 'Restarting stack...',
      update: 'Updating stack...'
    };

    if (hideActionStreamTimer.current) {
      clearTimeout(hideActionStreamTimer.current);
      hideActionStreamTimer.current = null;
    }

    setActionStream({
      visible: true,
      title: titleMap[action],
      content: 'Connecting...\n',
      tone: 'running',
    });
    actionLinesRef.current = ['Connecting...'];
    actionCurrentLineRef.current = '';
    actionProgressIndexesRef.current = new Map();
    shouldAutoScrollActionRef.current = true;
    
    try {
      await streamStackAction(name, action, (chunk) => {
        const parsed = appendStreamChunk(actionLinesRef.current, actionCurrentLineRef.current, chunk);
        actionLinesRef.current = mergeProgressLines(parsed.lines, actionProgressIndexesRef.current);
        actionCurrentLineRef.current = parsed.currentLine;
        const content = [...actionLinesRef.current, parsed.currentLine].filter(Boolean).join('\n') + '\n';
        setActionStream((prev) => ({
          ...prev,
          visible: true,
          content,
        }));
      });
      await fetchStackInfo();
      await fetchLogs();
      window.dispatchEvent(new CustomEvent('dockwatch:stacks-changed'));
      setActionStream((prev) => ({
        ...prev,
        tone: 'success',
        title: `${titleMap[action].replace('...', '')} completed`,
      }));
    } catch (err: any) {
      setActionStream((prev) => ({
        ...prev,
        visible: true,
        tone: 'error',
        title: `${titleMap[action].replace('...', '')} failed`,
        content: `${prev.content}\n[Error: ${err.message}]\n`,
      }));
      setError(err.message);
    } finally {
      hideActionStreamTimer.current = setTimeout(() => {
        setActionStream((prev) => ({ ...prev, visible: false }));
      }, 10_000);
      setActionLoading(null);
    }
  };

  const confirmDelete = async () => {
    if (!name) return;
    setShowDeleteConfirm(false);
    setActionLoading('delete');
    try {
      await deleteStack(name);
      window.dispatchEvent(new CustomEvent('dockwatch:stacks-changed'));
      navigate('/');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleSave = async () => {
    const nextName = stackName.trim();
    if (!nextName) {
      setError('Stack name is required');
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(nextName)) {
      setError('Stack name can only contain letters, numbers, dashes and underscores');
      return;
    }
    setActionLoading('save');
    setError('');
    try {
      await saveStack(nextName, content, envContent);
      window.dispatchEvent(new CustomEvent('dockwatch:stacks-changed'));
      if (isNew) {
        navigate(`/stack/${nextName}`);
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

  const syncComposeScroll = () => {
    if (!composeTextareaRef.current || !composeHighlightRef.current) {
      return;
    }
    composeHighlightRef.current.scrollTop = composeTextareaRef.current.scrollTop;
    composeHighlightRef.current.scrollLeft = composeTextareaRef.current.scrollLeft;
  };

  if (loading && !isNew) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-dock-border border-t-dock-accent" />
      </div>
    );
  }

  const isActive = stackData?.status === 'running' || stackData?.status === 'partial';
  const canRestart = isActive;
  const primaryPowerAction: 'up' | 'down' = isActive ? 'down' : 'up';
  const primaryPowerLabel = isActive ? 'Stop' : 'Start';

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto">
      {/* Header area */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          {!isNew && (
            <span className={`px-3 py-1 rounded-full text-xs font-bold ${isActive ? 'bg-dock-accent text-dock-bg' : 'bg-dock-border text-white'}`}>
              {isActive ? 'active' : 'inactive'}
            </span>
          )}
          {isNew ? (
            <input
              type="text"
              value={stackName}
              onChange={(e) => setStackName(e.target.value)}
              placeholder="New stack name"
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
                {actionLoading === 'save' ? (isNew ? 'Creating...' : 'Saving...') : (isNew ? 'Create Stack' : 'Save')}
              </button>
              {!isNew && (
                <button onClick={() => setIsEditing(false)} disabled={!!actionLoading} className="rounded-xl bg-dock-panel px-4 py-2 text-sm font-bold text-white transition hover:bg-dock-border disabled:opacity-50">
                  Cancel
                </button>
              )}
            </>
          ) : (
            <>
              <button onClick={() => setIsEditing(true)} className="flex items-center gap-2 rounded-xl bg-dock-panel px-4 py-2 text-sm font-bold text-white transition hover:bg-dock-border">
                <span>✏️</span> Edit
              </button>
              <button
                disabled={!!actionLoading || !canRestart}
                onClick={() => handleAction('restart')}
                className="flex items-center gap-2 rounded-xl bg-dock-panel px-4 py-2 text-sm font-bold text-white transition hover:bg-dock-border disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span>🔄</span> Restart
              </button>
              <button disabled={!!actionLoading} onClick={() => handleAction('update')} className="flex items-center gap-2 rounded-xl bg-dock-panel px-4 py-2 text-sm font-bold text-white transition hover:bg-dock-border disabled:opacity-50">
                <span>☁️</span> Update
              </button>
              <button
                disabled={!!actionLoading}
                onClick={() => handleAction(primaryPowerAction)}
                className={[
                  'flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition disabled:opacity-50',
                  isActive
                    ? 'bg-dock-red/20 text-dock-red hover:bg-dock-red/30'
                    : 'bg-dock-green/20 text-dock-green hover:bg-dock-green/30',
                ].join(' ')}
              >
                <span>{isActive ? '⏹' : '▶'}</span> {primaryPowerLabel}
              </button>
              <div className="flex-1" />
              <button disabled={!!actionLoading} onClick={() => handleAction('delete')} className="flex items-center gap-2 rounded-xl bg-dock-red text-dock-bg px-4 py-2 text-sm font-bold transition hover:bg-red-400 disabled:opacity-50">
                <span>🗑️</span> Delete
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

      {actionStream.visible ? (
        <div className="rounded-[1.25rem] border border-dock-border/60 bg-[#0c0d12] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className={[
              'text-sm font-semibold',
              actionStream.tone === 'error'
                ? 'text-dock-red'
                : actionStream.tone === 'success'
                  ? 'text-dock-green'
                  : 'text-dock-accent',
            ].join(' ')}>
              {actionStream.title}
            </h2>
            <button
              type="button"
              onClick={() => setActionStream((prev) => ({ ...prev, visible: false }))}
              className="rounded-lg border border-dock-border px-2 py-1 text-xs text-dock-muted hover:text-white"
            >
              Hide
            </button>
          </div>
          <div
            ref={actionStreamContainerRef}
            onScroll={() => {
              const el = actionStreamContainerRef.current;
              if (!el) return;
              const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
              shouldAutoScrollActionRef.current = nearBottom;
            }}
            className="max-h-[280px] overflow-y-auto rounded-xl border border-dock-border/50 bg-black p-3"
          >
            <div
              className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-gray-300"
              dangerouslySetInnerHTML={{ __html: ansiUp.ansi_to_html(actionStream.content) }}
            />
          </div>
        </div>
      ) : null}

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
                              {svc.State === 'running' ? 'running' : svc.State}
                            </span>
                          </div>
                        </div>
                        <span className="text-xs text-dock-muted">{svc.Status}</span>
                      </div>
                    </div>
                  )) : (
                    <div className="rounded-[1.25rem] bg-dock-card p-6 text-center border border-dock-border/50">
                      <p className="text-dock-muted font-medium">{isActive ? 'No containers found.' : 'No running container.'}</p>
                    </div>
          )}
                </div>
              </div>

              <div className="flex-1 flex flex-col min-h-[300px]">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-xl font-medium text-white tracking-tight">Terminal</h2>
                    <button onClick={fetchLogs} className="text-xs text-dock-accent hover:underline">Refresh</button>
                </div>
                <div className="flex-1 rounded-[1.25rem] bg-[#0c0d12] p-4 border border-dock-border/50 overflow-hidden relative">
                  <div className="absolute inset-x-4 inset-y-4 overflow-y-auto scrollbar-thin text-xs font-mono text-gray-300 leading-relaxed break-words whitespace-pre-wrap">
                    <div dangerouslySetInnerHTML={{ __html: ansiUp.ansi_to_html(logs || 'No logs available.') }} />
                    <div ref={logsEndRef} />
                  </div>
                </div>
              </div>
            </>
          )}

          {isNew && (
            <div>
              <h2 className="text-xl font-medium text-white mb-3 tracking-tight">Tips</h2>
              <div className="rounded-[1.25rem] bg-dock-card p-5 border border-dock-border/50">
                <ul className="space-y-3 text-sm leading-6 text-dock-muted">
                    <li>Enter a stack name and provide a Docker Compose YAML file.</li>
                    <li>The project is saved and executed under <code>/opt/stacks/&lt;name&gt;</code>.</li>
                    <li>Review port bindings and volume paths before starting the stack.</li>
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
              {isEditing ? (
                <span
                  className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${yamlValidation.valid ? 'bg-dock-green/20 text-dock-green' : 'bg-dock-red/20 text-dock-red'}`}
                  title={yamlValidation.message}
                >
                  {yamlValidation.valid ? 'valid' : 'invalid'}
                </span>
              ) : null}
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
                <div className="relative w-full flex-1 overflow-hidden">
                  <pre
                    ref={composeHighlightRef}
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 overflow-auto p-4 text-sm font-mono leading-6 text-gray-200"
                    dangerouslySetInnerHTML={{ __html: `${yamlHighlightHtml}\n` }}
                  />
                  <textarea
                    ref={composeTextareaRef}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    onScroll={syncComposeScroll}
                    wrap="off"
                    spellCheck={false}
                    className="absolute inset-0 w-full flex-1 resize-none overflow-auto bg-transparent p-4 text-sm font-mono leading-6 text-transparent caret-white outline-none selection:bg-dock-accent/30"
                  />
                </div>
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

      <ConfirmModal
        isOpen={showDeleteConfirm}
        title="Delete stack"
        message={`Delete stack "${name}"? This will stop and remove all containers.`}
        confirmLabel="Delete"
        confirmTone="danger"
        busy={actionLoading === 'delete'}
        onCancel={() => setShowDeleteConfirm(false)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
