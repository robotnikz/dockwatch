const fs = require('fs');

let code = fs.readFileSync('/root/Github/dockwatch/web/src/components/StatsPanel.tsx', 'utf8');

// Replace sort state if it exists, otherwise we'll leave it
let hasSortVars = code.includes('setSortCol');

// Remove existing sortedContainers
code = code.replace(
  "  const sortedContainers = [...containers].sort((a, b) => b.cpu_percent - a.cpu_percent);\n" +
  "  const topConsumers = sortedContainers.slice(0, 3).map((container) => container.name).join(', ');",
  ""
);

code = code.replace(
  "  const sortedContainers = [...containers].sort((a, b) => b.cpu_percent - a.cpu_percent);\r\n" +
  "  const topConsumers = sortedContainers.slice(0, 3).map((container) => container.name).join(', ');",
  ""
);

const newLogic = `
  const sortedContainers = [...containers].sort((a, b) => {
    let valA: any = a[sortCol as keyof ContainerStats];
    let valB: any = b[sortCol as keyof ContainerStats];

    const parseMem = (str: string) => {
      if (!str) return 0;
      const num = parseFloat(str);
      if (str.includes('GiB')) return num * 1024 * 1024 * 1024;
      if (str.includes('MiB')) return num * 1024 * 1024;
      if (str.includes('KiB')) return num * 1024;
      if (str.includes('B')) return num;
      return num;
    };

    if (sortCol === 'mem_usage') {
      valA = parseMem(a.mem_usage);
      valB = parseMem(b.mem_usage);
    } else if (sortCol === 'net_io') {
      valA = parseMem(a.net_io?.split(' / ')[0] || '0');
      valB = parseMem(b.net_io?.split(' / ')[0] || '0');
    } else if (sortCol === 'block_io') {
      valA = parseMem(a.block_io?.split(' / ')[0] || '0');
      valB = parseMem(b.block_io?.split(' / ')[0] || '0');
    } else if (sortCol === 'name') {
      valA = a.name.toLowerCase();
      valB = b.name.toLowerCase();
    }

    if (valA < valB) return sortDesc ? 1 : -1;
    if (valA > valB) return sortDesc ? -1 : 1;
    return 0;
  });

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDesc(!sortDesc);
    } else {
      setSortCol(col);
      setSortDesc(col !== 'name'); // default desc for metric numbers
    }
  };

  const SortIcon = ({ col }: { col: string }) => {
    if (sortCol !== col) return <span className="opacity-0 group-hover:opacity-40 inline-block w-4 text-center">↕</span>;
    return <span className="inline-block w-4 text-center text-dock-accent">{sortDesc ? '↓' : '↑'}</span>;
  };

  const topConsumers = [...containers].sort((a, b) => b.cpu_percent - a.cpu_percent).slice(0, 3).map((c) => c.name).join(', ');
`;

code = code.replace(
  "  return (",
  newLogic + "\n  return ("
);

// Actually make sure sortCol defaults to 'cpu_percent' if it was 'Name' (because my old script set it to 'Name')
code = code.replace("useState<string>('Name');", "useState<string>('cpu_percent');");
code = code.replace("useState<string>('name');", "useState<string>('cpu_percent');");

const oldHeaders = `<th className="px-4 py-3 text-left font-medium">Container</th>
                  <th className="px-4 py-3 text-right font-medium">CPU</th>
                  <th className="px-4 py-3 text-right font-medium">Memory</th>
                  <th className="hidden px-4 py-3 text-right font-medium md:table-cell">Mem %</th>
                  <th className="hidden px-4 py-3 text-right font-medium lg:table-cell">Net I/O</th>
                  <th className="hidden px-4 py-3 text-right font-medium lg:table-cell">Block I/O</th>
                  <th className="hidden px-4 py-3 text-right font-medium md:table-cell">PIDs</th>`;

const newHeaders = `<th className="px-4 py-3 text-left font-medium cursor-pointer group hover:text-dock-accent transition select-none" onClick={() => handleSort('name')}>Container <SortIcon col="name"/></th>
                  <th className="px-4 py-3 text-right font-medium cursor-pointer group hover:text-dock-accent transition select-none" onClick={() => handleSort('cpu_percent')}><SortIcon col="cpu_percent"/> CPU</th>
                  <th className="px-4 py-3 text-right font-medium cursor-pointer group hover:text-dock-accent transition select-none" onClick={() => handleSort('mem_usage')}><SortIcon col="mem_usage"/> Memory</th>
                  <th className="hidden px-4 py-3 text-right font-medium md:table-cell cursor-pointer group hover:text-dock-accent transition select-none" onClick={() => handleSort('mem_percent')}><SortIcon col="mem_percent"/> Mem %</th>
                  <th className="hidden px-4 py-3 text-right font-medium lg:table-cell cursor-pointer group hover:text-dock-accent transition select-none" onClick={() => handleSort('net_io')}><SortIcon col="net_io"/> Net I/O</th>
                  <th className="hidden px-4 py-3 text-right font-medium lg:table-cell cursor-pointer group hover:text-dock-accent transition select-none" onClick={() => handleSort('block_io')}><SortIcon col="block_io"/> Block I/O</th>
                  <th className="hidden px-4 py-3 text-right font-medium md:table-cell cursor-pointer group hover:text-dock-accent transition select-none" onClick={() => handleSort('pids')}><SortIcon col="pids"/> PIDs</th>`;

code = code.replace(oldHeaders, newHeaders);

fs.writeFileSync('/root/Github/dockwatch/web/src/components/StatsPanel.tsx', code);
