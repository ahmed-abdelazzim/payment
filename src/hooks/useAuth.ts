import { useState, useCallback, useEffect } from 'react';
import { User, Workspace } from '../types';
import { apiFetch } from '../api';

export function useAuth() {
  const [hasSession, setHasSession] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [userWorkspaces, setUserWorkspaces] = useState<any[]>([]);
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(true);

  const verifySession = useCallback(async () => {
    setIsAuthLoading(true);
    try {
      const res = await apiFetch('/api/v1/auth/me');

      if (res.ok) {
        const data = await res.json();
        setHasSession(true);
        setCurrentUser(data.user);
        setWorkspace({
          id: data.organization.id,
          name: data.organization.name,
          nameAr: data.organization.name_ar || data.organization.name,
          subTitle: `${data.organization.name_ar || data.organization.name} - بوابة العمليات`,
          initials: data.organization.name.slice(0, 2).toUpperCase(),
          slug: data.organization.slug,
          defaultTimezone: data.organization.default_timezone,
        });
        if (Array.isArray(data.workspaces)) {
          setUserWorkspaces(data.workspaces);
        }
      } else {
        setHasSession(false);
        setCurrentUser(null);
        setWorkspace(null);
      }
    } catch {
      // Server unreachable
      setHasSession(false);
      setCurrentUser(null);
      setWorkspace(null);
    } finally {
      setIsAuthLoading(false);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await apiFetch('/api/v1/auth/logout', { method: 'POST' });
    } catch {}
    setHasSession(false);
    setCurrentUser(null);
    setWorkspace(null);
  }, []);

  const handleSwitchWorkspace = useCallback(async (orgId: string): Promise<Workspace | null> => {
    try {
      const res = await apiFetch('/api/v1/auth/switch-workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId }),
      });
      if (res.ok) {
        const nextOrg = userWorkspaces.find((w) => w.id === orgId);
        if (nextOrg) {
          const updated: Workspace = {
            id: nextOrg.id,
            name: nextOrg.name,
            nameAr: nextOrg.name_ar || nextOrg.name,
            subTitle: `${nextOrg.name_ar || nextOrg.name} - بوابة العمليات`,
            initials: nextOrg.name.slice(0, 2).toUpperCase(),
            slug: nextOrg.slug,
            defaultTimezone: nextOrg.default_timezone,
          };
          setWorkspace(updated);
          return updated;
        }
      }
    } catch {}
    return null;
  }, [userWorkspaces]);

  useEffect(() => {
    verifySession();
  }, [verifySession]);

  return {
    hasSession,
    setHasSession,
    currentUser,
    setCurrentUser,
    workspace,
    setWorkspace,
    userWorkspaces,
    isAuthLoading,
    verifySession,
    handleLogout,
    handleSwitchWorkspace,
  };
}
