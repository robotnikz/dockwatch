import { useEffect, useState } from 'react';
import { AnsiUp } from 'ansi_up';
import AppModal from './AppModal';

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
    <AppModal
      isOpen={true}
      onClose={onClose}
      subtitle="Runtime Output"
      title={name}
      maxWidthClassName="max-w-[90vw]"
      footer={(
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="rounded-full border border-dock-border/70 px-3 py-1.5 text-sm font-semibold text-dock-muted transition hover:border-dock-accent/40 hover:text-white"
          >
            Close
          </button>
        </div>
      )}
    >
      <pre
        className="log-output rounded-xl border border-dock-border/60 bg-[#0c0d10] p-4 text-xs text-[#e2e8f0] overflow-x-auto whitespace-pre font-mono leading-relaxed max-w-full"
        dangerouslySetInnerHTML={{ __html: htmlContent }}
        style={{ tabSize: 4 }}
      />
    </AppModal>
  );
}