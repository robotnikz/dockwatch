const fs = require('fs');
const filePath = '/root/Github/dockwatch/web/src/pages/StackEditor.tsx';
let content = fs.readFileSync(filePath, 'utf8');

const oldBtns = `<button onClick={() => setIsEditing(true)} className="flex items-center gap-2 rounded-xl bg-dock-panel px-4 py-2 text-sm font-bold text-white transition hover:bg-dock-border">
                <span>✏️</span> Edit
              </button>
              <button disabled={!!actionLoading} onClick={() => handleAction('restart')} className="flex items-center gap-2 rounded-xl bg-dock-panel px-4 py-2 text-sm font-bold text-white transition hover:bg-dock-border disabled:opacity-50">
                <span>🔄</span> Restart
              </button>`;

const newBtns = `<button onClick={() => setIsEditing(true)} className="flex items-center gap-2 rounded-xl bg-dock-panel px-4 py-2 text-sm font-bold text-white transition hover:bg-dock-border">
                <span>✏️</span> Edit
              </button>
              {!isActive && (
                <button disabled={!!actionLoading} onClick={() => handleAction('up')} className="flex items-center gap-2 rounded-xl bg-dock-accent/20 px-4 py-2 text-sm font-bold text-dock-accent transition hover:bg-dock-accent/30 disabled:opacity-50">
                  <span>▶️</span> Start
                </button>
              )}
              {isActive && (
                <button disabled={!!actionLoading} onClick={() => handleAction('restart')} className="flex items-center gap-2 rounded-xl bg-dock-panel px-4 py-2 text-sm font-bold text-white transition hover:bg-dock-border disabled:opacity-50">
                  <span>🔄</span> Restart
                </button>
              )}`;

content = content.replace(oldBtns, newBtns);
fs.writeFileSync(filePath, content);
