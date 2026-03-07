import { useEffect, useState } from 'react';
import { AnsiUp } from 'ansi_up';

interface Props {
  name: string;
  output: string;
  onClose: () => void;
}

export default function LogModal({ name, output, onClose }: Props) {
  const [htmlContent, setHtmlContent] = useState('');
  
  useEffect(() => {
    const ansi_up = new AnsiUp();
    ansi_up.use_classes = false;

    // Sometimes Docker Compose output over child_process loses the actual ESC char (\x1b) 
    // and just leaves the bracket if not careful, OR ansi_up doesn't like docker compose prefix.
    // Docker compose with --ansi always sends actual \x1b.
    let raw = output || 'No logs available';
    
    // Fix unicode escapes if they got mangled over JSON
    const fixedOut = raw.replace(/\\u001b/g, '\x1b')
                       .replace(/\\x1b/g, '\x1b')
                       .replace(//g, '\x1b');

    const html = ansi_up.ansi_to_html(fixedOut);
    setHtmlContent(html);
  }, [output]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/72 p-4 backdrop-blur-md" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-[90vw] flex-col overflow-hidden rounded-[28px] border border-dock-border/70 bg-dock-card shadow-dock"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-dock-border/70 px-5 py-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-dock-muted">Runtime Output</p>
            <h3 className="mt-1 text-xl font-bold text-white">{name}</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-full border border-dock-border/70 px-3 py-1.5 text-sm font-semibold text-dock-muted transition hover:border-dock-accent/40 hover:text-white"
          >
            Close
          </button>
        </div>
        <div className="flex-1 overflow-auto bg-dock-bg/38 p-5">
          <pre 
            className="log-output rounded-xl border border-dock-border/60 bg-[#0c0d10] p-4 text-xs text-[#e2e8f0] overflow-x-auto whitespace-pre font-mono leading-relaxed max-w-full"
            dangerouslySetInnerHTML={{ __html: htmlContent }}
            style={{ tabSize: 4 }}
          />
        </div>
      </div>
    </div>
  );
}