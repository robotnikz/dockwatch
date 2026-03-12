import { useState } from 'react';
import { convertDockerRun } from '../api';

interface Props {
  onUseCompose?: (compose: string) => void;
}

export default function DockerRunConverter({ onUseCompose }: Props) {
  const [command, setCommand] = useState('');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const sampleCommand = 'docker run -d --name whoami -p 8080:80 -e TZ=Europe/Berlin --restart unless-stopped traefik/whoami:latest';

  const handleConvert = async () => {
    if (!command.trim()) return;
    setLoading(true);
    setError('');
    setResult('');
    setCopied(false);
    try {
      const { compose } = await convertDockerRun(command);
      setResult(compose);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(result);
    setCopied(true);
  };

  return (
    <section className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(320px,1.05fr)]">
      <div className="rounded-[28px] border border-dock-border/70 bg-dock-card/85 p-5 shadow-dock">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-dock-muted">Command Input</p>
            <h3 className="mt-1 text-2xl font-bold tracking-tight text-white">docker run</h3>
          </div>
          <button
            onClick={() => setCommand(sampleCommand)}
            className="rounded-2xl border border-dock-border bg-transparent px-4 py-2 text-sm font-semibold text-dock-muted transition hover:border-dock-accent/40 hover:text-white"
          >
            Load Example
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <div>
            <label className="mb-2 block text-sm font-semibold text-white">Command</label>
          <textarea
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="docker run -d --name myapp -p 8080:80 -v /data:/app/data -e MY_VAR=hello nginx:latest"
            rows={10}
            spellCheck={false}
            className="w-full resize-y rounded-[24px] border border-dock-border bg-black/18 px-4 py-4 text-sm leading-7 text-white outline-none transition focus:border-dock-accent"
          />
        </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleConvert}
              disabled={loading || !command.trim()}
              className="rounded-2xl bg-dock-accent px-5 py-3 text-sm font-semibold text-dock-bg transition hover:bg-dock-accent/90 disabled:opacity-50"
            >
              {loading ? 'Converting...' : 'Convert to Compose'}
            </button>
            <button
              onClick={() => {
                setCommand('');
                setResult('');
                setError('');
                setCopied(false);
              }}
              className="rounded-2xl border border-dock-border bg-transparent px-5 py-3 text-sm font-semibold text-dock-muted transition hover:border-dock-accent/40 hover:text-white"
            >
              Clear
            </button>
          </div>

          {error && (
            <div className="rounded-2xl border border-dock-red/40 bg-dock-red/12 px-4 py-3 text-sm text-dock-red">
              {error}
            </div>
          )}

          <div className="rounded-3xl border border-dock-border/70 bg-dock-panel/55 p-4">
            <p className="text-[11px] uppercase tracking-[0.22em] text-dock-muted">Supported Mapping</p>
            <p className="mt-2 text-sm leading-6 text-dock-muted">
              Ports, volumes, environment variables, labels, networks, capabilities, devices, DNS, restart policy,
              resource limits and common runtime flags are converted into compose-friendly output.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-[28px] border border-dock-border/70 bg-dock-card/85 p-5 shadow-dock">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-dock-muted">Output</p>
            <h3 className="mt-1 text-2xl font-bold tracking-tight text-white">compose.yaml</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {result && (
              <>
                <button
                  onClick={handleCopy}
                  className="rounded-2xl border border-dock-border bg-transparent px-4 py-2 text-sm font-semibold text-dock-muted transition hover:border-dock-accent/40 hover:text-white"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
                {onUseCompose && (
                  <button
                    onClick={() => onUseCompose(result)}
                    className="rounded-2xl bg-dock-green px-4 py-2 text-sm font-semibold text-dock-bg transition hover:bg-dock-green/90"
                  >
                    Use as Stack
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        <div className="mt-5 rounded-[24px] border border-dock-border/70 bg-black/18 p-4">
          {result ? (
            <pre className="max-h-[580px] overflow-auto whitespace-pre text-xs text-dock-text">{result}</pre>
          ) : (
            <div className="flex min-h-[320px] items-center justify-center rounded-2xl border border-dock-border/50 border-dashed text-center text-sm leading-6 text-dock-muted">
              Converted compose output will appear here.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
