'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { 
  api, 
  BackupItemData, 
  BackupConfigData, 
  ProjectData 
} from '@/lib/api';
import { 
  Archive, 
  Download, 
  Trash2, 
  RefreshCw, 
  Plus, 
  Check, 
  Copy, 
  Clock, 
  ShieldCheck, 
  HardDrive, 
  Cloud, 
  CloudOff, 
  Terminal, 
  AlertCircle, 
  FileText, 
  Sparkles,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  X
} from 'lucide-react';

interface BackupsViewProps {
  flash: (msg: string) => void;
  databases?: ProjectData[];
}

export default function BackupsView({ flash, databases = [] }: BackupsViewProps) {
  const [backups, setBackups] = useState<BackupItemData[]>([]);
  const [config, setConfig] = useState<BackupConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  // Modals
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [selectedScope, setSelectedScope] = useState('all');
  const [backupNotes, setBackupNotes] = useState('');
  
  const [restoreModalFile, setRestoreModalFile] = useState<BackupItemData | null>(null);
  const [s3GuideOpen, setS3GuideOpen] = useState(false);
  const [deletingFile, setDeletingFile] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, cfgRes] = await Promise.all([
        api.listBackups(),
        api.getBackupConfig(),
      ]);
      setBackups(listRes || []);
      setConfig(cfgRes);
    } catch (err: any) {
      flash(`Erro ao carregar backups: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [flash]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    flash('Copiado para a área de transferência!');
    setTimeout(() => setCopiedText(null), 2000);
  };

  const handleCreateBackup = async () => {
    setCreating(true);
    try {
      const item = await api.createBackup(selectedScope, backupNotes.trim());
      flash(`✓ Backup ${item.filename} gerado com sucesso (${item.size_formatted})!`);
      setCreateModalOpen(false);
      setBackupNotes('');
      await loadData();
    } catch (err: any) {
      flash(`Erro ao criar backup: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteBackup = async (filename: string) => {
    if (!window.confirm(`Tem certeza de que deseja excluir permanentemente o backup "${filename}"?`)) {
      return;
    }
    setDeletingFile(filename);
    try {
      await api.deleteBackup(filename);
      flash(`✓ Backup "${filename}" removido com sucesso.`);
      setBackups(prev => prev.filter(b => b.filename !== filename));
      if (config) {
        const updated = await api.getBackupConfig();
        setConfig(updated);
      }
    } catch (err: any) {
      flash(`Erro ao excluir backup: ${err.message}`);
    } finally {
      setDeletingFile(null);
    }
  };

  const s3EnvSnippet = `# Dokploy -> Environment Variables
S3_ENABLED=true
S3_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
S3_BUCKET=vpsql-backups
S3_REGION=auto
S3_ACCESS_KEY=<sua_access_key_r2_ou_aws>
S3_SECRET_KEY=<sua_secret_key_r2_ou_aws>
S3_FORCE_PATH_STYLE=true`;

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto pb-16">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-4 border-b border-white/[0.08]">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-[#4BFF8F]/10 border border-[#4BFF8F]/20 text-[#4BFF8F]">
              <Archive className="w-4 h-4" />
            </span>
            <h1 className="text-xl font-semibold text-[#EDEDED] tracking-tight">Backups &amp; Snapshots</h1>
          </div>
          <p className="text-[13px] text-[#8A8A93] mt-1">
            Backups diários automatizados com retenção de 7 dias e arquitetura Plug &amp; Play para Cloudflare R2 / AWS S3.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={loadData}
            disabled={loading}
            className="px-3 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-[#8A8A93] hover:text-[#EDEDED] text-[13px] font-mono border border-white/[0.08] transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            title="Atualizar lista"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </button>

          <button
            onClick={() => setCreateModalOpen(true)}
            disabled={creating}
            className="px-4 py-2 rounded-lg bg-[#4BFF8F] hover:bg-[#3ce07b] text-black font-semibold text-[13px] transition flex items-center gap-2 cursor-pointer disabled:opacity-50 shadow-sm"
          >
            {creating ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Gerando Dump...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                <span>Fazer Backup Agora</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Overview Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
        {/* Card 1: Rotina 7d */}
        <div className="p-4 rounded-xl border border-white/[0.08] bg-[#09090B] flex flex-col gap-2">
          <div className="flex items-center justify-between text-[#8A8A93] text-[12px] font-mono">
            <span className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[#4BFF8F]" />
              Agendamento &amp; Retenção
            </span>
            <span className="flex items-center gap-1 text-[#4BFF8F] text-[11px] bg-[#4BFF8F]/10 border border-[#4BFF8F]/20 px-2 py-0.5 rounded">
              <span className="w-1.5 h-1.5 rounded-full bg-[#4BFF8F] animate-pulse" />
              Ativo
            </span>
          </div>
          <div className="text-[20px] font-semibold text-[#EDEDED] tracking-tight">
            Retenção de {config?.retention_days || 7} Dias
          </div>
          <div className="text-[12px] text-[#8A8A93] flex items-center justify-between pt-1 border-t border-white/[0.04]">
            <span>{config?.schedule_display || 'Diariamente às 03:00'}</span>
            <span className="text-[#EDEDED] font-mono">Purge automático</span>
          </div>
        </div>

        {/* Card 2: Armazenamento Local */}
        <div className="p-4 rounded-xl border border-white/[0.08] bg-[#09090B] flex flex-col gap-2">
          <div className="flex items-center justify-between text-[#8A8A93] text-[12px] font-mono">
            <span className="flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-[#85B7EB]" />
              Armazenamento Dokploy
            </span>
            <span className="text-[11px] font-mono text-[#85B7EB] bg-[#85B7EB]/10 border border-[#85B7EB]/20 px-2 py-0.5 rounded">
              vpsql_backups
            </span>
          </div>
          <div className="text-[20px] font-semibold text-[#EDEDED] tracking-tight flex items-baseline gap-2">
            <span>{config?.total_size_formatted || '0 B'}</span>
            <span className="text-[13px] font-normal text-[#8A8A93]">({backups.length} snapshots)</span>
          </div>
          <div className="text-[12px] text-[#8A8A93] flex items-center justify-between pt-1 border-t border-white/[0.04]">
            <span className="font-mono text-[11px] truncate max-w-[190px]">{config?.backup_dir || '/data/backups'}</span>
            <span className="text-[#4BFF8F] font-mono text-[11px]">Volume persistente</span>
          </div>
        </div>

        {/* Card 3: S3 / Cloudflare R2 Plug & Play */}
        <div className="p-4 rounded-xl border border-white/[0.08] bg-[#09090B] flex flex-col gap-2">
          <div className="flex items-center justify-between text-[#8A8A93] text-[12px] font-mono">
            <span className="flex items-center gap-1.5">
              {config?.s3_config.enabled ? (
                <Cloud className="w-3.5 h-3.5 text-[#C77DFF]" />
              ) : (
                <CloudOff className="w-3.5 h-3.5 text-[#8A8A93]" />
              )}
              Off-Site Cloudflare R2 / S3
            </span>
            {config?.s3_config.enabled ? (
              <span className="text-[11px] font-mono text-[#C77DFF] bg-[#C77DFF]/10 border border-[#C77DFF]/20 px-2 py-0.5 rounded flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#C77DFF] animate-pulse" />
                Conectado
              </span>
            ) : (
              <span className="text-[11px] font-mono text-[#FFB020] bg-[#FFB020]/10 border border-[#FFB020]/20 px-2 py-0.5 rounded">
                Plug &amp; Play Pronto
              </span>
            )}
          </div>
          <div className="text-[15px] font-semibold text-[#EDEDED] tracking-tight truncate">
            {config?.s3_config.enabled ? (
              <span>Bucket: {config.s3_config.bucket}</span>
            ) : (
              <span>Armazenamento em Nuvem Inativo</span>
            )}
          </div>
          <div className="text-[12px] text-[#8A8A93] flex items-center justify-between pt-1 border-t border-white/[0.04]">
            <button
              onClick={() => setS3GuideOpen(!s3GuideOpen)}
              className="text-[#85B7EB] hover:underline font-mono text-[11px] flex items-center gap-1 cursor-pointer"
            >
              <span>{s3GuideOpen ? 'Ocultar guia de ativação' : 'Como ativar com Cloudflare R2?'}</span>
              {s3GuideOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            <span className="font-mono text-[10px] text-[#5A5A63]">Zero code</span>
          </div>
        </div>
      </div>

      {/* S3 / R2 Plug & Play Guide Banner (Expandable) */}
      {s3GuideOpen && (
        <div className="p-4 rounded-xl border border-[#C77DFF]/20 bg-[#C77DFF]/[0.03] flex flex-col gap-3 transition">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-[#EDEDED] flex items-center gap-1.5 font-mono">
              <Cloud className="w-4 h-4 text-[#C77DFF]" />
              Estrutura Plug &amp; Play: Como habilitar cópias no Cloudflare R2 / AWS S3
            </span>
            <button
              onClick={() => setS3GuideOpen(false)}
              className="text-[#8A8A93] hover:text-[#EDEDED] p-1 rounded transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-[12px] text-[#8A8A93] leading-relaxed">
            O backend do VPSQL já possui o cliente de assinatura AWS SigV4 embutido. Para ativar o espelhamento off-site automático de cada backup, basta adicionar as seguintes variáveis de ambiente no Dokploy do serviço <code className="text-[#EDEDED]">api</code>:
          </p>

          <div className="relative rounded-lg bg-black/60 border border-white/[0.08] p-3 font-mono text-[12px] text-[#EDEDED]">
            <pre className="overflow-x-auto">{s3EnvSnippet}</pre>
            <button
              onClick={() => copyToClipboard(s3EnvSnippet, 's3_snippet')}
              className="absolute top-2.5 right-2.5 px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 text-[#EDEDED] text-[11px] flex items-center gap-1 transition cursor-pointer"
            >
              {copiedText === 's3_snippet' ? <Check className="w-3 h-3 text-[#4BFF8F]" /> : <Copy className="w-3 h-3" />}
              <span>{copiedText === 's3_snippet' ? 'Copiado!' : 'Copiar .env'}</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5 text-[11px] font-mono text-[#8A8A93]">
            <ShieldCheck className="w-3.5 h-3.5 text-[#4BFF8F]" />
            <span>O Cloudflare R2 oferece <strong>10 GB gratuitos</strong> mensais e taxa zero de egress (download).</span>
          </div>
        </div>
      )}

      {/* Backups Table */}
      <div className="border border-white/[0.08] rounded-xl bg-[#09090B] overflow-hidden flex flex-col">
        <div className="p-3.5 px-4 border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px] text-[#8A8A93]">Snapshots Gerados ({backups.length})</span>
            <span className="text-[11px] font-mono text-[#8A8A93] bg-white/[0.04] px-2 py-0.5 rounded border border-white/[0.04]">
              Retenção 7D
            </span>
          </div>
          <span className="text-[11px] text-[#8A8A93] font-mono">
            Formato: <code>.sql.gz</code> (pg_dumpall / pg_dump)
          </span>
        </div>

        {loading ? (
          <div className="p-12 text-center flex flex-col items-center justify-center gap-2.5 text-[#8A8A93]">
            <RefreshCw className="w-5 h-5 animate-spin text-[#4BFF8F]" />
            <span className="text-[13px] font-mono">Carregando snapshots...</span>
          </div>
        ) : backups.length === 0 ? (
          <div className="p-16 text-center flex flex-col items-center justify-center gap-3 text-[#8A8A93]">
            <Archive className="w-10 h-10 text-white/10" />
            <div className="text-[14px] font-medium text-[#EDEDED]">Nenhum snapshot de backup encontrado</div>
            <p className="text-[12px] max-w-md text-[#8A8A93]">
              Os backups automáticos são gerados diariamente às 03:00. Você também pode disparar um snapshot manual on-demand a qualquer momento.
            </p>
            <button
              onClick={() => setCreateModalOpen(true)}
              className="mt-2 px-3.5 py-1.5 rounded-lg bg-[#4BFF8F]/10 border border-[#4BFF8F]/30 text-[#4BFF8F] hover:bg-[#4BFF8F]/20 text-[12.5px] font-mono transition flex items-center gap-1.5 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Gerar primeiro backup agora</span>
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/[0.06] text-[11px] font-mono text-[#8A8A93] uppercase tracking-wider bg-white/[0.01]">
                  <th className="py-2.5 px-4 font-normal">Arquivo</th>
                  <th className="py-2.5 px-4 font-normal">Escopo</th>
                  <th className="py-2.5 px-4 font-normal">Gatilho</th>
                  <th className="py-2.5 px-4 font-normal">Tamanho</th>
                  <th className="py-2.5 px-4 font-normal">Criação</th>
                  <th className="py-2.5 px-4 font-normal">Retenção</th>
                  <th className="py-2.5 px-4 font-normal text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04] text-[12.5px]">
                {backups.map((item) => (
                  <tr key={item.filename} className="hover:bg-white/[0.02] transition">
                    {/* Arquivo */}
                    <td className="py-3 px-4 font-mono">
                      <div className="flex items-center gap-2">
                        <FileText className="w-3.5 h-3.5 text-[#4BFF8F] shrink-0" />
                        <span className="text-[#EDEDED] font-medium truncate max-w-[280px]" title={item.filename}>
                          {item.filename}
                        </span>
                      </div>
                    </td>

                    {/* Escopo */}
                    <td className="py-3 px-4 font-mono text-[12px]">
                      {item.scope === 'all' ? (
                        <span className="text-[#85B7EB] bg-[#85B7EB]/10 border border-[#85B7EB]/20 px-2 py-0.5 rounded">
                          Cluster (All DBs)
                        </span>
                      ) : (
                        <span className="text-[#C77DFF] bg-[#C77DFF]/10 border border-[#C77DFF]/20 px-2 py-0.5 rounded">
                          db: {item.scope}
                        </span>
                      )}
                    </td>

                    {/* Gatilho */}
                    <td className="py-3 px-4 font-mono text-[12px]">
                      {item.trigger === 'scheduler' ? (
                        <span className="text-[#8A8A93] flex items-center gap-1">
                          <Clock className="w-3 h-3 text-[#4BFF8F]" />
                          Agendado
                        </span>
                      ) : (
                        <span className="text-[#EDEDED] flex items-center gap-1">
                          <Sparkles className="w-3 h-3 text-[#FFB020]" />
                          Manual
                        </span>
                      )}
                    </td>

                    {/* Tamanho */}
                    <td className="py-3 px-4 font-mono text-[#EDEDED] font-medium">
                      {item.size_formatted}
                    </td>

                    {/* Criação */}
                    <td className="py-3 px-4 font-mono text-[11.5px] text-[#8A8A93]">
                      <div>{item.created_at_display}</div>
                      <div className="text-[10px] text-[#5A5A63]">
                        {item.age_days < 1 
                          ? 'hoje' 
                          : `há ${Math.floor(item.age_days)} ${Math.floor(item.age_days) === 1 ? 'dia' : 'dias'}`}
                      </div>
                    </td>

                    {/* Retenção */}
                    <td className="py-3 px-4 font-mono text-[11px]">
                      {item.expires_in_days > 2 ? (
                        <span className="text-[#4BFF8F] bg-[#4BFF8F]/10 border border-[#4BFF8F]/20 px-2 py-0.5 rounded">
                          Expira em {item.expires_in_days}d
                        </span>
                      ) : item.expires_in_days > 0 ? (
                        <span className="text-[#FFB020] bg-[#FFB020]/10 border border-[#FFB020]/20 px-2 py-0.5 rounded">
                          Expira em {item.expires_in_days}d
                        </span>
                      ) : (
                        <span className="text-[#FF5C5C] bg-[#FF5C5C]/10 border border-[#FF5C5C]/20 px-2 py-0.5 rounded">
                          Expira hoje
                        </span>
                      )}
                    </td>

                    {/* Ações */}
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Download */}
                        <a
                          href={api.getBackupDownloadUrl(item.filename)}
                          download={item.filename}
                          className="p-1.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-[#8A8A93] hover:text-[#4BFF8F] border border-white/[0.06] transition cursor-pointer"
                          title="Baixar arquivo (.sql.gz)"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>

                        {/* Restore Command Snippet */}
                        <button
                          onClick={() => setRestoreModalFile(item)}
                          className="p-1.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-[#8A8A93] hover:text-[#85B7EB] border border-white/[0.06] transition cursor-pointer"
                          title="Comando para restaurar"
                        >
                          <Terminal className="w-3.5 h-3.5" />
                        </button>

                        {/* Delete */}
                        <button
                          onClick={() => handleDeleteBackup(item.filename)}
                          disabled={deletingFile === item.filename}
                          className="p-1.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-[#8A8A93] hover:text-[#FF5C5C] border border-white/[0.06] transition cursor-pointer disabled:opacity-50"
                          title="Excluir snapshot"
                        >
                          {deletingFile === item.filename ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#FF5C5C]" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL: CRIAR BACKUP MANUAL */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-[#09090B] border border-white/[0.1] rounded-2xl p-6 shadow-2xl flex flex-col gap-5">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-[#4BFF8F]/10 border border-[#4BFF8F]/20 text-[#4BFF8F]">
                  <Sparkles className="w-4 h-4" />
                </span>
                <h3 className="text-[15px] font-semibold text-[#EDEDED]">Gerar Snapshot On-Demand</h3>
              </div>
              <button
                onClick={() => setCreateModalOpen(false)}
                className="text-[#8A8A93] hover:text-[#EDEDED] p-1 rounded transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-[12px] font-mono text-[#8A8A93] mb-1.5">
                  Escopo do Backup
                </label>
                <select
                  value={selectedScope}
                  onChange={(e) => setSelectedScope(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.1] text-[13px] text-[#EDEDED] focus:border-[#4BFF8F] outline-none transition font-mono cursor-pointer"
                >
                  <option value="all" className="bg-[#09090B] text-[#EDEDED]">
                    Cluster Completo (Todos os bancos e roles - pg_dumpall)
                  </option>
                  {databases.map((d) => (
                    <option key={d.db_name} value={d.db_name} className="bg-[#09090B] text-[#EDEDED]">
                      Banco específico: {d.name} ({d.db_name})
                    </option>
                  ))}
                </select>
                <span className="text-[11px] text-[#5A5A63] mt-1 block">
                  O dump é compactado em gzip e não causa lock de leitura ou escrita.
                </span>
              </div>

              <div>
                <label className="block text-[12px] font-mono text-[#8A8A93] mb-1.5">
                  Nota / Descrição (opcional)
                </label>
                <input
                  type="text"
                  placeholder="Ex: Pré-migração de schema ou deploy"
                  value={backupNotes}
                  onChange={(e) => setBackupNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.1] text-[13px] text-[#EDEDED] focus:border-[#4BFF8F] outline-none transition"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-white/[0.08]">
              <button
                type="button"
                onClick={() => setCreateModalOpen(false)}
                className="px-3 py-2 rounded-xl text-[12.5px] text-[#8A8A93] hover:text-[#EDEDED] hover:bg-white/[0.04] transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCreateBackup}
                disabled={creating}
                className="px-4 py-2 rounded-xl bg-[#4BFF8F] hover:bg-[#3ce07b] text-black font-semibold text-[13px] transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {creating ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Executando...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Iniciar Snapshot</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: COMANDOS DE RESTAURAÇÃO */}
      {restoreModalFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-[#09090B] border border-white/[0.1] rounded-2xl p-6 shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-[#85B7EB]/10 border border-[#85B7EB]/20 text-[#85B7EB]">
                  <Terminal className="w-4 h-4" />
                </span>
                <h3 className="text-[15px] font-semibold text-[#EDEDED]">Como restaurar este snapshot</h3>
              </div>
              <button
                onClick={() => setRestoreModalFile(null)}
                className="text-[#8A8A93] hover:text-[#EDEDED] p-1 rounded transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-[12px] text-[#8A8A93] leading-relaxed">
              Para restaurar o arquivo <code className="text-[#EDEDED]">{restoreModalFile.filename}</code>, execute um dos comandos abaixo no servidor:
            </p>

            {/* Opção 1: Via Docker Compose / dokploy container */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-mono text-[#85B7EB]">1. Restauração direta no container Docker (no servidor):</span>
              <div className="relative rounded-lg bg-black/60 border border-white/[0.08] p-3 font-mono text-[11px] text-[#EDEDED]">
                <pre className="overflow-x-auto whitespace-pre-wrap">
{`docker exec -i vpsql-db psql -U postgres < <(gunzip -c /data/backups/${restoreModalFile.filename})`}
                </pre>
                <button
                  onClick={() => copyToClipboard(`docker exec -i vpsql-db psql -U postgres < <(gunzip -c /data/backups/${restoreModalFile.filename})`, 'restore_cmd1')}
                  className="absolute top-2 right-2 px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-[#EDEDED] text-[10px] flex items-center gap-1 transition cursor-pointer"
                >
                  {copiedText === 'restore_cmd1' ? <Check className="w-3 h-3 text-[#4BFF8F]" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedText === 'restore_cmd1' ? 'Copiado!' : 'Copiar'}</span>
                </button>
              </div>
            </div>

            {/* Opção 2: Via terminal do desenvolvedor após download */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-mono text-[#4BFF8F]">2. Restauração após baixar o arquivo para sua máquina:</span>
              <div className="relative rounded-lg bg-black/60 border border-white/[0.08] p-3 font-mono text-[11px] text-[#EDEDED]">
                <pre className="overflow-x-auto whitespace-pre-wrap">
{`gunzip < ${restoreModalFile.filename} | psql "postgresql://postgres:CHANGE_ME@db.example.com:5434/postgres"`}
                </pre>
                <button
                  onClick={() => copyToClipboard(`gunzip < ${restoreModalFile.filename} | psql "postgresql://postgres:CHANGE_ME@db.example.com:5434/postgres"`, 'restore_cmd2')}
                  className="absolute top-2 right-2 px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-[#EDEDED] text-[10px] flex items-center gap-1 transition cursor-pointer"
                >
                  {copiedText === 'restore_cmd2' ? <Check className="w-3 h-3 text-[#4BFF8F]" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedText === 'restore_cmd2' ? 'Copiado!' : 'Copiar'}</span>
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end pt-2 border-t border-white/[0.08]">
              <button
                type="button"
                onClick={() => setRestoreModalFile(null)}
                className="px-4 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-[#EDEDED] text-[12.5px] font-mono transition cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
