import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { getStack, getStacks, saveStack, deleteStack, stackLogs, getUpdates, getStackHistory, getStackHistoryVersion, streamStackAction, streamStackServiceUpdate, type Stack, type StackService, type StackVersion, type UpdateStatus } from '../api';
import { AnsiUp } from 'ansi_up';
import { parseDocument } from 'yaml';
import ServiceConfigurator from '../components/ServiceConfigurator';
import ConfirmModal from '../components/ConfirmModal';
import AppModal from '../components/AppModal';

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

  const serviceName = plain.match(/^([^\s]+)/)?.[1];
  const serviceProgressState = plain.match(/\b(Pulling|Waiting|Downloading|Extracting|Verifying|Complete|Pulled)\b/i)?.[1];
  if (serviceName && serviceProgressState) {
    return `service:${serviceName.toLowerCase()}`;
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

/** Update-cache contexts look like "stack/service, other/service". */
function contextIncludes(context: string | undefined, stackName: string, serviceName: string): boolean {
  return (context || '').split(',').map((entry) => entry.trim()).includes(`${stackName}/${serviceName}`);
}

function serviceStateLabel(svc: StackService): string {
  if (svc.State === 'exited' && svc.ExitCode != null) return `exited (${svc.ExitCode})`;
  return svc.State;
}

function serviceStateClasses(svc: StackService): string {
  if (svc.State === 'running') return 'bg-dock-accent/20 text-dock-accent';
  if (svc.State === 'exited' && svc.ExitCode === 0) return 'bg-dock-border/50 text-dock-muted';
  return 'bg-dock-red/15 text-dock-red';
}

const healthClasses: Record<string, string> = {
  healthy: 'bg-dock-green/15 text-dock-green',
  unhealthy: 'bg-dock-red/15 text-dock-red',
  starting: 'bg-dock-yellow/15 text-dock-yellow',
};

export default function StackEditor() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const isNew = !name;

  const [stackName, setStackName] = useState('');
  const [content, setContent] = useState(TEMPLATE);
  const [envContent, setEnvContent] = useState('');
  const [composeFileName, setComposeFileName] = useState('compose.yaml');
  const [extraFiles, setExtraFiles] = useState<string[]>([]);
  const [stackPath, setStackPath] = useState('');
  // Editing an existing stack is only allowed after its files were loaded, so a failed
  // load can never lead to saving the template (or an empty .env) over the real files.
  const [filesLoaded, setFilesLoaded] = useState(false);
  const [saveWarnings, setSaveWarnings] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyVersions, setHistoryVersions] = useState<StackVersion[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'compose.yaml' | '.env'>('compose.yaml');
  const [stackData, setStackData] = useState<Stack | null>(null);
  const [updates, setUpdates] = useState<UpdateStatus[]>([]);
  
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
      const [detail, allStacks, allUpdates] = await Promise.all([
        getStack(name),
        getStacks(),
        getUpdates()
      ]);
      setContent(detail.content);
      setEnvContent(detail.env ?? '');
      setComposeFileName(detail.composeFile || 'compose.yaml');
      setExtraFiles(detail.extraFiles ?? []);
      setStackPath(detail.path || '');
      setFilesLoaded(true);
      const found = allStacks.find(s => s.name === name);
      if (found) setStackData(found);
      setUpdates(allUpdates);
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
    setNotice('');
    setHistoryOpen(false);
    const navigationWarnings = (location.state as { warnings?: string[] } | null)?.warnings;
    setSaveWarnings(Array.isArray(navigationWarnings) ? navigationWarnings : []);
    setFilesLoaded(false);
    if (name) {
      setLoading(true);
      setIsEditing(false);
      setStackName(name);
      fetchStackInfo();
      fetchLogs();
      const interval = setInterval(() => {
        if (!isEditing) {
            Promise.all([getStacks(), getUpdates()]).then(([stacks, allUpdates]) => {
                const found = stacks.find(s => s.name === name);
                if (found) setStackData(found);
                setUpdates(allUpdates);
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
      setComposeFileName('compose.yaml');
      setExtraFiles([]);
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

  const handleServiceUpdate = async (serviceName: string) => {
    if (!name) return;

    const actionKey = `update-service:${serviceName}`;
    setActionLoading(actionKey);
    setError('');

    if (hideActionStreamTimer.current) {
      clearTimeout(hideActionStreamTimer.current);
      hideActionStreamTimer.current = null;
    }

    setActionStream({
      visible: true,
      title: `Updating service ${serviceName}...`,
      content: 'Connecting...\n',
      tone: 'running',
    });
    actionLinesRef.current = ['Connecting...'];
    actionCurrentLineRef.current = '';
    actionProgressIndexesRef.current = new Map();
    shouldAutoScrollActionRef.current = true;

    try {
      await streamStackServiceUpdate(name, serviceName, (chunk) => {
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
        title: `Service ${serviceName} update completed`,
      }));
    } catch (err: any) {
      setActionStream((prev) => ({
        ...prev,
        visible: true,
        tone: 'error',
        title: `Service ${serviceName} update failed`,
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
    if (!isNew && !filesLoaded) {
      setError('The stack files could not be loaded, so saving is disabled. Reload the page and try again.');
      return;
    }
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
    setNotice('');
    setSaveWarnings([]);
    try {
      const result = await saveStack(nextName, content, envContent, { create: isNew });
      const warnings = result.warnings ?? [];
      window.dispatchEvent(new CustomEvent('dockwatch:stacks-changed'));
      if (isNew) {
        navigate(`/stack/${nextName}`, { state: { warnings } });
      } else {
        setSaveWarnings(warnings);
        setIsEditing(false);
        await fetchStackInfo();
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const openHistory = async () => {
    if (!name) return;
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const res = await getStackHistory(name);
      setHistoryVersions(res.versions);
    } catch (err: any) {
      setError(err.message);
      setHistoryOpen(false);
    } finally {
      setHistoryLoading(false);
    }
  };

  const loadHistoryVersion = async (version: StackVersion) => {
    if (!name) return;
    setHistoryLoading(true);
    try {
      const snapshot = await getStackHistoryVersion(name, version.id);
      setContent(snapshot.content);
      setEnvContent(snapshot.env ?? '');
      setIsEditing(true);
      setHistoryOpen(false);
      setNotice(`Loaded the version from ${new Date(version.savedAt).toLocaleString()}. Review it and click Save to restore it.`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setHistoryLoading(false);
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
                <button
                  onClick={() => {
                    setIsEditing(false);
                    setNotice('');
                    fetchStackInfo();
                  }}
                  disabled={!!actionLoading}
                  className="rounded-xl bg-dock-panel px-4 py-2 text-sm font-bold text-white transition hover:bg-dock-border disabled:opacity-50"
                >
                  Cancel
                </button>
              )}
              {!isNew && (
                <button onClick={openHistory} disabled={!!actionLoading} className="rounded-xl bg-dock-panel px-4 py-2 text-sm font-bold text-white transition hover:bg-dock-border disabled:opacity-50">
                  History
                </button>
              )}
            </>
          ) : (
            <>
              <button onClick={() => setIsEditing(true)} disabled={!filesLoaded} title={filesLoaded ? undefined : 'Stack files could not be loaded'} className="flex items-center gap-2 rounded-xl bg-dock-panel px-4 py-2 text-sm font-bold text-white transition hover:bg-dock-border disabled:cursor-not-allowed disabled:opacity-50">
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
                <span>☁️</span> Update All
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

      {notice && (
        <div className="rounded-xl border border-dock-accent/40 bg-dock-accent/10 px-4 py-3 text-sm text-dock-accent">
          {notice}
        </div>
      )}

      {saveWarnings.length > 0 && (
        <div className="rounded-xl border border-dock-yellow/40 bg-dock-yellow/10 px-4 py-3 text-sm text-dock-yellow">
          <div className="flex items-start justify-between gap-3">
            <div className="font-semibold">Saved. docker compose reported:</div>
            <button type="button" onClick={() => setSaveWarnings([])} className="text-xs opacity-80 hover:opacity-100">Dismiss</button>
          </div>
          <ul className="mt-2 space-y-1 font-mono text-xs">
            {saveWarnings.map((warning, index) => <li key={index} className="break-words">{warning}</li>)}
          </ul>
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
                  {stackData?.services.length ? stackData.services.map((svc) => {
                    const serviceUpdates = updates.filter(u => contextIncludes(u.context, name as string, svc.Service));
                    const hasUpdate = serviceUpdates.some(u => u.updateAvailable);
                    const checkFailed = !hasUpdate && serviceUpdates.some(u => u.checkFailed);
                    return (
                      <div key={svc.Name} className={`rounded-[1.25rem] bg-dock-card p-4 border transition ${hasUpdate ? 'border-dock-yellow/50 shadow-[0_0_15px_rgba(234,179,8,0.1)]' : 'border-dock-border/50'}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="text-lg font-medium text-white">{svc.Service}</h3>
                              {hasUpdate && (
                                <span className="flex items-center gap-1 rounded-full bg-dock-yellow/20 px-2 py-0.5 text-[10px] font-bold text-dock-yellow animate-pulse">
                                  <span>✨</span> UPDATE AVAILABLE
                                </span>
                              )}
                              {checkFailed && (
                                <span
                                  className="rounded-full bg-dock-border/50 px-2 py-0.5 text-[10px] font-semibold text-dock-muted"
                                  title="The image could not be compared with the registry (not pulled locally, registry unreachable or not in DOCKWATCH_ALLOWED_REGISTRIES)."
                                >
                                  UPDATE STATUS UNKNOWN
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-2 mt-2">
                              <span className={`rounded-xl px-3 py-1 text-xs font-semibold ${serviceStateClasses(svc)}`}>
                                {serviceStateLabel(svc)}
                              </span>
                              {svc.Health && (
                                <span className={`rounded-xl px-3 py-1 text-xs font-semibold ${healthClasses[svc.Health] || 'bg-dock-border/50 text-dock-muted'}`}>
                                  {svc.Health}
                                </span>
                              )}
                            </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <span className="text-xs text-dock-muted">{svc.Status}</span>
                          <button
                            type="button"
                            disabled={!!actionLoading}
                            onClick={() => handleServiceUpdate(svc.Service)}
                            className="rounded-lg border border-cyan-300/30 bg-cyan-500/10 px-2.5 py-1 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {actionLoading === `update-service:${svc.Service}` ? 'Updating...' : 'Update'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                }) : (
                    <div className="rounded-[1.25rem] bg-dock-card p-6 text-center border border-dock-border/50">
                      <p className="text-dock-muted font-medium">{isActive ? 'No containers found.' : 'No containers. Start the stack to create them.'}</p>
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
                    <li>Put secrets and variables in the <code>.env</code> tab. Compose substitutes <code>${'{'}VAR{'}'}</code> from it; new <code>.env</code> files are only readable by root.</li>
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
              {composeFileName}
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
        message={(
          <div className="space-y-3">
            <p>Delete stack <strong>{name}</strong>? Its containers are stopped and removed.</p>
            <p className="text-dock-red">
              The folder <code>{stackPath || `/opt/stacks/${name}`}</code> is deleted permanently, including {composeFileName}, the .env file and everything stored inside it.
            </p>
            {extraFiles.length > 0 && (
              <div>
                <p className="text-dock-muted">Also deleted from that folder:</p>
                <ul className="mt-1 max-h-32 overflow-auto rounded-lg border border-dock-border/60 bg-dock-bg/40 px-3 py-2 font-mono text-xs">
                  {extraFiles.map((file) => <li key={file}>{file}</li>)}
                </ul>
              </div>
            )}
            <p className="text-dock-muted">Named Docker volumes are kept.</p>
          </div>
        )}
        confirmLabel="Delete"
        confirmTone="danger"
        busy={actionLoading === 'delete'}
        onCancel={() => setShowDeleteConfirm(false)}
        onConfirm={confirmDelete}
      />

      <AppModal
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title="Previous versions"
        subtitle={name}
        maxWidthClassName="max-w-lg"
      >
        {historyLoading ? (
          <p className="text-sm text-dock-muted">Loading...</p>
        ) : historyVersions.length === 0 ? (
          <p className="text-sm text-dock-muted">No previous versions yet. DockWatch keeps the last 20 versions each time you save.</p>
        ) : (
          <ul className="space-y-2">
            {historyVersions.map((version) => (
              <li key={version.id} className="flex items-center justify-between gap-3 rounded-xl border border-dock-border/60 bg-dock-bg/30 px-3 py-2">
                <div>
                  <div className="text-sm font-medium text-white">{new Date(version.savedAt).toLocaleString()}</div>
                  <div className="text-xs text-dock-muted">{version.hasEnv ? `${composeFileName} + .env` : composeFileName}</div>
                </div>
                <button
                  type="button"
                  onClick={() => loadHistoryVersion(version)}
                  className="rounded-lg border border-dock-border px-3 py-1.5 text-xs font-semibold text-white transition hover:border-dock-accent/40 hover:bg-dock-panel"
                >
                  Load into editor
                </button>
              </li>
            ))}
          </ul>
        )}
      </AppModal>
    </div>
  );
}
