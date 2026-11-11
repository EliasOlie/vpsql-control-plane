'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Users, 
  ShieldCheck, 
  Plus, 
  Trash2, 
  Building2, 
  KeyRound, 
  Check, 
  Copy, 
  AlertCircle, 
  RefreshCw, 
  X,
  Lock,
  Mail,
  ExternalLink,
  Code2
} from 'lucide-react';
import { getApiBaseUrl } from '@/lib/api';

export interface TenantData {
  id: string;
  name: string;
  status: string;
  user_count?: number;
  created_at: string;
  updated_at: string;
}

export interface UserData {
  id: string;
  tenant_id: string;
  email: string;
  roles: string[];
  permissions: string[];
  is_active: boolean;
  created_at: string;
}

interface ClientsAuthViewProps {
  flash: (msg: string) => void;
  showConfirm: (opts: any) => Promise<boolean>;
}

export default function ClientsAuthView({ flash, showConfirm }: ClientsAuthViewProps) {
  const [activeTab, setActiveTab] = useState<'users' | 'tenants' | 'integration'>('users');
  
  // Data states
  const [tenants, setTenants] = useState<TenantData[]>([]);
  const [users, setUsers] = useState<UserData[]>([]);
  const [loadingTenants, setLoadingTenants] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [filterTenant, setFilterTenant] = useState<string>('');

  // Modals
  const [createTenantOpen, setCreateTenantOpen] = useState(false);
  const [newTenantId, setNewTenantId] = useState('');
  const [newTenantName, setNewTenantName] = useState('');
  const [creatingTenant, setCreatingTenant] = useState(false);

  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserTenant, setNewUserTenant] = useState('default');
  const [newUserRole, setNewUserRole] = useState<'admin' | 'operator' | 'user' | 'viewer'>('user');
  const [creatingUser, setCreatingUser] = useState(false);

  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const getHeaders = () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('vpsql_token') || '' : '';
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
  };

  // Fetch Tenants
  const fetchTenants = useCallback(async () => {
    setLoadingTenants(true);
    try {
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/v1/auth/tenants`, { credentials: 'omit', headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setTenants(data.tenants || []);
      }
    } catch {
      // Falha silenciosa ou endpoint iniciando
    } finally {
      setLoadingTenants(false);
    }
  }, []);

  // Fetch Users
  const fetchUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const base = getApiBaseUrl();
      const url = filterTenant 
        ? `${base}/v1/auth/users?tenant_id=${encodeURIComponent(filterTenant)}`
        : `${base}/v1/auth/users`;
      const res = await fetch(url, { credentials: 'omit', headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch {
      // Falha silenciosa
    } finally {
      setLoadingUsers(false);
    }
  }, [filterTenant]);

  useEffect(() => {
    fetchTenants();
    fetchUsers();
  }, [fetchTenants, fetchUsers]);

  // Handle Create Tenant
  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTenantId.trim() || !newTenantName.trim()) {
      flash('ID/Slug e Nome do cliente são obrigatórios');
      return;
    }
    setCreatingTenant(true);
    try {
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/v1/auth/tenants`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          id: newTenantId.toLowerCase().trim(),
          name: newTenantName.trim()
        })
      });
      if (res.ok) {
        flash(`Cliente "${newTenantName}" cadastrado com sucesso!`);
        setCreateTenantOpen(false);
        setNewTenantId('');
        setNewTenantName('');
        fetchTenants();
      } else {
        const err = await res.json();
        flash(`Erro: ${err.error || 'Falha ao criar cliente'}`);
      }
    } catch (e: any) {
      flash(`Erro de conexão: ${e.message}`);
    } finally {
      setCreatingTenant(false);
    }
  };

  // Handle Create User
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserEmail.trim() || !newUserPassword.trim()) {
      flash('Email e Senha são obrigatórios');
      return;
    }
    if (newUserPassword.length < 6) {
      flash('A senha deve ter no mínimo 6 caracteres');
      return;
    }
    setCreatingUser(true);
    try {
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/v1/auth/users`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          tenant_id: newUserTenant,
          email: newUserEmail.trim(),
          password: newUserPassword,
          roles: [newUserRole]
        })
      });
      if (res.ok) {
        flash(`Acesso criado com sucesso para ${newUserEmail}!`);
        setCreateUserOpen(false);
        setNewUserEmail('');
        setNewUserPassword('');
        fetchUsers();
        fetchTenants();
      } else {
        const err = await res.json();
        flash(`Erro: ${err.error || 'Falha ao criar usuário'}`);
      }
    } catch (e: any) {
      flash(`Erro de conexão: ${e.message}`);
    } finally {
      setCreatingUser(false);
    }
  };

  // Toggle User Active
  const handleToggleUser = async (u: UserData) => {
    try {
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/v1/auth/users/${u.id}/toggle`, {
        method: 'PATCH',
        headers: getHeaders()
      });
      if (res.ok) {
        flash(`Status do usuário ${u.email} alterado!`);
        fetchUsers();
      }
    } catch (e: any) {
      flash(`Erro ao alterar status: ${e.message}`);
    }
  };

  // Delete User
  const handleDeleteUser = async (u: UserData) => {
    const confirmed = await showConfirm({
      title: 'Excluir Acesso',
      message: `Tem certeza que deseja remover o usuário ${u.email}? O cliente perderá o acesso imediatamente.`,
      confirmText: 'Sim, excluir',
      danger: true
    });
    if (!confirmed) return;

    try {
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/v1/auth/users/${u.id}`, {
        method: 'DELETE',
        headers: getHeaders()
      });
      if (res.ok) {
        flash(`Usuário ${u.email} removido!`);
        fetchUsers();
        fetchTenants();
      }
    } catch (e: any) {
      flash(`Erro ao excluir: ${e.message}`);
    }
  };

  return (
    <div className="flex flex-col gap-5 animate-vpsql-fade">
      {/* HEADER HERO */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-r from-[#121217] via-[#0E0E12] to-[#0A0A0D] border border-white/[0.08] shadow-xl">
        <div className="flex items-start gap-3.5">
          <div className="p-2.5 rounded-xl bg-[#5B8CFF]/15 border border-[#5B8CFF]/30 text-[#5B8CFF] mt-0.5">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[17px] font-semibold text-[#EDEDED]">Clientes &amp; Identidade Central</h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-[#5B8CFF]/15 text-[#5B8CFF] border border-[#5B8CFF]/30">
                Auth Service (Ed25519)
              </span>
            </div>
            <p className="text-[12px] text-[#8A8A93] mt-0.5">
              Unifique o cadastro de clientes, tenants e credenciais de acesso para todos os seus projetos e aplicações.
            </p>
          </div>
        </div>

        {/* ACTIONS */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => {
              fetchTenants();
              fetchUsers();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-[#8A8A93] hover:text-[#EDEDED] text-[12px] font-mono transition cursor-pointer"
            title="Atualizar lista"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${(loadingTenants || loadingUsers) ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </button>

          <button
            onClick={() => setCreateTenantOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-[#EDEDED] text-[12px] font-mono transition cursor-pointer"
          >
            <Building2 className="w-3.5 h-3.5 text-[#5B8CFF]" />
            <span>+ Novo Cliente</span>
          </button>

          <button
            onClick={() => {
              if (tenants.length > 0) {
                setNewUserTenant(tenants[0].id);
              }
              setCreateUserOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#5B8CFF] hover:bg-[#4a7ae8] text-white text-[12.5px] font-semibold transition cursor-pointer shadow-lg shadow-[#5B8CFF]/20"
          >
            <Plus className="w-4 h-4" />
            <span>Criar Acesso / Usuário</span>
          </button>
        </div>
      </div>

      {/* TABS NAVIGATION */}
      <div className="flex items-center gap-2 border-b border-white/[0.08] pb-1">
        <button
          onClick={() => setActiveTab('users')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-t-lg text-[12.5px] font-medium transition cursor-pointer border-b-2 ${
            activeTab === 'users'
              ? 'border-[#5B8CFF] text-[#EDEDED] bg-white/[0.03]'
              : 'border-transparent text-[#8A8A93] hover:text-[#EDEDED]'
          }`}
        >
          <KeyRound className="w-4 h-4 text-[#5B8CFF]" />
          <span>Usuários &amp; Acessos ({users.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('tenants')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-t-lg text-[12.5px] font-medium transition cursor-pointer border-b-2 ${
            activeTab === 'tenants'
              ? 'border-[#5B8CFF] text-[#EDEDED] bg-white/[0.03]'
              : 'border-transparent text-[#8A8A93] hover:text-[#EDEDED]'
          }`}
        >
          <Building2 className="w-4 h-4 text-[#C77DFF]" />
          <span>Clientes / Tenants ({tenants.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('integration')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-t-lg text-[12.5px] font-medium transition cursor-pointer border-b-2 ${
            activeTab === 'integration'
              ? 'border-[#5B8CFF] text-[#EDEDED] bg-white/[0.03]'
              : 'border-transparent text-[#8A8A93] hover:text-[#EDEDED]'
          }`}
        >
          <Code2 className="w-4 h-4 text-[#4BFF8F]" />
          <span>SDK &amp; Guia de Login</span>
        </button>
      </div>

      {/* TAB 1: USERS LIST */}
      {activeTab === 'users' && (
        <div className="flex flex-col gap-3">
          {/* FILTER BAR */}
          <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[#09090B] border border-white/[0.08]">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-mono text-[#8A8A93]">Filtrar por Cliente:</span>
              <select
                value={filterTenant}
                onChange={e => setFilterTenant(e.target.value)}
                className="px-2.5 py-1 rounded-lg bg-[#121217] border border-white/10 text-[#EDEDED] text-[12px] font-mono outline-none focus:border-[#5B8CFF]"
              >
                <option value="">Todos os Clientes ({users.length} usuários)</option>
                {tenants.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.id})
                  </option>
                ))}
              </select>
            </div>

            <span className="text-[11.5px] font-mono text-[#5A5A63]">
              Autenticação global via Ed25519 JWT
            </span>
          </div>

          <div className="border border-white/[0.08] rounded-xl bg-[#09090B] overflow-hidden">
            {loadingUsers && users.length === 0 ? (
              <div className="p-8 text-center text-[#5A5A63] font-mono text-[12px]">
                Carregando usuários do Auth Service...
              </div>
            ) : users.length === 0 ? (
              <div className="p-12 text-center flex flex-col items-center justify-center gap-2">
                <ShieldCheck className="w-8 h-8 text-[#5A5A63]" />
                <p className="text-[13px] text-[#EDEDED] font-medium">Nenhum acesso cadastrado ainda</p>
                <p className="text-[12px] text-[#8A8A93] max-w-sm">
                  Crie o primeiro usuário para permitir que seu cliente faça login em suas aplicações.
                </p>
                <button
                  onClick={() => setCreateUserOpen(true)}
                  className="mt-2 px-3 py-1.5 rounded-lg bg-white/[0.05] border border-white/10 text-[#5B8CFF] hover:text-white text-[12px] font-mono transition cursor-pointer"
                >
                  + Criar primeiro usuário
                </button>
              </div>
            ) : (
              <table className="w-full text-left font-mono text-[11.5px]">
                <thead className="bg-[#0C0C0F] border-b border-white/10 text-[#8A8A93]">
                  <tr>
                    <th className="px-4 py-2.5">Email / Login</th>
                    <th className="px-4 py-2.5">Cliente / Tenant</th>
                    <th className="px-4 py-2.5">Perfil (Role)</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Criado em</th>
                    <th className="px-4 py-2.5 text-center">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                      <td className="px-4 py-2 text-[#EDEDED] font-semibold flex items-center gap-2">
                        <Mail className="w-3.5 h-3.5 text-[#5B8CFF]" />
                        <span>{u.email}</span>
                      </td>
                      <td className="px-4 py-2">
                        <span className="px-2 py-0.5 rounded text-[10.5px] bg-white/[0.05] text-[#C77DFF] border border-white/10">
                          {u.tenant_id}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1">
                          {u.roles.map(r => (
                            <span 
                              key={r} 
                              className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold ${
                                r === 'admin' 
                                  ? 'bg-[#FFB020]/15 text-[#FFB020] border border-[#FFB020]/30'
                                  : r === 'operator'
                                  ? 'bg-[#5B8CFF]/15 text-[#5B8CFF] border border-[#5B8CFF]/30'
                                  : 'bg-white/[0.05] text-[#8A8A93]'
                              }`}
                            >
                              {r}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10.5px] font-medium ${
                          u.is_active
                            ? 'text-[#4BFF8F] bg-[#4BFF8F]/10'
                            : 'text-[#FF5C5C] bg-[#FF5C5C]/10'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${u.is_active ? 'bg-[#4BFF8F]' : 'bg-[#FF5C5C]'}`} />
                          {u.is_active ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-[#8A8A93]">
                        {new Date(u.created_at).toLocaleDateString('pt-BR')}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => handleToggleUser(u)}
                            className="p-1 rounded hover:bg-white/10 text-[#8A8A93] hover:text-[#EDEDED] transition cursor-pointer"
                            title={u.is_active ? 'Suspender usuário' : 'Ativar usuário'}
                          >
                            <Lock className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteUser(u)}
                            className="p-1 rounded hover:bg-red-500/10 text-[#8A8A93] hover:text-red-400 transition cursor-pointer"
                            title="Remover acesso"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: TENANTS LIST */}
      {activeTab === 'tenants' && (
        <div className="border border-white/[0.08] rounded-xl bg-[#09090B] overflow-hidden">
          {loadingTenants && tenants.length === 0 ? (
            <div className="p-8 text-center text-[#5A5A63] font-mono text-[12px]">
              Carregando clientes...
            </div>
          ) : tenants.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-[13px] text-[#EDEDED]">Nenhum cliente cadastrado</p>
            </div>
          ) : (
            <table className="w-full text-left font-mono text-[11.5px]">
              <thead className="bg-[#0C0C0F] border-b border-white/10 text-[#8A8A93]">
                <tr>
                  <th className="px-4 py-2.5">ID / Slug do Tenant</th>
                  <th className="px-4 py-2.5">Nome da Empresa / Cliente</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Usuários Vinculados</th>
                  <th className="px-4 py-2.5">Data de Criação</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map(t => (
                  <tr key={t.id} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                    <td className="px-4 py-2 text-[#EDEDED] font-semibold flex items-center gap-2">
                      <Building2 className="w-3.5 h-3.5 text-[#C77DFF]" />
                      <span>{t.id}</span>
                    </td>
                    <td className="px-4 py-2 text-[#EDEDED]">
                      {t.name}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10.5px] font-medium ${
                        t.status === 'active'
                          ? 'text-[#4BFF8F] bg-[#4BFF8F]/10'
                          : 'text-[#FF5C5C] bg-[#FF5C5C]/10'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${t.status === 'active' ? 'bg-[#4BFF8F]' : 'bg-[#FF5C5C]'}`} />
                        {t.status === 'active' ? 'Ativo' : 'Suspenso'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-[#5B8CFF]">
                      {t.user_count || 0} usuário(s)
                    </td>
                    <td className="px-4 py-2 text-[#8A8A93]">
                      {new Date(t.created_at).toLocaleDateString('pt-BR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* TAB 3: INTEGRATION SDK */}
      {activeTab === 'integration' && (
        <div className="flex flex-col gap-4">
          <div className="p-4 rounded-xl bg-[#09090B] border border-white/[0.08] flex flex-col gap-3">
            <h3 className="text-[14px] font-semibold text-[#EDEDED] flex items-center gap-2">
              <Code2 className="w-4 h-4 text-[#4BFF8F]" />
              Como autenticar qualquer aplicação de cliente via Auth Service
            </h3>
            <p className="text-[12px] text-[#8A8A93]">
              Suas aplicações frontend (React, Next.js, Mobile) ou APIs de clientes podem realizar login chamando o endpoint público do Auth Service:
            </p>

            <div className="p-3.5 rounded-lg bg-[#050507] border border-white/10 font-mono text-[12px] overflow-x-auto text-[#EDEDED]">
              <pre>{`// Exemplo de Login em React / Next.js
async function loginCliente(email, password) {
  const res = await fetch('https://auth.example.com/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  
  if (!res.ok) {
    throw new Error('Credenciais inválidas');
  }
  
  const { token, user } = await res.json();
  console.log('Logado com sucesso!', user.tenant_id, user.roles);
  
  // Salve o token Bearer para requisições subsequentes
  localStorage.setItem('auth_token', token);
  return { token, user };
}`}</pre>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CREATE TENANT */}
      {createTenantOpen && (
        <div 
          onClick={() => setCreateTenantOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
        >
          <div 
            onClick={e => e.stopPropagation()}
            className="w-full max-w-[460px] border border-white/10 rounded-2xl bg-[#0C0C0F] shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08]">
              <div className="flex items-center gap-2.5">
                <Building2 className="w-5 h-5 text-[#C77DFF]" />
                <h2 className="text-[15px] font-semibold text-[#EDEDED]">Novo Cliente / Tenant</h2>
              </div>
              <button onClick={() => setCreateTenantOpen(false)} className="text-[#8A8A93] hover:text-[#EDEDED]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateTenant} className="p-6 flex flex-col gap-4">
              <div>
                <label className="block font-mono text-[11px] uppercase tracking-wider text-[#8A8A93] mb-1">
                  ID / Slug do Tenant (sem espaços)
                </label>
                <input
                  type="text"
                  value={newTenantId}
                  onChange={e => setNewTenantId(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                  placeholder="ex: cliente_alpha, aderson, gestor"
                  required
                  autoFocus
                  className="w-full px-3.5 py-2 rounded-lg bg-[#121217] border border-white/15 text-[#EDEDED] font-mono text-[12.5px] outline-none focus:border-[#C77DFF] transition"
                />
              </div>

              <div>
                <label className="block font-mono text-[11px] uppercase tracking-wider text-[#8A8A93] mb-1">
                  Nome da Empresa / Cliente
                </label>
                <input
                  type="text"
                  value={newTenantName}
                  onChange={e => setNewTenantName(e.target.value)}
                  placeholder="ex: Grupo Alpha Distribuidora"
                  required
                  className="w-full px-3.5 py-2 rounded-lg bg-[#121217] border border-white/15 text-[#EDEDED] font-mono text-[12.5px] outline-none focus:border-[#C77DFF] transition"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateTenantOpen(false)}
                  className="px-3.5 py-1.5 rounded-lg border border-white/10 text-[#8A8A93] hover:text-[#EDEDED] text-[12px] font-mono"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creatingTenant}
                  className="px-4 py-1.5 rounded-lg bg-[#C77DFF] hover:bg-[#b86df0] text-black text-[12px] font-mono font-semibold"
                >
                  {creatingTenant ? 'Cadastrando...' : 'Cadastrar Cliente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CREATE USER */}
      {createUserOpen && (
        <div 
          onClick={() => setCreateUserOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
        >
          <div 
            onClick={e => e.stopPropagation()}
            className="w-full max-w-[480px] border border-white/10 rounded-2xl bg-[#0C0C0F] shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08]">
              <div className="flex items-center gap-2.5">
                <KeyRound className="w-5 h-5 text-[#5B8CFF]" />
                <h2 className="text-[15px] font-semibold text-[#EDEDED]">Criar Acesso / Usuário</h2>
              </div>
              <button onClick={() => setCreateUserOpen(false)} className="text-[#8A8A93] hover:text-[#EDEDED]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="p-6 flex flex-col gap-4">
              <div>
                <label className="block font-mono text-[11px] uppercase tracking-wider text-[#8A8A93] mb-1">
                  Cliente / Tenant
                </label>
                <select
                  value={newUserTenant}
                  onChange={e => setNewUserTenant(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg bg-[#121217] border border-white/15 text-[#EDEDED] font-mono text-[12.5px] outline-none focus:border-[#5B8CFF] transition"
                >
                  {tenants.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.id})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-mono text-[11px] uppercase tracking-wider text-[#8A8A93] mb-1">
                  Email de Acesso
                </label>
                <input
                  type="email"
                  value={newUserEmail}
                  onChange={e => setNewUserEmail(e.target.value)}
                  placeholder="usuario@cliente.com.br"
                  required
                  autoFocus
                  className="w-full px-3.5 py-2 rounded-lg bg-[#121217] border border-white/15 text-[#EDEDED] font-mono text-[12.5px] outline-none focus:border-[#5B8CFF] transition"
                />
              </div>

              <div>
                <label className="block font-mono text-[11px] uppercase tracking-wider text-[#8A8A93] mb-1">
                  Senha Inicial (mínimo 6 caracteres)
                </label>
                <input
                  type="password"
                  value={newUserPassword}
                  onChange={e => setNewUserPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  minLength={6}
                  className="w-full px-3.5 py-2 rounded-lg bg-[#121217] border border-white/15 text-[#EDEDED] font-mono text-[12.5px] outline-none focus:border-[#5B8CFF] transition"
                />
              </div>

              <div>
                <label className="block font-mono text-[11px] uppercase tracking-wider text-[#8A8A93] mb-1.5">
                  Perfil de Acesso (Role)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['admin', 'operator', 'user', 'viewer'] as const).map(role => (
                    <label 
                      key={role}
                      className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition select-none font-mono text-[11.5px] ${
                        newUserRole === role 
                          ? 'border-[#5B8CFF] bg-[#5B8CFF]/10 text-[#EDEDED]' 
                          : 'border-white/10 bg-white/[0.02] text-[#8A8A93]'
                      }`}
                    >
                      <input
                        type="radio"
                        name="userRole"
                        checked={newUserRole === role}
                        onChange={() => setNewUserRole(role)}
                        className="text-[#5B8CFF] focus:ring-0"
                      />
                      <span className="capitalize">{role}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateUserOpen(false)}
                  className="px-3.5 py-1.5 rounded-lg border border-white/10 text-[#8A8A93] hover:text-[#EDEDED] text-[12px] font-mono"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creatingUser}
                  className="px-4 py-1.5 rounded-lg bg-[#5B8CFF] hover:bg-[#4a7ae8] text-white text-[12px] font-mono font-semibold"
                >
                  {creatingUser ? 'Criando...' : 'Criar Acesso'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
