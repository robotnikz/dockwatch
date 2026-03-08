import { Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import StackEditor from './pages/StackEditor';
import Settings from './pages/Settings';
import Convert from './pages/Convert';
import CleanupPage from './pages/Cleanup';

export default function App() {
  return (
    <div className="flex h-screen bg-dock-bg text-dock-text overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full p-6 lg:p-8 xl:p-10 max-w-[1600px]">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/new" element={<StackEditor />} />
            <Route path="/stack/:name" element={<StackEditor />} />
            <Route path="/convert" element={<Convert />} />
            <Route path="/cleanup" element={<CleanupPage />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
