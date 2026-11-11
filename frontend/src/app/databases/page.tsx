'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { 
  api, 
  ProjectData, 
  TableSchema, 
  LogEntry 
} from '@/lib/api';
import { useVPSQL } from '@/context/VPSQLContext';
import { useDialog } from '@/components/ModalDialog';
import SqlEditor from '@/components/SqlEditor';
import TypesModal from '@/components/TypesModal';
import DataBrowserModal from '@/components/DataBrowserModal';
import { 
  Database, Plus, RefreshCw, Copy, Check, GitBranch, Trash2,
  Code2, Table2, Terminal, X, Search
} from 'lucide-react';

const ALL_EXTS = ['uuid-ossp', 'pgcrypto', 'pg_stat_statements', 'vector', 'postgis', 'timescaledb'];

function DatabasesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedParam = searchParams.get('selected');

  const { confirm: showConfirm, alert: showAlert } = useDialog();
  const { 
    databases, 
    loadingDbs, 
    refreshProjects, 
    refreshRoles, 
    refreshActivity, 
    refreshGroupedProjects,
    nodeMetrics, 
    apiLatency, 
    flash, 
    toast,
    createDbModalOpen, 
    setCreateDbModalOpen,
    selectedProjectForNewDb,
    setSelectedProjectForNewDb
  } = useVPSQL();

  const [selectedDbIndex, setSelectedDbIndex] = useState<number | null>(null);
  const [tab, setTab] = useState<'overview' | 'credentials' | 'schema' | 'logs'>('overview');

  // Schema & SQL Runner state
  const [tables, setTables] = useState<TableSchema[]>([]);
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [customSQL, setCustomSQL] = useState('SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = \'public\' LIMIT 5;');
  const [queryRunning, setQueryRunning] = useState(false);
  const [queryResult, setQueryResult] = useState<any | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [queryDuration, setQueryDuration] = useState<number | null>(null);

  // Modals state
  const [typesModalOpen, setTypesModalOpen] = useState(false);
  const [typesModalTable, setTypesModalTable] = useState<string>('all');
  const [dataBrowserOpen, setDataBrowserOpen] = useState(false);
  const [activeBrowserTable, setActiveBrowserTable] = useState<string>('');
  const [branchModalOpen, setBranchModalOpen] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [branching, setBranching] = useState(false);

  // Provision modal form state
  const [newName, setNewName] = useState('');
  const [selectedExts, setSelectedExts] = useState<string[]>(['uuid-ossp', 'pgcrypto']);
  const [provisioning, setProvisioning] = useState(false);

  // Sync selected database from URL search params
  useEffect(() => {
    if (selectedParam && databases.length > 0) {
      const idx = databases.findIndex(d => d.name === selectedParam || d.db_name === selectedParam);
      if (idx >= 0) {
        setSelectedDbIndex(idx);
      }
    } else if (!selectedParam) {
      setSelectedDbIndex(null);
    }
  }, [selectedParam, databases]);

  const currentDb = selectedDbIndex !== null ? databases[selectedDbIndex] : null;

  const currentHost = process.env.NEXT_PUBLIC_DB_HOST || nodeMetrics?.node_host || 'db.example.com';
  const poolerAdminUri = currentDb ? (currentDb.admin_pooler_uri || 
    `postgresql://${currentDb.admin_role || 'admin'}:${currentDb.admin_password || '••••••••'}@${currentHost}:6432/${currentDb.db_name || currentDb.name}?sslmode=disable`) : '';
  const poolerRoUri = currentDb ? (currentDb.readonly_pooler_uri || 
    `postgresql://${currentDb.readonly_role || 'readonly'}:${currentDb.readonly_password || '••••••••'}@${currentHost}:6432/${currentDb.db_name || currentDb.name}?sslmode=disable`) : '';
  const directAdminUri = currentDb ? (currentDb.admin_uri || 
    `postgresql://${currentDb.admin_role || 'admin'}:${currentDb.admin_password || '••••••••'}@${currentHost}:5432/${currentDb.db_name || currentDb.name}?sslmode=disable`) : '';

  const getStatusDot = (st: string) =>
    st === 'running' ? '#4BFF8F' : st === 'idle' ? '#5A5A63' : '#FFB020';

  const copyToClipboard = (text: string, msg: string) => {
    navigator.clipboard.writeText(text);
    flash(msg);
  };

  // Refresh Schema
  const refreshSchema = async (dbName: string) => {
    setLoadingSchema(true);
    try {
      const res = await api.getSchema(dbName);
      setTables(res?.tables || []);
    } catch (err) {
      console.error('Failed to list tables:', err);
      setTables([]);
    } finally {
      setLoadingSchema(false);
    }
  };

  useEffect(() => {
    if (currentDb && tab === 'schema') {
      refreshSchema(currentDb.db_name || currentDb.name);
    }
  }, [currentDb, tab]);

  // Execute Query in SQL Runner
  const handleExecuteQuery = async (sqlToRun?: string) => {
    if (!currentDb) return;
    const query = typeof sqlToRun === 'string' ? sqlToRun : customSQL;
    if (!query.trim()) return;

    setQueryRunning(true);
    setQueryError(null);
    setQueryResult(null);
    const start = performance.now();

    const targetName = currentDb.db_name || currentDb.name;
    try {
      const res = await api.executeQuery(targetName, query);
      const elapsed = Math.round(performance.now() - start);
      setQueryDuration(elapsed);
      setQueryResult(res);
      flash(`Query executada em ${elapsed}ms (${res?.rows?.length || 0} rows)`);

      const upper = query.trim().toUpperCase();
      if (upper.startsWith('CREATE') || upper.startsWith('DROP') || upper.startsWith('ALTER') || upper.startsWith('TRUNCATE')) {
        refreshSchema(targetName);
        refreshProjects();
        refreshGroupedProjects();
      }
    } catch (err: any) {
      flash(`Query failed: ${err.message}`);
      setQueryError(err.message || 'Erro ao executar consulta SQL');
    } finally {
      setQueryRunning(false);
    }
  };

  // Provision Database
  const handleProvision = async () => {
    const name = newName.trim();
    if (!name) {
      flash('Please enter a database name');
      return;
    }
    setProvisioning(true);
    try {
      await api.createProject(name, selectedProjectForNewDb || 'default', selectedExts);
      flash(`Banco "${name}" provisionado com sucesso!`);
      await refreshProjects();
      await refreshRoles();
      await refreshActivity();
      await refreshGroupedProjects();
      setCreateDbModalOpen(false);
      setNewName('');
      router.push(`/databases?selected=${encodeURIComponent(name)}`);
    } catch (err: any) {
      flash(`Provisioning failed: ${err.message}`);
    } finally {
      setProvisioning(false);
    }
  };

  // Branch Database
  const handleBranch = async () => {
    if (!currentDb) return;
    const target = branchName.trim();
    if (!target) {
      flash('Informe o nome do novo branch');
      return;
    }
    setBranching(true);
    try {
      const sourceId = currentDb.id || currentDb.db_name || currentDb.name;
      await api.branchProject(sourceId, target);
      flash(`✓ Branch "${target}" criado com sucesso!`);
      await refreshProjects();
      await refreshRoles();
      await refreshActivity();
      await refreshGroupedProjects();
      setBranchModalOpen(false);
      setBranchName('');
      router.push(`/databases?selected=${encodeURIComponent(target)}`);
    } catch (err: any) {
      flash(`Falha no branch: ${err.message}`);
    } finally {
      setBranching(false);
    }
  };

  // Drop Database
  const handleDrop = async (db: ProjectData) => {
    const ok = await showConfirm({
      title: `Drop database "${db.name}"?`,
      description: `Esta ação excluirá permanentemente o banco de dados "${db.db_name || db.name}" e todas as roles associadas. Esta operação não pode ser desfeita.`,
    });
    if (!ok) return;

    try {
      await api.deleteProject(db.id || db.name);
      flash(`Banco ${db.name} excluído.`);
      await refreshProjects();
      await refreshRoles();
      await refreshActivity();
      await refreshGroupedProjects();
      router.push('/databases');
    } catch (err: any) {
      flash(`Drop failed: ${err.message}`);
    }
  };

  const [rotatingRole, setRotatingRole] = useState<string | null>(null);

  const handleRotateDbCredentials = async (role: 'admin' | 'readonly' | 'all') => {
    if (!currentDb) return;
    const targetName = currentDb.db_name || currentDb.name;
    const roleLabel = role === 'all' ? 'todas as roles (admin e read-only)' : `a role ${role}`;

    const ok = await showConfirm({
      title: `Rotacionar credenciais de ${targetName}?`,
      description: `Esta ação gerará uma nova senha segura para ${roleLabel} e desconectará imediatamente todas as conexões ativas associadas a ela no PostgreSQL.`,
      confirmText: 'Rotacionar Senha',
      variant: 'warning',
    });
    if (!ok) return;

    setRotatingRole(role);
    try {
      const res = await api.rotateProject(currentDb.id || currentDb.name, role, true);
      flash(`✓ Credenciais rotacionadas com sucesso! (${res.terminated_sessions} sessões ativas encerradas)`);
      await refreshProjects();
      await refreshRoles();
      await refreshActivity();
    } catch (err: any) {
      flash(`Falha ao rotacionar: ${err.message}`);
    } finally {
      setRotatingRole(null);
    }
  };

  const previewClean = newName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_') || 'app';
  const previewAdminRole = `app_${previewClean}_admin`;
  const previewRoRole = `app_${previewClean}_readonly`;

  return (
    <div className="flex flex-col gap-5 animate-vpsql-fade">
      {/* VIEW: DATABASES LIST */}
      {!currentDb && (
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-xl font-medium tracking-tight text-[#EDEDED] flex items-center gap-2">
                <Database className="w-5 h-5 text-[#4BFF8F]" />
                Bancos de Dados
              </h1>
              <p className="text-[13px] text-[#8A8A93] mt-0.5">
                Instâncias PostgreSQL isoladas provisionadas no host com roles e schemas segregados.
              </p>
            </div>
            <button
              onClick={() => {
                setNewName('');
                setCreateDbModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#4BFF8F] text-[#04140B] text-[12.5px] font-semibold hover:bg-[#8DFFBD] shadow-[0_0_20px_-5px_rgba(75,255,143,0.65)] transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Novo Banco
            </button>
          </div>

          {/* Stat Cards */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
            <div className="p-4 border border-white/[0.07] rounded-xl bg-white/[0.025] backdrop-blur-md">
              <div className="text-[11px] text-[#5A5A63] uppercase tracking-wider">Databases</div>
              <div className="font-mono text-[26px] font-medium mt-1.5">{String(databases.length).padStart(2, '0')}</div>
            </div>
            <div className="p-4 border border-white/[0.07] rounded-xl bg-white/[0.025] backdrop-blur-md">
              <div className="text-[11px] text-[#5A5A63] uppercase tracking-wider">Connections</div>
              <div className="font-mono text-[26px] font-medium mt-1.5">
                {nodeMetrics?.total_connections || '0/100'}
              </div>
            </div>
            <div className="p-4 border border-white/[0.07] rounded-xl bg-white/[0.025] backdrop-blur-md">
              <div className="text-[11px] text-[#5A5A63] uppercase tracking-wider">Disk usage</div>
              <div className="font-mono text-[26px] font-medium mt-1.5">
                {nodeMetrics?.total_disk || '—'}
              </div>
            </div>
            <div className="p-4 border border-white/[0.07] rounded-xl bg-white/[0.025] backdrop-blur-md">
              <div className="text-[11px] text-[#5A5A63] uppercase tracking-wider">p99 latency</div>
              <div className="font-mono text-[26px] font-medium mt-1.5 text-[#4BFF8F]">
                {nodeMetrics?.p99_latency || `${apiLatency} ms`}
              </div>
            </div>
          </div>

          {/* Databases Table */}
          <div className="border border-white/[0.07] rounded-xl bg-white/[0.022] backdrop-blur-md overflow-hidden">
            <div className="overflow-x-auto">
              <div className="grid grid-cols-[minmax(200px,2.2fr)_110px_100px_110px_minmax(120px,1fr)_88px] gap-3 px-4 py-2.5 border-b border-white/[0.06] text-[10.5px] uppercase tracking-widest text-[#4E4E57] min-w-[820px]">
                <span>Database</span>
                <span>Status</span>
                <span>Size</span>
                <span>Conns</span>
                <span>Owner role</span>
                <span>Created</span>
              </div>

              {loadingDbs && (
                <div className="p-8 text-center text-[#5A5A63] font-mono text-[12px]">
                  Carregando bancos de dados da API em tempo real…
                </div>
              )}

              {!loadingDbs && databases.length === 0 && (
                <div className="p-12 text-center flex flex-col items-center justify-center gap-3">
                  <span className="font-mono text-[14px] text-[#EDEDED]">Nenhum banco de dados provisionado ainda</span>
                  <span className="text-[12.5px] text-[#5A5A63] max-w-md">
                    Crie o seu primeiro banco isolado com roles de admin e read-only automáticas.
                  </span>
                  <button
                    onClick={() => setCreateDbModalOpen(true)}
                    className="mt-2 px-4 py-2 rounded-lg bg-[#4BFF8F] text-[#04140B] font-semibold text-[13px] hover:bg-[#8DFFBD] transition cursor-pointer"
                  >
                    + Provisionar Novo Banco
                  </button>
                </div>
              )}

              {!loadingDbs && databases.map((db, idx) => {
                const dot = getStatusDot(db.status);
                return (
                  <div
                    key={db.name + idx}
                    onClick={() => {
                      router.push(`/databases?selected=${encodeURIComponent(db.name)}`);
                    }}
                    className="grid grid-cols-[minmax(200px,2.2fr)_110px_100px_110px_minmax(120px,1fr)_88px] gap-3 px-4 py-3.5 border-b border-white/[0.045] items-center cursor-pointer hover:bg-white/[0.035] transition min-w-[820px]"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: dot, boxShadow: `0 0 7px ${dot}` }}></span>
                      <span className="font-mono text-[13px] truncate">{db.name}</span>
                      <span className="text-[10px] text-[#5A5A63] border border-white/[0.08] rounded px-1.5 py-0.5 flex-shrink-0">{db.project || 'default'}</span>
                    </div>
                    <span className="font-mono text-[11.5px]" style={{ color: dot }}>{db.status}</span>
                    <span className="font-mono text-[12px] text-[#8A8A93]">{db.size || '—'}</span>
                    <span className="font-mono text-[12px] text-[#8A8A93]">{db.conns || '0/100'}</span>
                    <span className="font-mono text-[12px] text-[#8A8A93] truncate">{db.owner || db.admin_role}</span>
                    <span className="font-mono text-[12px] text-[#5A5A63]">{db.created}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* VIEW: DATABASE DETAIL */}
      {currentDb && (
        <div className="flex flex-col gap-5 animate-vpsql-fade">
          {/* Detail Header */}
          <div className="flex items-start gap-4 flex-wrap">
            <button
              onClick={() => router.push('/databases')}
              className="px-2.5 py-1.5 border border-white/[0.08] rounded-lg text-[#8A8A93] hover:text-[#EDEDED] hover:border-white/20 font-mono text-[12px] transition cursor-pointer"
            >
              ←
            </button>
            <div className="flex flex-col gap-1.5 min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="font-mono text-[21px] font-medium tracking-tight">{currentDb.name}</h1>
                <span className="flex items-center gap-1.5 text-[11px] font-mono text-[#4BFF8F] border border-[#4BFF8F]/30 bg-[#4BFF8F]/[0.08] rounded px-2 py-0.5">
                  ● {currentDb.status}
                </span>
              </div>
              <div className="text-[12px] text-[#5A5A63]">
                banco <code>{currentDb.db_name || currentDb.name}</code> · workspace <code className="text-[#5B8CFF]">{currentDb.project || 'default'}</code> · owner {currentDb.owner || currentDb.admin_role} · criado {currentDb.created}
              </div>
            </div>

            <div className="ml-auto flex gap-2">
              <button
                onClick={() => { setBranchName(''); setBranchModalOpen(true); }}
                className="flex items-center gap-1.5 px-3 py-2 border border-[#5B8CFF]/35 rounded-lg bg-[#5B8CFF]/[0.07] hover:bg-[#5B8CFF]/[0.15] text-[#5B8CFF] text-[12.5px] font-medium transition cursor-pointer"
                title="Clone instantâneo via PostgreSQL WITH TEMPLATE"
              >
                <GitBranch className="w-3.5 h-3.5" />
                <span>Branch</span>
              </button>
              <button
                onClick={() => copyToClipboard(poolerAdminUri || directAdminUri, 'Admin connection string copied')}
                className="px-3 py-2 border border-[#4BFF8F]/35 rounded-lg bg-[#4BFF8F]/[0.07] hover:bg-[#4BFF8F]/[0.15] text-[#4BFF8F] text-[12.5px] font-medium transition cursor-pointer"
              >
                Copy URI
              </button>
              <button
                onClick={() => handleDrop(currentDb)}
                className="px-3 py-2 border border-white/[0.09] hover:border-red-500/40 hover:text-[#FF5C5C] rounded-lg text-[#8A8A93] text-[12.5px] transition cursor-pointer"
              >
                Drop
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-white/[0.07]">
            {(['overview', 'credentials', 'schema', 'logs'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3.5 py-2 text-[13px] capitalize transition border-b-2 -mb-px cursor-pointer ${
                  tab === t ? 'text-[#EDEDED] border-[#4BFF8F]' : 'text-[#5A5A63] border-transparent hover:text-[#8A8A93]'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* TAB 1: OVERVIEW */}
          {tab === 'overview' && (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-3.5 items-start">
              <div className="col-span-full grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
                <div className="p-3.5 border border-white/[0.07] rounded-xl bg-white/[0.025]">
                  <div className="text-[11px] text-[#5A5A63] uppercase tracking-wider">Size on disk</div>
                  <div className="font-mono text-[22px] mt-1.5">{currentDb.size || '—'}</div>
                </div>
                <div className="p-3.5 border border-white/[0.07] rounded-xl bg-white/[0.025]">
                  <div className="text-[11px] text-[#5A5A63] uppercase tracking-wider">Connections</div>
                  <div className="font-mono text-[22px] mt-1.5">{currentDb.conns || '0/100'}</div>
                </div>
                <div className="p-3.5 border border-white/[0.07] rounded-xl bg-white/[0.025]">
                  <div className="text-[11px] text-[#5A5A63] uppercase tracking-wider">Engine</div>
                  <div className="font-mono text-[22px] mt-1.5">{nodeMetrics?.postgres_version || 'pg16.14'}</div>
                </div>
                <div className="p-3.5 border border-white/[0.07] rounded-xl bg-white/[0.025]">
                  <div className="text-[11px] text-[#5A5A63] uppercase tracking-wider">Pooler</div>
                  <div className="font-mono text-[22px] mt-1.5 text-[#4BFF8F]">PgBouncer:6432</div>
                </div>
              </div>

              {/* Pooler Card */}
              <div className="p-4 border border-white/[0.07] rounded-xl bg-white/[0.022] backdrop-blur-md flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-semibold">PgBouncer Pooler Connection</span>
                  <span className="text-[10px] text-[#4BFF8F] border border-[#4BFF8F]/30 bg-[#4BFF8F]/10 rounded px-1.5 py-0.5">transaction mode</span>
                  <button
                    onClick={() => copyToClipboard(poolerAdminUri, 'Pooler URI copied')}
                    className="ml-auto px-2.5 py-1 border border-white/10 rounded-md text-[#8A8A93] hover:text-[#4BFF8F] hover:border-[#4BFF8F]/40 text-[11.5px] transition cursor-pointer"
                  >
                    Copy URI
                  </button>
                </div>
                <div className="flex items-center gap-2.5 p-2.5 border border-white/[0.07] rounded-lg bg-[#0C0C0F] overflow-hidden">
                  <span className="font-mono text-[11.5px] text-[#8DFFBD] truncate">{poolerAdminUri}</span>
                </div>
                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 font-mono text-[11.5px] text-[#8A8A93]">
                  <span className="text-[#4E4E57]">host</span><span>{currentHost}</span>
                  <span className="text-[#4E4E57]">port</span><span>6432</span>
                  <span className="text-[#4E4E57]">pool_mode</span><span>transaction</span>
                  <span className="text-[#4E4E57]">max_client_conn</span><span>1000</span>
                </div>
              </div>

              {/* Extensions Card */}
              <div className="p-4 border border-white/[0.07] rounded-xl bg-white/[0.022] backdrop-blur-md flex flex-col gap-3">
                <div className="text-[12px] font-semibold">Ativação de Extensões</div>
                <div className="flex flex-wrap gap-2">
                  {(currentDb.extensions || ['uuid-ossp', 'pgcrypto']).map(ext => (
                    <span key={ext} className="font-mono text-[11px] px-2 py-1 border border-[#4BFF8F]/30 bg-[#4BFF8F]/[0.07] text-[#4BFF8F] rounded-md">
                      {ext}
                    </span>
                  ))}
                </div>
                <div className="h-px bg-white/[0.06] my-1"></div>
                <div className="text-[12px] font-semibold">Isolamento de Segurança</div>
                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 font-mono text-[11.5px] text-[#8A8A93]">
                  <span className="text-[#4E4E57]">public_schema</span><span>REVOKED FROM PUBLIC</span>
                  <span className="text-[#4E4E57]">admin_role</span><span className="text-[#4BFF8F]">DATABASE OWNER</span>
                  <span className="text-[#4E4E57]">readonly_role</span><span className="text-[#5B8CFF]">SELECT ONLY</span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: CREDENTIALS */}
          {tab === 'credentials' && (
            <div className="flex flex-col gap-3.5">
              <div className="flex items-center justify-between p-3 rounded-xl border border-white/[0.08] bg-white/[0.02]">
                <div className="text-[12.5px] text-[#8A8A93]">
                  Credenciais seguras do PostgreSQL isoladas por banco. Suporte a rotação individual por role ou completa.
                </div>
                <button
                  onClick={() => handleRotateDbCredentials('all')}
                  disabled={rotatingRole !== null}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-[#FFB020]/35 bg-[#FFB020]/[0.08] hover:bg-[#FFB020]/[0.18] text-[#FFB020] text-[12px] font-medium rounded-lg transition cursor-pointer disabled:opacity-50"
                  title="Rotacionar senhas de Admin e Readonly simultaneamente"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${rotatingRole === 'all' ? 'animate-spin' : ''}`} />
                  <span>Rotacionar Ambas as Roles</span>
                </button>
              </div>

              <div className="p-4 border border-white/[0.07] rounded-xl bg-white/[0.022] backdrop-blur-md flex flex-col gap-3">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className="font-mono text-[13.5px]">{currentDb.admin_role || `${currentDb.name}_admin`}</span>
                  <span className="text-[10.5px] font-mono px-2 py-0.5 rounded border border-[#4BFF8F]/35 bg-[#4BFF8F]/[0.08] text-[#4BFF8F]">owner</span>
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      onClick={() => handleRotateDbCredentials('admin')}
                      disabled={rotatingRole !== null}
                      className="flex items-center gap-1 px-2.5 py-1.5 border border-[#FFB020]/30 bg-[#FFB020]/[0.08] hover:bg-[#FFB020]/[0.18] text-[#FFB020] text-[12px] rounded-md transition cursor-pointer disabled:opacity-50"
                      title="Gera nova senha para o admin e derruba conexões ativas"
                    >
                      <RefreshCw className={`w-3 h-3 ${rotatingRole === 'admin' ? 'animate-spin' : ''}`} />
                      <span>Rotacionar Senha</span>
                    </button>
                    <button
                      onClick={() => copyToClipboard(poolerAdminUri, 'Admin URI copied')}
                      className="px-2.5 py-1.5 border border-white/10 rounded-md text-[#8A8A93] hover:text-[#4BFF8F] hover:border-[#4BFF8F]/40 text-[12px] transition cursor-pointer"
                    >
                      Copy URI
                    </button>
                  </div>
                </div>
                <div className="p-2.5 border border-white/[0.07] rounded-lg bg-[#0C0C0F] overflow-x-auto">
                  <span className="font-mono text-[11.5px] text-[#8DFFBD] whitespace-nowrap">{poolerAdminUri}</span>
                </div>
                <div className="flex gap-4 flex-wrap font-mono text-[11.5px] text-[#8A8A93]">
                  <span><span className="text-[#4E4E57]">user </span>{currentDb.admin_role}</span>
                  <span><span className="text-[#4E4E57]">password </span>{currentDb.admin_password || '••••••••••••'}</span>
                </div>
              </div>

              <div className="p-4 border border-white/[0.07] rounded-xl bg-white/[0.022] backdrop-blur-md flex flex-col gap-3">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className="font-mono text-[13.5px]">{currentDb.readonly_role || `${currentDb.name}_readonly`}</span>
                  <span className="text-[10.5px] font-mono px-2 py-0.5 rounded border border-[#5B8CFF]/35 bg-[#5B8CFF]/[0.08] text-[#5B8CFF]">read-only</span>
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      onClick={() => handleRotateDbCredentials('readonly')}
                      disabled={rotatingRole !== null}
                      className="flex items-center gap-1 px-2.5 py-1.5 border border-[#FFB020]/30 bg-[#FFB020]/[0.08] hover:bg-[#FFB020]/[0.18] text-[#FFB020] text-[12px] rounded-md transition cursor-pointer disabled:opacity-50"
                      title="Gera nova senha para o read-only e derruba conexões ativas"
                    >
                      <RefreshCw className={`w-3 h-3 ${rotatingRole === 'readonly' ? 'animate-spin' : ''}`} />
                      <span>Rotacionar Senha</span>
                    </button>
                    <button
                      onClick={() => copyToClipboard(poolerRoUri, 'Read-only URI copied')}
                      className="px-2.5 py-1.5 border border-white/10 rounded-md text-[#8A8A93] hover:text-[#4BFF8F] hover:border-[#4BFF8F]/40 text-[12px] transition cursor-pointer"
                    >
                      Copy URI
                    </button>
                  </div>
                </div>
                <div className="p-2.5 border border-white/[0.07] rounded-lg bg-[#0C0C0F] overflow-x-auto">
                  <span className="font-mono text-[11.5px] text-[#8DFFBD] whitespace-nowrap">{poolerRoUri}</span>
                </div>
                <div className="flex gap-4 flex-wrap font-mono text-[11.5px] text-[#8A8A93]">
                  <span><span className="text-[#4E4E57]">user </span>{currentDb.readonly_role}</span>
                  <span><span className="text-[#4E4E57]">password </span>{currentDb.readonly_password || '••••••••••••'}</span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: SCHEMA & QUERY */}
          {tab === 'schema' && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3 px-4 py-3 border border-white/[0.06] rounded-xl bg-white/[0.015] flex-wrap">
                <span className="font-mono text-[12px] text-[#4BFF8F]">$</span>
                <span className="font-mono text-[12px] text-[#8A8A93]">vpsql schema pull {currentDb.name}</span>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={() => { setTypesModalTable('all'); setTypesModalOpen(true); }}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#3178C6]/35 bg-[#3178C6]/15 hover:bg-[#3178C6]/25 text-[#85B7EB] text-[11px] font-mono transition cursor-pointer"
                  >
                    <Code2 className="w-3.5 h-3.5" />
                    <span>TypeScript Types</span>
                  </button>
                  <button
                    onClick={() => refreshSchema(currentDb.db_name || currentDb.name)}
                    className="text-[11px] font-mono text-[#4BFF8F] hover:underline cursor-pointer"
                  >
                    {loadingSchema ? 'Inspecionando…' : '↻ Recarregar Schema'}
                  </button>
                </div>
              </div>

              {/* Interactive SQL Runner */}
              <SqlEditor
                value={customSQL}
                onChange={setCustomSQL}
                onExecute={() => handleExecuteQuery(customSQL)}
                tables={tables}
                running={queryRunning}
              />

              {/* Tables Explorer */}
              <div className="border border-white/[0.07] rounded-xl bg-white/[0.022] overflow-hidden">
                <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
                  <span className="font-semibold text-[13px] text-[#EDEDED] font-mono">Tabelas ({tables.length})</span>
                </div>
                <div className="p-4 flex flex-col gap-3">
                  {tables.length === 0 ? (
                    <div className="p-6 text-center font-mono text-[12px] text-[#5A5A63]">Nenhuma tabela criada ainda.</div>
                  ) : (
                    tables.map(tbl => (
                      <div key={tbl.name} className="p-3 rounded-lg border border-white/[0.06] bg-[#0C0C0F] flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[13px] font-medium text-[#EDEDED]">{tbl.name}</span>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => { setActiveBrowserTable(tbl.name); setDataBrowserOpen(true); }}
                              className="px-2 py-0.5 rounded text-[11px] font-mono bg-white/[0.05] hover:bg-white/10 text-[#8A8A93] hover:text-white transition cursor-pointer"
                            >
                              Ver Dados
                            </button>
                            <button
                              onClick={() => { setTypesModalTable(tbl.name); setTypesModalOpen(true); }}
                              className="px-2 py-0.5 rounded text-[11px] font-mono bg-[#3178C6]/15 hover:bg-[#3178C6]/25 text-[#85B7EB] transition cursor-pointer"
                            >
                              .d.ts
                            </button>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {tbl.cols?.map(col => (
                            <span key={col.name} className="px-2 py-0.5 rounded text-[10.5px] font-mono bg-white/[0.03] border border-white/5 text-[#8A8A93]">
                              {col.name}: <span className="text-[#5B8CFF]">{col.type}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: LOGS */}
          {tab === 'logs' && (
            <div className="p-4 border border-white/[0.07] rounded-xl bg-white/[0.022] font-mono text-[12px] text-[#8A8A93]">
              Postgres activity logs live stream.
            </div>
          )}
        </div>
      )}

      {/* MODAL: PROVISION DATABASE */}
      {createDbModalOpen && (
        <div
          onClick={() => setCreateDbModalOpen(false)}
          className="fixed inset-0 z-50 bg-[#040406]/70 backdrop-blur-sm flex items-start justify-center pt-[9vh] px-5 animate-vpsql-fade"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-[540px] border border-white/10 rounded-2xl bg-[#121216]/95 backdrop-blur-2xl shadow-[0_0_60px_-20px_rgba(75,255,143,0.35)] overflow-hidden animate-vpsql-fade"
          >
            <div className="px-5 py-4 border-b border-white/[0.07] flex items-center gap-2.5">
              <span className="text-[14px] font-semibold">Provision database</span>
              <span className="font-mono text-[11px] text-[#4E4E57]">POST /v1/projects</span>
              <button
                type="button"
                onClick={() => setCreateDbModalOpen(false)}
                className="ml-auto text-[#5A5A63] hover:text-[#EDEDED] font-mono text-[13px] cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-5 flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] uppercase tracking-wider text-[#5A5A63]">Database name</span>
                <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="ex: billing_service"
                  autoFocus
                  className="p-2.5 border border-white/10 rounded-lg bg-[#0C0C0F] text-[#EDEDED] font-mono text-[13px] outline-none focus:border-[#4BFF8F]/60 focus:ring-2 focus:ring-[#4BFF8F]/10"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] uppercase tracking-wider text-[#5A5A63]">Workspace / Project Tag</span>
                <input
                  value={selectedProjectForNewDb}
                  onChange={e => setSelectedProjectForNewDb(e.target.value)}
                  placeholder="default"
                  className="p-2.5 border border-white/10 rounded-lg bg-[#0C0C0F] text-[#EDEDED] font-mono text-[13px] outline-none focus:border-[#4BFF8F]/60"
                />
              </label>

              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] uppercase tracking-wider text-[#5A5A63]">Extensions</span>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_EXTS.map(ext => {
                    const active = selectedExts.includes(ext);
                    return (
                      <button
                        key={ext}
                        type="button"
                        onClick={() => setSelectedExts(prev => active ? prev.filter(x => x !== ext) : [...prev, ext])}
                        className={`px-2.5 py-1.5 rounded-lg font-mono text-[11.5px] transition cursor-pointer ${
                          active
                            ? 'border border-[#4BFF8F]/50 bg-[#4BFF8F]/10 text-[#4BFF8F]'
                            : 'border border-white/10 text-[#8A8A93] hover:text-[#EDEDED]'
                        }`}
                      >
                        {ext}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-2 p-3 border border-white/[0.07] rounded-xl bg-white/[0.02]">
                <span className="text-[11px] uppercase tracking-wider text-[#5A5A63]">Roles geradas automaticamente</span>
                <div className="flex gap-2.5 font-mono text-[11.5px]">
                  <span className="text-[#4BFF8F]">{previewAdminRole}</span>
                  <span className="text-[#4E4E57]">owner · CRUD + DDL</span>
                </div>
                <div className="flex gap-2.5 font-mono text-[11.5px]">
                  <span className="text-[#5B8CFF]">{previewRoRole}</span>
                  <span className="text-[#4E4E57]">read-only · SELECT on public</span>
                </div>
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-white/[0.07] flex items-center gap-2.5">
              <span className="text-[11.5px] text-[#4E4E57]">~1.2s para provisionar</span>
              <button
                type="button"
                onClick={() => setCreateDbModalOpen(false)}
                className="ml-auto px-3.5 py-2 border border-white/10 rounded-lg text-[#8A8A93] hover:text-[#EDEDED] text-[12.5px] transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleProvision}
                disabled={provisioning}
                className="px-4 py-2 rounded-lg bg-[#4BFF8F] text-[#04140B] text-[12.5px] font-semibold hover:bg-[#8DFFBD] shadow-[0_0_22px_-6px_rgba(75,255,143,0.7)] transition disabled:opacity-50 cursor-pointer"
              >
                {provisioning ? 'Provisionando…' : 'Provision'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DATABASE BRANCH MODAL */}
      {branchModalOpen && currentDb && (
        <div
          onClick={() => setBranchModalOpen(false)}
          className="fixed inset-0 z-50 bg-[#040406]/75 backdrop-blur-sm flex items-center justify-center p-5 animate-vpsql-fade"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-[500px] border border-white/10 rounded-2xl bg-[#0C0C0F] shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-white/[0.02]">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-[#5B8CFF]/15 border border-[#5B8CFF]/30 text-[#5B8CFF]">
                  <GitBranch className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-[15px] font-semibold text-[#EDEDED]">Branch Database</h2>
                  <p className="text-[11.5px] text-[#8A8A93] font-mono">Clone instantâneo via PostgreSQL TEMPLATE</p>
                </div>
              </div>
              <button
                onClick={() => setBranchModalOpen(false)}
                className="p-1.5 rounded-lg text-[#8A8A93] hover:text-[#EDEDED] hover:bg-white/10 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 flex flex-col gap-4">
              <div className="p-3 rounded-lg bg-[#5B8CFF]/10 border border-[#5B8CFF]/20 text-[11.5px] text-[#85B7EB] leading-relaxed">
                Cria uma cópia isolada de <strong>{currentDb.db_name || currentDb.name}</strong> contendo todas as tabelas, índices e dados atuais.
              </div>

              <div>
                <label className="block font-mono text-[11.5px] uppercase tracking-wider text-[#8A8A93] mb-1.5">
                  Nome do novo branch
                </label>
                <input
                  type="text"
                  value={branchName}
                  onChange={e => setBranchName(e.target.value)}
                  placeholder="ex: staging, dev_feature_x"
                  autoFocus
                  className="w-full bg-[#050507] border border-white/10 rounded-lg px-3.5 py-2.5 font-mono text-[13px] text-[#EDEDED] placeholder-[#4E4E57] outline-none focus:border-[#5B8CFF]/60"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setBranchModalOpen(false)}
                  className="px-4 py-2 border border-white/10 rounded-lg text-[#8A8A93] hover:text-[#EDEDED] text-[12.5px] transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleBranch}
                  disabled={branching || !branchName.trim()}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#5B8CFF] hover:bg-[#4677EC] text-white text-[12.5px] font-semibold transition disabled:opacity-50 cursor-pointer shadow-[0_0_20px_-6px_rgba(91,140,255,0.7)]"
                >
                  {branching ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <GitBranch className="w-3.5 h-3.5" />}
                  <span>{branching ? 'Clonando banco…' : 'Criar Branch'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TYPES MODAL */}
      {currentDb && (
        <TypesModal
          isOpen={typesModalOpen}
          onClose={() => setTypesModalOpen(false)}
          tables={tables}
          databaseName={currentDb.db_name || currentDb.name}
          initialTable={typesModalTable}
        />
      )}

      {/* DATA BROWSER MODAL */}
      {currentDb && (
        <DataBrowserModal
          isOpen={dataBrowserOpen}
          onClose={() => setDataBrowserOpen(false)}
          tableName={activeBrowserTable}
          databaseName={currentDb.db_name || currentDb.name}
          tableSchema={tables.find(t => t.name === activeBrowserTable)}
          onExecuteQuery={sql => api.executeQuery(currentDb.db_name || currentDb.name, sql)}
        />
      )}
    </div>
  );
}

export default function DatabasesPage() {
  return (
    <Suspense fallback={
      <div className="p-12 text-center text-[#5A5A63] font-mono text-[12px] flex items-center justify-center gap-2">
        <RefreshCw className="w-4 h-4 animate-spin text-[#4BFF8F]" />
        Carregando bancos de dados...
      </div>
    }>
      <DatabasesContent />
    </Suspense>
  );
}
