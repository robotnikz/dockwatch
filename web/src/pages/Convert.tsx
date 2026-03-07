import { useNavigate } from 'react-router-dom';
import DockerRunConverter from '../components/DockerRunConverter';

export default function Convert() {
  const navigate = useNavigate();

  const handleUseAsStack = (compose: string) => {
    sessionStorage.setItem('dockwatch_prefill', compose);
    navigate('/new');
  };

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto">
      <div className="pb-4 border-b border-dock-border/50">
        <p className="text-[11px] uppercase tracking-[0.26em] text-dock-muted">Migration Helper</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-white flex items-center justify-between">
          <span>Docker Run Converter</span>
          <button 
            onClick={() => navigate('/')} 
            className="text-sm font-semibold text-dock-muted hover:text-white transition"
          >
            Back
          </button>
        </h1>
      </div>

      <DockerRunConverter onUseCompose={handleUseAsStack} />
    </div>
  );
}
