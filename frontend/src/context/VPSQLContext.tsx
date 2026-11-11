'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { 
  api, 
  getApiBaseUrl,
  ProjectData, 
  RoleData, 
  ActivityData, 
  NodeMetricsData,
  RedisInstanceData,
  RedisMetricsData,
  AIWorkerStatusData,
  GroupedProjectData
} from '@/lib/api';

interface VPSQLContextType {
  // Auth
  authed: boolean | null;
  loginEmail: string;
  setLoginEmail: (email: string) => void;
  loginPassword: string;
  setLoginPassword: (pwd: string) => void;
  loginEndpoint: string;
  setLoginEndpoint: (endpoint: string) => void;
  loginError: string;
  signingIn: boolean;
  handleSignIn: (e: React.FormEvent) => Promise<void>;
  handleSignOut: () => void;

  // Health
  apiConnected: boolean | null;
  apiLatency: number;
  apiError: string;
  checkHealth: () => Promise<void>;

  // Data
  databases: ProjectData[];
  loadingDbs: boolean;
  refreshProjects: () => Promise<void>;

  redisList: RedisInstanceData[];
  refreshRedis: () => Promise<void>;
  redisMetrics: RedisMetricsData | null;
  refreshRedisMetrics: () => Promise<void>;

  groupedProjects: GroupedProjectData[];
  refreshGroupedProjects: () => Promise<void>;

  aiWorkerStatus: AIWorkerStatusData | null;
  refreshAiStatus: () => Promise<void>;

  roles: RoleData[];
  refreshRoles: () => Promise<void>;

  activity: ActivityData[];
  refreshActivity: () => Promise<void>;

  nodeMetrics: NodeMetricsData | null;
  refreshNode: () => Promise<void>;

  // UI state
  toast: string;
  flash: (msg: string) => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  createProjectModalOpen: boolean;
  setCreateProjectModalOpen: (open: boolean) => void;
  createDbModalOpen: boolean;
  setCreateDbModalOpen: (open: boolean) => void;
  selectedProjectForNewDb: string;
  setSelectedProjectForNewDb: (proj: string) => void;
}

const VPSQLContext = createContext<VPSQLContextType | null>(null);

export function VPSQLProvider({ children }: { children: React.ReactNode }) {
  // Auth state
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [loginEndpoint, setLoginEndpoint] = useState('');
  const [loginEmail, setLoginEmail] = useState('admin@vpsql.dev');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  // Live cluster data
  const [databases, setDatabases] = useState<ProjectData[]>([]);
  const [loadingDbs, setLoadingDbs] = useState(true);
  const [roles, setRoles] = useState<RoleData[]>([]);
  const [nodeMetrics, setNodeMetrics] = useState<NodeMetricsData | null>(null);
  const [activity, setActivity] = useState<ActivityData[]>([]);
  const [redisList, setRedisList] = useState<RedisInstanceData[]>([]);
  const [redisMetrics, setRedisMetrics] = useState<RedisMetricsData | null>(null);
  const [aiWorkerStatus, setAiWorkerStatus] = useState<AIWorkerStatusData | null>(null);
  const [groupedProjects, setGroupedProjects] = useState<GroupedProjectData[]>([]);

  // Health indicator
  const [apiConnected, setApiConnected] = useState<boolean | null>(null);
  const [apiLatency, setApiLatency] = useState(0);
  const [apiError, setApiError] = useState('');

  // UI & Modals
  const [toast, setToast] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [createProjectModalOpen, setCreateProjectModalOpen] = useState(false);
  const [createDbModalOpen, setCreateDbModalOpen] = useState(false);
  const [selectedProjectForNewDb, setSelectedProjectForNewDb] = useState('default');

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  }, []);

  // Health check
  const checkHealth = useCallback(async () => {
    const start = performance.now();
    try {
      const res = await api.checkHealth();
      const lat = Math.round(performance.now() - start);
      setApiLatency(lat);
      setApiConnected(res?.status === 'ok');
      setApiError('');
    } catch (err: any) {
      setApiConnected(false);
      setApiError(err.message || 'API unreachable');
    }
  }, []);

  // Fetch databases
  const refreshProjects = useCallback(async () => {
    setLoadingDbs(true);
    try {
      const projs = await api.listProjects();
      setDatabases(Array.isArray(projs) ? projs : []);
      setApiConnected(true);
      setApiError('');
    } catch (err: any) {
      console.error('Failed to list projects:', err);
      setApiConnected(false);
      setApiError(err.message || 'Failed to fetch databases');
    } finally {
      setLoadingDbs(false);
    }
  }, []);

  // Fetch grouped projects
  const refreshGroupedProjects = useCallback(async () => {
    try {
      const res = await api.getGroupedProjects();
      if (res && res.projects) {
        setGroupedProjects(res.projects);
      }
    } catch (err) {
      console.error('Failed to list grouped projects:', err);
    }
  }, []);

  // Fetch roles
  const refreshRoles = useCallback(async () => {
    try {
      const r = await api.listRoles();
      setRoles(Array.isArray(r) ? r : []);
    } catch (err) {
      console.error('Failed to fetch roles:', err);
    }
  }, []);

  // Fetch node metrics
  const refreshNode = useCallback(async () => {
    try {
      const n = await api.getNodeMetrics();
      if (n) setNodeMetrics(n);
    } catch (err) {
      console.error('Failed to fetch node metrics:', err);
    }
  }, []);

  // Fetch activity
  const refreshActivity = useCallback(async () => {
    try {
      const a = await api.listActivity();
      setActivity(Array.isArray(a) ? a : []);
    } catch (err) {
      console.error('Failed to fetch activity:', err);
    }
  }, []);

  // Fetch redis
  const refreshRedis = useCallback(async () => {
    try {
      const list = await api.listRedis();
      setRedisList(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('Failed to fetch redis list:', err);
    }
  }, []);

  const refreshRedisMetrics = useCallback(async () => {
    try {
      const m = await api.getRedisMetrics();
      if (m) setRedisMetrics(m);
    } catch (err) {
      console.error('Failed to fetch redis metrics:', err);
    }
  }, []);

  // Fetch AI status
  const refreshAiStatus = useCallback(async () => {
    try {
      const s = await api.getAIWorkerStatus();
      if (s) setAiWorkerStatus(s);
    } catch (err) {
      console.error('Failed to fetch AI worker status:', err);
    }
  }, []);

  // Verify stored session on mount
  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('vpsql_token') : null;
    const email = typeof window !== 'undefined' ? localStorage.getItem('vpsql_email') : null;
    const endpoint = typeof window !== 'undefined' ? localStorage.getItem('vpsql_api_endpoint') : null;

    if (email) setLoginEmail(email);
    if (endpoint) setLoginEndpoint(endpoint);

    if (!token) {
      setAuthed(false);
      return;
    }

    api.getAuthMe()
      .then((res: { authenticated: boolean; email: string }) => {
        if (res?.authenticated) {
          setAuthed(true);
          if (res.email) setLoginEmail(res.email);
        } else {
          setAuthed(false);
        }
      })
      .catch(() => {
        setAuthed(true);
      });
  }, []);

  // Fetch initial cluster data when authenticated
  useEffect(() => {
    if (authed) {
      checkHealth();
      refreshProjects();
      refreshGroupedProjects();
      refreshRoles();
      refreshNode();
      refreshActivity();
      refreshRedis();
      refreshRedisMetrics();
      refreshAiStatus();
    }
  }, [
    authed, 
    checkHealth, 
    refreshProjects, 
    refreshGroupedProjects, 
    refreshRoles, 
    refreshNode, 
    refreshActivity, 
    refreshRedis, 
    refreshRedisMetrics, 
    refreshAiStatus
  ]);

  // Sign in
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setSigningIn(true);
    setLoginError('');

    try {
      if (loginEndpoint.trim()) {
        localStorage.setItem('vpsql_api_endpoint', loginEndpoint.trim());
      } else {
        localStorage.removeItem('vpsql_api_endpoint');
      }

      const res = await api.login(loginEmail, loginPassword);
      if (res && res.token) {
        localStorage.setItem('vpsql_token', res.token);
        localStorage.setItem('vpsql_email', res.email || loginEmail);
        setAuthed(true);
        flash('✓ Autenticado com sucesso! Sessão iniciada.');
        checkHealth();
        refreshProjects();
        refreshGroupedProjects();
        refreshRoles();
        refreshNode();
        refreshActivity();
      }
    } catch (err: any) {
      setLoginError(err.message || 'Falha ao autenticar.');
    } finally {
      setSigningIn(false);
    }
  };

  // Sign out
  const handleSignOut = () => {
    localStorage.removeItem('vpsql_token');
    localStorage.removeItem('vpsql_email');
    setAuthed(false);
    setDatabases([]);
    flash('Sessão encerrada com sucesso.');
  };

  const value = useMemo(() => ({
    authed,
    loginEmail,
    setLoginEmail,
    loginPassword,
    setLoginPassword,
    loginEndpoint,
    setLoginEndpoint,
    loginError,
    signingIn,
    handleSignIn,
    handleSignOut,
    apiConnected,
    apiLatency,
    apiError,
    checkHealth,
    databases,
    loadingDbs,
    refreshProjects,
    redisList,
    refreshRedis,
    redisMetrics,
    refreshRedisMetrics,
    groupedProjects,
    refreshGroupedProjects,
    aiWorkerStatus,
    refreshAiStatus,
    roles,
    refreshRoles,
    activity,
    refreshActivity,
    nodeMetrics,
    refreshNode,
    toast,
    flash,
    paletteOpen,
    setPaletteOpen,
    createProjectModalOpen,
    setCreateProjectModalOpen,
    createDbModalOpen,
    setCreateDbModalOpen,
    selectedProjectForNewDb,
    setSelectedProjectForNewDb,
  }), [
    authed, loginEmail, loginPassword, loginEndpoint, loginError, signingIn,
    apiConnected, apiLatency, apiError, databases, loadingDbs, redisList,
    redisMetrics, groupedProjects, aiWorkerStatus, roles, activity, nodeMetrics,
    toast, paletteOpen, createProjectModalOpen, createDbModalOpen, selectedProjectForNewDb,
    flash, checkHealth, refreshProjects, refreshGroupedProjects, refreshRoles,
    refreshNode, refreshActivity, refreshRedis, refreshRedisMetrics, refreshAiStatus
  ]);

  return (
    <VPSQLContext.Provider value={value}>
      {children}
    </VPSQLContext.Provider>
  );
}

export function useVPSQL() {
  const context = useContext(VPSQLContext);
  if (!context) {
    throw new Error('useVPSQL must be used within a VPSQLProvider');
  }
  return context;
}
