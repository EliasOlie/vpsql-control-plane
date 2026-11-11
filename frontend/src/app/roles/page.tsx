'use client';

import React, { useState } from 'react';
import { useVPSQL } from '@/context/VPSQLContext';
import { useDialog } from '@/components/ModalDialog';
import { api, RotateRoleResponse } from '@/lib/api';
import { RefreshCw, ShieldAlert, KeyRound, Copy, Check, X } from 'lucide-react';

export default function RolesPage() {
  const { roles, refreshRoles, refreshProjects, refreshActivity, flash } = useVPSQL();
  const { confirm: showConfirm, alert: showAlert } = useDialog();

  const [rotating, setRotating] = useState<string | null>(null);
  const [rotatedResult, setRotatedResult] = useState<RotateRoleResponse | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    flash('Copiado para a área de transferência');
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleRotateRole = async (roleName: string) => {
    const ok = await showConfirm({
      title: `Rotacionar credencial da role "${roleName}"?`,
      description: (
        <div className="flex flex-col gap-2 text-[12.5px] text-[#8A8A93]">
          <p>
            Uma nova senha forte de 24 caracteres será gerada no PostgreSQL.
          </p>
          <div className="p-2.5 rounded-lg border border-amber-500/30 bg-amber-500/[0.08] text-amber-300 text-[11.5px] flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 flex-shrink-0" />
            <span>
              Todas as conexões ativas associadas a esta credencial serão derrubadas (kill sessions) por segurança.
            </span>
          </div>
        </div>
      ),
      confirmText: 'Rotacionar Credencial',
      variant: 'warning',
    });

    if (!ok) return;

    setRotating(roleName);
    try {
      const res = await api.rotateRole(roleName, true);
      setRotatedResult(res);
      flash(`✓ Role "${roleName}" rotacionada com sucesso!`);
      await refreshRoles();
      await refreshProjects();
      await refreshActivity();
    } catch (err: any) {
      flash(`Erro ao rotacionar: ${err.message}`);
    } finally {
      setRotating(null);
    }
  };

  const handleRotateAll = async () => {
    const ok = await showConfirm({
      title: 'Rotacionar TODAS as credenciais do cluster?',
      description: (
        <div className="flex flex-col gap-2 text-[12.5px] text-[#8A8A93]">
          <p className="text-red-400 font-medium">
            Atenção: Esta ação emergencial irá rotacionar as senhas de todas as roles de todos os bancos de dados, Redis, S3 e chaves de IA.
          </p>
          <p>
            Sessões existentes serão desconectadas imediatamente. Você precisará atualizar as Connection Strings em suas aplicações.
          </p>
        </div>
      ),
      confirmText: 'Rotacionar Tudo Imediatamente',
      variant: 'danger',
    });

    if (!ok) return;

    setRotating('ALL');
    try {
      const res = await api.rotateAll('all', true);
      await showAlert({
        title: 'Rotacionamento em Lote Concluído',
        description: (
          <div className="flex flex-col gap-2 font-mono text-[12px] text-[#EDEDED]">
            <div>• Bancos de dados: {res.databases_rotated}</div>
            <div>• Redis namespaces: {res.redis_rotated}</div>
            <div>• Buckets S3: {res.buckets_rotated}</div>
            <div>• Chaves de IA: {res.ai_keys_rotated}</div>
            <div>• Sessões ativas encerradas: {res.terminated_sessions}</div>
          </div>
        ),
        type: 'success',
      });
      await refreshRoles();
      await refreshProjects();
      await refreshActivity();
    } catch (err: any) {
      flash(`Erro ao rotacionar tudo: ${err.message}`);
    } finally {
      setRotating(null);
    }
  };

  return (
    <div className="flex flex-col gap-4 animate-vpsql-fade">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight">Roles &amp; grants</h1>
          <p className="text-[13px] text-[#5A5A63] mt-1">
            Todas as roles provisionadas no cluster PostgreSQL com controle granular de privilégios e rotacionamento de segurança.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRotateAll}
            disabled={rotating !== null}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-red-500/30 bg-red-500/[0.08] hover:bg-red-500/[0.15] text-[#FF5C5C] rounded-lg font-mono text-[12px] cursor-pointer transition disabled:opacity-50"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Rotacionar Tudo (Emergência)</span>
          </button>
          <button
            onClick={refreshRoles}
            className="px-3 py-1.5 border border-white/10 rounded-lg text-[#8A8A93] hover:text-[#EDEDED] font-mono text-[12px] cursor-pointer transition"
          >
            ↻ Recarregar
          </button>
        </div>
      </div>

      <div className="border border-white/[0.07] rounded-xl bg-white/[0.022] overflow-hidden">
        <div className="overflow-x-auto">
          <div className="grid grid-cols-[minmax(180px,1.6fr)_100px_minmax(140px,1.3fr)_minmax(120px,1fr)_110px_100px] gap-3 px-4 py-2.5 border-b border-white/[0.06] text-[10.5px] uppercase tracking-widest text-[#4E4E57] min-w-[760px]">
            <span>Role</span>
            <span>Kind</span>
            <span>Database</span>
            <span>Grants</span>
            <span>Rotated</span>
            <span className="text-right">Ação</span>
          </div>

          {roles.length === 0 && (
            <div className="p-8 text-center font-mono text-[12px] text-[#5A5A63]">
              Nenhuma role encontrada.
            </div>
          )}

          {roles.map((r, i) => (
            <div
              key={r.name + i}
              className="grid grid-cols-[minmax(180px,1.6fr)_100px_minmax(140px,1.3fr)_minmax(120px,1fr)_110px_100px] gap-3 px-4 py-3 border-b border-white/[0.045] items-center font-mono text-[12px] hover:bg-white/[0.03] transition min-w-[760px]"
            >
              <span className="truncate">{r.name}</span>
              <span style={{ color: r.fg || (r.kind === 'owner' ? '#4BFF8F' : '#5B8CFF') }} className="text-[11px]">{r.kind}</span>
              <span className="text-[#8A8A93] truncate">{r.db}</span>
              <span className="text-[#8A8A93] text-[11px]">{r.grants}</span>
              <span className="text-[#5A5A63] text-[11px]">{r.rotated}</span>
              <div className="flex justify-end">
                <button
                  onClick={() => handleRotateRole(r.name)}
                  disabled={rotating === r.name}
                  className="flex items-center gap-1 px-2.5 py-1 rounded border border-[#FFB020]/30 bg-[#FFB020]/[0.08] hover:bg-[#FFB020]/[0.18] text-[#FFB020] text-[11px] transition cursor-pointer disabled:opacity-50"
                  title="Gera nova senha e derruba conexões ativas"
                >
                  <RefreshCw className={`w-3 h-3 ${rotating === r.name ? 'animate-spin' : ''}`} />
                  <span>Rotacionar</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ROTATION RESULT MODAL */}
      {rotatedResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-vpsql-fade">
          <div className="w-full max-w-lg p-5 border border-white/10 rounded-2xl bg-[#0E0E12] shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-white/[0.07] pb-3">
              <div className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-[#4BFF8F]" />
                <h3 className="text-[15px] font-semibold text-[#EDEDED]">Novas Credenciais Geradas</h3>
              </div>
              <button
                onClick={() => setRotatedResult(null)}
                className="text-[#5A5A63] hover:text-[#EDEDED] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-col gap-3 font-mono text-[12px]">
              <div className="p-3 rounded-lg border border-white/[0.08] bg-white/[0.02] flex flex-col gap-1.5">
                <span className="text-[10.5px] uppercase tracking-wider text-[#5A5A63]">Banco de Dados</span>
                <span className="text-[#4BFF8F] font-semibold">{rotatedResult.db_name}</span>
                {rotatedResult.terminated_sessions > 0 && (
                  <span className="text-[11px] text-[#FFB020]">
                    ⚡ {rotatedResult.terminated_sessions} sessão(ões) ativa(s) anterior(es) derrubada(s)
                  </span>
                )}
              </div>

              {rotatedResult.admin_password && (
                <div className="p-3 rounded-lg border border-white/[0.08] bg-white/[0.02] flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10.5px] uppercase tracking-wider text-[#4E4E57]">Nova Senha Admin</span>
                    <button
                      onClick={() => copyToClipboard(rotatedResult.admin_password!, 'pwd-admin')}
                      className="text-[#8A8A93] hover:text-[#EDEDED] text-[11px] flex items-center gap-1"
                    >
                      {copiedKey === 'pwd-admin' ? <Check className="w-3 h-3 text-[#4BFF8F]" /> : <Copy className="w-3 h-3" />}
                      <span>Copiar Senha</span>
                    </button>
                  </div>
                  <div className="text-[#EDEDED] select-all break-all">{rotatedResult.admin_password}</div>
                </div>
              )}

              {rotatedResult.readonly_password && (
                <div className="p-3 rounded-lg border border-white/[0.08] bg-white/[0.02] flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10.5px] uppercase tracking-wider text-[#4E4E57]">Nova Senha Read-only</span>
                    <button
                      onClick={() => copyToClipboard(rotatedResult.readonly_password!, 'pwd-ro')}
                      className="text-[#8A8A93] hover:text-[#EDEDED] text-[11px] flex items-center gap-1"
                    >
                      {copiedKey === 'pwd-ro' ? <Check className="w-3 h-3 text-[#4BFF8F]" /> : <Copy className="w-3 h-3" />}
                      <span>Copiar Senha</span>
                    </button>
                  </div>
                  <div className="text-[#EDEDED] select-all break-all">{rotatedResult.readonly_password}</div>
                </div>
              )}

              {rotatedResult.admin_pooler_connection_string && (
                <div className="p-3 rounded-lg border border-white/[0.08] bg-[#0C0C0F] flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10.5px] uppercase tracking-wider text-[#4BFF8F]">Admin Connection String (PgBouncer)</span>
                    <button
                      onClick={() => copyToClipboard(rotatedResult.admin_pooler_connection_string!, 'uri-admin')}
                      className="text-[#8A8A93] hover:text-[#4BFF8F] text-[11px] flex items-center gap-1"
                    >
                      {copiedKey === 'uri-admin' ? <Check className="w-3 h-3 text-[#4BFF8F]" /> : <Copy className="w-3 h-3" />}
                      <span>Copiar URI</span>
                    </button>
                  </div>
                  <div className="text-[#8DFFBD] select-all break-all text-[11px]">
                    {rotatedResult.admin_pooler_connection_string}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setRotatedResult(null)}
                className="px-4 py-2 rounded-lg bg-[#4BFF8F] text-[#04140B] font-semibold text-[12.5px] hover:bg-[#8DFFBD] transition cursor-pointer"
              >
                Concluído
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
