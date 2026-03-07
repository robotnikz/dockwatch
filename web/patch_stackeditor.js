const fs = require('fs');
let content = fs.readFileSync('/root/Github/dockwatch/web/src/pages/StackEditor.tsx', 'utf8');

content = content.replace("aktiv' : 'inaktiv'", "active' : 'inactive'");
content = content.replace("Neuer Stackname", "New stack name");
content = content.replace("Speichern...' : 'Speichern'", "Saving...' : 'Save'");
content = content.replace("Abbrechen\n                </button>", "Cancel\n                </button>");
content = content.replace("<span>✏️</span> Bearbeiten", "<span>✏️</span> Edit");
content = content.replace("<span>🔄</span> Neustarten", "<span>🔄</span> Restart");
content = content.replace("<span>☁️</span> Aktualisieren", "<span>☁️</span> Update");
content = content.replace("<span>⏹</span> Anhalten", "<span>⏹</span> Stop");
content = content.replace("<span>🗑️</span> Löschen", "<span>🗑️</span> Delete");

content = content.replace("Keine Container gefunden.", "No containers found.");
content = content.replace("Stack starten\n                      </button>", "Start stack\n                      </button>");
content = content.replace("Aktualisieren</button>", "Refresh</button>");
content = content.replace("logs || 'Keine Logs verfügbar.'", "logs || 'No logs available.'");
content = content.replace("<h2>Hinweise</h2>", "<h2>Guidance</h2>");
content = content.replace(">Hinweise</h2>", ">Guidance</h2>");
content = content.replace("Geben Sie einen Stack-Namen ein und fügen Sie eine Docker Compose YAML-Datei ein.", "Enter a stack name and paste a Docker Compose YAML definition.");
content = content.replace("Das Projekt wird unter", "The project will be stored and run from");
content = content.replace("Port-Bindungen und Volume-Pfade prüfen, bevor der Stack gestartet wird.", "Check port bindings and volume paths before starting the stack.");

fs.writeFileSync('/root/Github/dockwatch/web/src/pages/StackEditor.tsx', content);
