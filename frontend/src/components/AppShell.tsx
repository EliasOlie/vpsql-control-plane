'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useVPSQL } from '@/context/VPSQLContext';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import { api, getApiBaseUrl } from '@/lib/api';
import { FolderPlus, Check, X, RefreshCw } from 'lucide-react';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const {
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
    apiConnected,
    apiLatency,
    apiError,
    checkHealth,
    refreshProjects,
    refreshGroupedProjects,
    databases,
    roles,
    toast,
    flash,
    paletteOpen,
    setPaletteOpen,
    createProjectModalOpen,
    setCreateProjectModalOpen,
    setCreateDbModalOpen,
  } = useVPSQL();

  // Create Project Modal Form State
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [newProjectColor, setNewProjectColor] = useState('#5B8CFF');
  const [creatingProject, setCreatingProject] = useState(false);

  // Command palette search query
  const [paletteQuery, setPaletteQuery] = useState('');

  // Handle Project Creation from Shell
  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newProjectName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (!cleanName) {
      flash('Informe o nome do projeto');
      return;
    }

    setCreatingProject(true);
    try {
      await api.createProjectGroup(cleanName, newProjectDesc.trim(), newProjectColor);
      flash(`✓ Projeto "${cleanName}" criado com sucesso!`);
      setCreateProjectModalOpen(false);
      setNewProjectName('');
      setNewProjectDesc('');
      await refreshGroupedProjects();
      router.push(`/projects?name=${encodeURIComponent(cleanName)}`);
    } catch (err: any) {
      flash('Falha ao criar projeto: ' + err.message);
    } finally {
      setCreatingProject(false);
    }
  };

  // Command Palette Results
  const paletteResults = useMemo(() => {
    const q = paletteQuery.toLowerCase().trim();
    const results: Array<{ kind: string; label: string; hint: string; color: string; run: () => void }> = [
      {
        kind: 'ACTION',
        label: '+ Provision new database',
        hint: 'POST /v1/projects',
        color: '#4BFF8F',
        run: () => { setPaletteOpen(false); setCreateDbModalOpen(true); },
      },
      {
        kind: 'ACTION',
        label: '+ Create project workspace',
        hint: 'POST /v1/projects/groups',
        color: '#5B8CFF',
        run: () => { setPaletteOpen(false); setCreateProjectModalOpen(true); },
      },
      {
        kind: 'NAV',
        label: 'Go to Databases',
        hint: '/databases',
        color: '#4BFF8F',
        run: () => { setPaletteOpen(false); router.push('/databases'); },
      },
      {
        kind: 'NAV',
        label: 'Go to Redis Cache',
        hint: '/redis',
        color: '#FF5C5C',
        run: () => { setPaletteOpen(false); router.push('/redis'); },
      },
      {
        kind: 'NAV',
        label: 'Go to AI Gateway',
        hint: '/ai',
        color: '#C77DFF',
        run: () => { setPaletteOpen(false); router.push('/ai'); },
      },
      {
        kind: 'NAV',
        label: 'Go to S3 Storage',
        hint: '/storage',
        color: '#00E5FF',
        run: () => { setPaletteOpen(false); router.push('/storage'); },
      },
      {
        kind: 'NAV',
        label: 'Go to Projects Hub',
        hint: '/projects',
        color: '#5B8CFF',
        run: () => { setPaletteOpen(false); router.push('/projects'); },
      },
      {
        kind: 'NAV',
        label: 'Go to Backups',
        hint: '/backups',
        color: '#4BFF8F',
        run: () => { setPaletteOpen(false); router.push('/backups'); },
      },
    ];

    databases.forEach(db => {
      results.push({
        kind: 'DB',
        label: db.name,
        hint: `status: ${db.status} · ${db.size}`,
        color: '#4BFF8F',
        run: () => {
          setPaletteOpen(false);
          router.push(`/databases?selected=${encodeURIComponent(db.name)}`);
        },
      });
    });

    roles.forEach(r => {
      results.push({
        kind: 'ROLE',
        label: r.name,
        hint: `${r.kind || 'role'} · ${r.db || 'global'}`,
        color: '#5B8CFF',
        run: () => {
          setPaletteOpen(false);
          router.push('/roles');
        },
      });
    });

    if (!q) return results.slice(0, 8);
    return results.filter(r => r.label.toLowerCase().includes(q) || r.kind.toLowerCase().includes(q) || r.hint.toLowerCase().includes(q));
  }, [paletteQuery, databases, roles, router, setPaletteOpen, setCreateDbModalOpen, setCreateProjectModalOpen]);

  // Se não autenticado, exibir tela de Login
  if (authed === false) {
    return (
      <div className="min-h-screen bg-[#09090B] flex items-center justify-center p-5 text-[#EDEDED]">
        <div className="w-full max-w-[420px] p-7 border border-white/10 rounded-2xl bg-[#0F0F14]/90 backdrop-blur-2xl shadow-[0_0_80px_-20px_rgba(75,255,143,0.3)] flex flex-col gap-6 animate-vpsql-fade">
          <div className="flex flex-col gap-1.5 text-center items-center">
            <div className="w-10 h-10 rounded-xl bg-[#4BFF8F] shadow-[0_0_24px_rgba(75,255,143,0.7)] flex items-center justify-center font-mono text-[16px] font-bold text-[#04140B] mb-2">V</div>
            <h1 className="font-mono text-xl font-medium tracking-tight">VPSQL Control Plane</h1>
            <p className="text-[12.5px] text-[#5A5A63]">Autentique-se com sua chave mestre de cluster</p>
          </div>

          <form onSubmit={handleSignIn} className="flex flex-col gap-3.5">
            <label className="flex flex-col gap-1.5 text-left">
              <span className="text-[11px] uppercase tracking-wider text-[#5A5A63] font-mono">Custom API URL (opcional)</span>
              <input
                type="text"
                placeholder="ex: https://api-vpsql.seusite.com"
                value={loginEndpoint}
                onChange={e => setLoginEndpoint(e.target.value)}
                className="p-2.5 border border-white/10 rounded-lg bg-[#070709] font-mono text-[12.5px] outline-none focus:border-[#4BFF8F]/60 text-[#EDEDED] placeholder-[#3F3F46]"
              />
            </label>

            <label className="flex flex-col gap-1.5 text-left">
              <span className="text-[11px] uppercase tracking-wider text-[#5A5A63] font-mono">E-mail de Operador</span>
              <input
                type="email"
                required
                value={loginEmail}
                onChange={e => setLoginEmail(e.target.value)}
                className="p-2.5 border border-white/10 rounded-lg bg-[#070709] font-mono text-[12.5px] outline-none focus:border-[#4BFF8F]/60 text-[#EDEDED]"
              />
            </label>

            <label className="flex flex-col gap-1.5 text-left">
              <span className="text-[11px] uppercase tracking-wider text-[#5A5A63] font-mono">Senha Mestra / Token</span>
              <input
                type="password"
                required
                placeholder="••••••••••••"
                value={loginPassword}
                onChange={e => setLoginPassword(e.target.value)}
                className="p-2.5 border border-white/10 rounded-lg bg-[#070709] font-mono text-[12.5px] outline-none focus:border-[#4BFF8F]/60 text-[#EDEDED]"
              />
            </label>

            {loginError && (
              <div className="p-3 border border-[#FF5C5C]/30 bg-[#FF5C5C]/10 text-[#FF5C5C] text-[12px] rounded-lg">
                {loginError}
              </div>
            )}

            <button
              type="submit"
              disabled={signingIn}
              className="mt-2 w-full py-2.5 rounded-lg bg-[#4BFF8F] hover:bg-[#8DFFBD] text-[#04140B] font-semibold text-[13px] shadow-[0_0_20px_-4px_rgba(75,255,143,0.7)] transition cursor-pointer disabled:opacity-50"
            >
              {signingIn ? 'Autenticando…' : 'Entrar no Painel'}
            </button>
          </form>

          <div className="text-[11px] text-[#4E4E57] text-center border-t border-white/[0.06] pt-4">
            VPSQL Single-Node PostgreSQL &amp; Storage Engine
          </div>
        </div>
      </div>
    );
  }

  // Layout Principal Autenticado com Left Sidebar
  return (
    <div className="flex min-h-screen bg-[#09090B] text-[#EDEDED]">
      {/* 1. LEFT SIDEBAR PERSISTENTE */}
      <Sidebar />

      {/* 2. MAIN CONTENT COM TOPBAR */}
      <main className="flex-1 min-w-0 flex flex-col">
        <Topbar />

        <div className="flex-1 p-6 max-w-[1460px] w-full">
          {/* API Error Warning */}
          {apiConnected === false && (
            <div className="mb-5 p-3.5 border border-[#FF5C5C]/35 rounded-xl bg-[#FF5C5C]/10 flex items-center gap-3 text-[12.5px] text-[#EDEDED] animate-vpsql-fade">
              <span className="font-mono text-[#FF5C5C] font-bold">API ERROR:</span>
              <span>Não foi possível conectar ao backend Go em <code>{getApiBaseUrl()}</code> ({apiError}).</span>
              <button 
                onClick={() => { checkHealth(); refreshProjects(); }}
                className="ml-auto px-3 py-1 rounded bg-[#FF5C5C]/25 hover:bg-[#FF5C5C]/40 text-white font-mono text-[11.5px] transition"
              >
                Reconectar
              </button>
            </div>
          )}

          {/* PAGE CONTENT */}
          {children}
        </div>
      </main>

      {/* MODAL GLOBAL: CRIAR PROJETO */}
      {createProjectModalOpen && (
        <div 
          onClick={() => setCreateProjectModalOpen(false)}
          className="fixed inset-0 z-50 bg-[#040406]/70 backdrop-blur-sm flex items-center justify-center p-5 animate-vpsql-fade"
        >
          <div 
            onClick={e => e.stopPropagation()}
            className="w-full max-w-[460px] border border-white/10 rounded-2xl bg-[#121216]/95 backdrop-blur-2xl shadow-[0_0_60px_-20px_rgba(91,140,255,0.35)] overflow-hidden animate-vpsql-fade"
          >
            <div className="px-5 py-4 border-b border-white/[0.07] flex items-center gap-2.5">
              <span className="p-1.5 rounded-lg bg-[#5B8CFF]/15 text-[#5B8CFF]">
                <FolderPlus className="w-4 h-4" />
              </span>
              <div>
                <span className="text-[14px] font-semibold text-[#EDEDED] block">Novo Workspace de Projeto</span>
                <span className="text-[11px] text-[#5A5A63]">Agrupe bancos, caches Redis, S3 e chaves de IA</span>
              </div>
              <button
                type="button"
                onClick={() => setCreateProjectModalOpen(false)}
                className="ml-auto text-[#5A5A63] hover:text-[#EDEDED] font-mono text-[13px] p-1 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateProject}>
              <div className="p-5 flex flex-col gap-4">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] uppercase tracking-wider text-[#5A5A63] font-mono">Nome do Projeto *</span>
                  <input
                    value={newProjectName}
                    onChange={e => setNewProjectName(e.target.value)}
                    placeholder="ex: billing-system, mobile-app"
                    autoFocus
                    required
                    className="p-2.5 border border-white/10 rounded-lg bg-[#0C0C0F] text-[#EDEDED] font-mono text-[13px] outline-none focus:border-[#5B8CFF]/60"
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] uppercase tracking-wider text-[#5A5A63] font-mono">Descrição (opcional)</span>
                  <input
                    value={newProjectDesc}
                    onChange={e => setNewProjectDesc(e.target.value)}
                    placeholder="ex: Microsserviço de checkout e cartões"
                    className="p-2.5 border border-white/10 rounded-lg bg-[#0C0C0F] text-[#EDEDED] text-[13px] outline-none focus:border-[#5B8CFF]/60"
                  />
                </label>

                <div className="flex flex-col gap-2">
                  <span className="text-[11px] uppercase tracking-wider text-[#5A5A63] font-mono">Cor de Identificação</span>
                  <div className="flex items-center gap-2.5">
                    {['#5B8CFF', '#4BFF8F', '#FF5C5C', '#00E5FF', '#C77DFF', '#FFB020'].map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setNewProjectColor(c)}
                        className={`w-7 h-7 rounded-full transition flex items-center justify-center cursor-pointer ${
                          newProjectColor === c ? 'ring-2 ring-white scale-110' : 'opacity-70 hover:opacity-100'
                        }`}
                        style={{ backgroundColor: c }}
                      >
                        {newProjectColor === c && <Check className="w-3.5 h-3.5 text-black" />}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="px-5 py-3.5 border-t border-white/[0.07] flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setCreateProjectModalOpen(false)}
                  className="px-3.5 py-2 border border-white/10 rounded-lg text-[#8A8A93] hover:text-[#EDEDED] text-[12.5px] transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creatingProject}
                  className="px-4 py-2 rounded-lg bg-[#5B8CFF] text-white text-[12.5px] font-semibold hover:bg-[#4a7ae8] shadow-[0_0_22px_-6px_rgba(91,140,255,0.7)] transition disabled:opacity-50 cursor-pointer"
                >
                  {creatingProject ? 'Criando…' : 'Criar Projeto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* COMMAND PALETTE (⌘K) */}
      {paletteOpen && (
        <div
          onClick={() => setPaletteOpen(false)}
          className="fixed inset-0 z-50 bg-[#040406]/70 backdrop-blur-sm flex items-start justify-center pt-[12vh] px-5"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-[580px] border border-white/10 rounded-2xl bg-[#101014]/95 backdrop-blur-2xl shadow-[0_0_70px_-24px_rgba(75,255,143,0.4)] overflow-hidden animate-vpsql-fade"
          >
            <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-white/[0.07]">
              <span className="font-mono text-[13px] text-[#4BFF8F]">›</span>
              <input
                value={paletteQuery}
                onChange={e => setPaletteQuery(e.target.value)}
                placeholder="Search databases, roles, or run a command…"
                autoFocus
                className="flex-1 bg-transparent text-[#EDEDED] text-[14px] outline-none placeholder-[#5A5A63]"
              />
              <kbd className="font-mono text-[10px] border border-white/10 rounded px-1.5 py-0.5 text-[#5A5A63]">esc</kbd>
            </div>

            <div className="max-h-[360px] overflow-auto p-1.5">
              {paletteResults.map((r, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={r.run}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-[13px] text-[#EDEDED] hover:bg-[#4BFF8F]/10 transition cursor-pointer"
                >
                  <span className="font-mono text-[11px] w-16 flex-shrink-0" style={{ color: r.color }}>{r.kind}</span>
                  <span className="truncate">{r.label}</span>
                  <span className="ml-auto font-mono text-[11px] text-[#4E4E57] flex-shrink-0">{r.hint}</span>
                </button>
              ))}
              {paletteResults.length === 0 && (
                <div className="p-6 text-center font-mono text-[12px] text-[#4E4E57]">no matches</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TOAST NOTIFICATION */}
      {toast && (
        <div className="fixed right-6 bottom-6 z-50 flex items-center gap-2.5 px-4 py-3 border border-[#4BFF8F]/35 rounded-xl bg-[#0E1410]/95 backdrop-blur-md shadow-[0_0_34px_-12px_rgba(75,255,143,0.6)] animate-vpsql-fade">
          <span className="w-1.5 h-1.5 rounded-full bg-[#4BFF8F] shadow-[0_0_8px_#4BFF8F]"></span>
          <span className="font-mono text-[12px] text-[#8DFFBD]">{toast}</span>
        </div>
      )}
    </div>
  );
}
