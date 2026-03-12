import { useEffect, useState } from 'react';
import { parseDocument, YAMLMap, YAMLSeq } from 'yaml';

interface Props {
  content: string;
  setContent: (val: string) => void;
}

export default function ServiceConfigurator({ content, setContent }: Props) {
  const [doc, setDoc] = useState<any>(null);
  
  useEffect(() => {
    try {
      const parsed = parseDocument(content);
      if (!parsed.errors.length) {
          setDoc(parsed);
      }
    } catch (e) {
      // Ignored
    }
  }, [content]);

  if (!doc) return null;

  const servicesMap = doc.get('services');
  if (!servicesMap || !(servicesMap instanceof YAMLMap)) return null;
  
  const services = servicesMap.items;
  if (!services || services.length === 0) return null;

  const handleUpdate = (svcName: string, updateFn: (svc: YAMLMap) => void) => {
    try {
        const newDoc = parseDocument(content);
        const svcs = newDoc.get('services');
        if (svcs && svcs instanceof YAMLMap) {
            const svc = svcs.get(svcName);
            if (svc instanceof YAMLMap) {
                updateFn(svc);
                setContent(newDoc.toString());
            }
        }
    } catch (e) {
        console.error(e);
    }
  }

  const toggleExclude = (svcName: string, current: boolean) => {
      handleUpdate(svcName, (svc) => {
          let labels = svc.get('labels');
          if (!labels) {
              svc.set('labels', parseDocument('{}').createNode({}));
              labels = svc.get('labels');
          }
          if (labels instanceof YAMLSeq) {
              let foundIndex = -1;
              for (let i = 0; i < labels.items.length; i++) {
                  if (typeof labels.items[i].value === 'string' && labels.items[i].value.startsWith('dockwatch.update.exclude=')) {
                      foundIndex = i;
                  }
              }
              if (foundIndex >= 0) {
                  if (current) labels.delete(foundIndex); // if current is true, user wants to disable exclusion
                  else labels.items[foundIndex].value = 'dockwatch.update.exclude=true';
              } else if (!current) {
                  labels.add('dockwatch.update.exclude=true');
              }
          } else if (labels instanceof YAMLMap) {
              if (current) labels.delete('dockwatch.update.exclude');
              else labels.set('dockwatch.update.exclude', 'true');
          }
      });
  }

  const setLimit = (svcName: string, key: 'cpus' | 'memory', val: string) => {
      handleUpdate(svcName, (svc) => {
          let deploy = svc.get('deploy') as any;
          if (!deploy) { svc.set('deploy', parseDocument('{}').createNode({})); deploy = svc.get('deploy'); }
          let resources = deploy.get('resources') as any;
          if (!resources) { deploy.set('resources', parseDocument('{}').createNode({})); resources = deploy.get('resources'); }
          let limits = resources.get('limits') as any;
          if (!limits) { resources.set('limits', parseDocument('{}').createNode({})); limits = resources.get('limits'); }
          
          if (!val) {
              limits.delete(key);
              if (limits.items.length === 0) resources.delete('limits');
              if (resources.items.length === 0) deploy.delete('resources');
              if (deploy.items.length === 0) svc.delete('deploy');
          } else {
              limits.set(key, val);
          }
      });
  }

  return (
    <div>
      <h2 className="text-xl font-medium text-white mb-3 tracking-tight">Services Konfiguration</h2>
      <div className="space-y-3">
        {services.map((item) => {
          const svcName = item.key && typeof item.key === 'object' && 'value' in item.key ? (item.key as any).value : String(item.key);
          const svc = item.value;
          if (!(svc instanceof YAMLMap)) return null;
          
          let isExcluded = false;
          const labels = svc.get('labels');
          if (labels instanceof YAMLSeq) {
              isExcluded = labels.items.some((i: any) => typeof i.value === 'string' && i.value.replace(/ /g, '') === 'dockwatch.update.exclude=true');
          } else if (labels instanceof YAMLMap) {
              isExcluded = labels.get('dockwatch.update.exclude') === 'true';
          }

          let currentCpus = '';
          let currentMem = '';
          const deploy = svc.get('deploy');
          if (deploy instanceof YAMLMap) {
              const resources = deploy.get('resources');
              if (resources instanceof YAMLMap) {
                  const limits = resources.get('limits');
                  if (limits instanceof YAMLMap) {
                      currentCpus = limits.get('cpus')?.toString() || '';
                      currentMem = limits.get('memory')?.toString() || '';
                  }
              }
          }

          return (
            <div key={svcName} className="rounded-[1.25rem] bg-dock-card p-5 border border-dock-border/50 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white">{svcName}</h3>
                <label className="flex items-center gap-2 cursor-pointer group">
                  <span className="text-sm font-medium text-dock-muted group-hover:text-white transition">Auto-Update</span>
                  <div className="relative">
                    <input 
                      type="checkbox" 
                      className="sr-only" 
                      checked={!isExcluded} 
                      onChange={() => toggleExclude(svcName, isExcluded)}
                    />
                    <div className={`block w-10 h-6 rounded-full transition-colors ${!isExcluded ? 'bg-dock-accent' : 'bg-dock-border/60'}`}></div>
                    <div className={`absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${!isExcluded ? 'translate-x-4' : ''}`}></div>
                  </div>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-4">
                 <div>
                    <label className="block text-xs font-semibold text-dock-muted mb-1 uppercase tracking-wider">CPU Limit</label>
                    <input 
                      type="text" 
                      placeholder="z.B. 0.5" 
                      value={currentCpus}
                      onChange={(e) => setLimit(svcName, 'cpus', e.target.value)}
                      className="w-full bg-[#0c0d12] border border-dock-border/50 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-dock-accent transition"
                    />
                 </div>
                 <div>
                    <label className="block text-xs font-semibold text-dock-muted mb-1 uppercase tracking-wider">RAM Limit</label>
                    <input 
                      type="text" 
                      placeholder="z.B. 512M" 
                      value={currentMem}
                      onChange={(e) => setLimit(svcName, 'memory', e.target.value)}
                      className="w-full bg-[#0c0d12] border border-dock-border/50 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-dock-accent transition"
                    />
                 </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
