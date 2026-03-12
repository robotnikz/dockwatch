import { useCallback, useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import StackEditor from './pages/StackEditor';
import Settings from './pages/Settings';
import Convert from './pages/Convert';
import CleanupPage from './pages/Cleanup';
import LoginPage from './pages/Login';
import { changePasswordAuth, getAuthMe, logoutAuth, type AuthMe } from './api';

const DEFAULT_AUTH_ME: AuthMe = {
  enabled: false,
  configured: false,
  authenticated: true,
  username: null,
};

export default function App() {
  const [authMe, setAuthMe] = useState<AuthMe>(DEFAULT_AUTH_ME);
  const [loadingAuth, setLoadingAuth] = useState(true);

  const refreshAuth = useCallback(async () => {
    try {
      const me = await getAuthMe();
      setAuthMe(me);
    } catch {
      setAuthMe(DEFAULT_AUTH_ME);
    } finally {
      setLoadingAuth(false);
    }
  }, []);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  useEffect(() => {
    const onAuthRequired = () => {
      setAuthMe((prev) => ({ ...prev, authenticated: false }));
    };
    window.addEventListener('dockwatch:auth-required', onAuthRequired);
    return () => window.removeEventListener('dockwatch:auth-required', onAuthRequired);
  }, []);

  const handleLogout = useCallback(async () => {
    await logoutAuth();
    setAuthMe((prev) => ({ ...prev, authenticated: false }));
  }, []);

  const handleChangePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const response = await changePasswordAuth(currentPassword, newPassword);
    setAuthMe(response.me);
  }, []);

  if (loadingAuth) {
    return (
      <div className="min-h-screen bg-dock-bg flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-dock-border border-t-dock-accent" />
      </div>
    );
  }

  if (authMe.enabled && !authMe.authenticated) {
    return <LoginPage me={authMe} onAuthenticated={setAuthMe} />;
  }

  return (
    <div className="flex h-screen bg-dock-bg text-dock-text overflow-hidden">
      <Sidebar
        authEnabled={authMe.enabled}
        authUsername={authMe.username}
        onLogout={handleLogout}
        onChangePassword={handleChangePassword}
      />
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
