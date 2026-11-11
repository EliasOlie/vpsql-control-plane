'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  api, 
  StorageBucketData, 
  StorageObjectData, 
  StorageMetricsData, 
  CreateBucketResponse 
} from '@/lib/api';
import { useDialog } from '@/components/ModalDialog';
import { 
  HardDrive, Plus, RefreshCw, Copy, Check, ExternalLink, Trash2, 
  Upload, Folder, File, Eye, Globe, Lock, Code2, Terminal, Search, X, KeyRound
} from 'lucide-react';

interface StorageViewProps {
  onNotify: (msg: string) => void;
  initialProject?: string;
}

export default function StorageView({ onNotify, initialProject }: StorageViewProps) {
  const { confirm: showConfirm, alert: showAlert } = useDialog();
  const [buckets, setBuckets] = useState<StorageBucketData[]>([]);
  const [metrics, setMetrics] = useState<StorageMetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState(initialProject || 'all');

  // Selected bucket for File Explorer
  const [activeBucket, setActiveBucket] = useState<StorageBucketData | null>(null);
  const [objects, setObjects] = useState<StorageObjectData[]>([]);
  const [objectsLoading, setObjectsLoading] = useState(false);
  const [objectSearch, setObjectSearch] = useState('');

  // Modals
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newBucketName, setNewBucketName] = useState('');
  const [newBucketProject, setNewBucketProject] = useState('default');
  const [newBucketPublic, setNewBucketPublic] = useState(true);
  const [creating, setCreating] = useState(false);

  // Credentials Modal
  const [credsModalOpen, setCredsModalOpen] = useState(false);
  const [credsBucket, setCredsBucket] = useState<StorageBucketData | null>(null);
  const [activeSnippetTab, setActiveSnippetTab] = useState<'env' | 'node' | 'python' | 'cli'>('env');

  // Uploading state
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Copied indicator
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
    onNotify('Copiado para a área de transferência');
  };

  const refreshBuckets = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.listBuckets();
      setBuckets(data);
      const m = await api.getStorageMetrics();
      setMetrics(m);
    } catch (err: any) {
      onNotify('Erro ao carregar buckets: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    refreshBuckets();
  }, [refreshBuckets]);

  // Load objects when active bucket changes
  const loadObjects = useCallback(async (bucketName: string, prefix = '') => {
    try {
      setObjectsLoading(true);
      const res = await api.listBucketObjects(bucketName, prefix);
      setObjects(res.objects || []);
    } catch (err: any) {
      onNotify('Erro ao carregar arquivos: ' + err.message);
    } finally {
      setObjectsLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    if (activeBucket) {
      loadObjects(activeBucket.name);
    }
  }, [activeBucket, loadObjects]);

  const handleCreateBucket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBucketName.trim()) return;
    try {
      setCreating(true);
      const resp = await api.createBucket(newBucketName.trim(), newBucketProject.trim(), newBucketPublic);
      onNotify(`Bucket '${resp.bucket.name}' criado com sucesso!`);
      setCreateModalOpen(false);
      setNewBucketName('');
      await refreshBuckets();
      // Open credentials modal so user immediately sees access keys
      setCredsBucket(resp.bucket);
      setCredsModalOpen(true);
    } catch (err: any) {
      showAlert({ title: 'Erro ao criar bucket', description: err.message, type: 'error' });
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteBucket = async (b: StorageBucketData) => {
    const ok = await showConfirm({
      title: 'Excluir Bucket S3',
      description: `Tem certeza que deseja remover o bucket '${b.name}' e TODOS os seus arquivos no volume persistentemente?`,
      confirmText: 'Excluir Definitivamente',
      variant: 'danger'
    });
    if (!ok) return;

    try {
      await api.deleteBucket(b.name);
      onNotify(`Bucket '${b.name}' excluído.`);
      if (activeBucket?.name === b.name) {
        setActiveBucket(null);
      }
      refreshBuckets();
    } catch (err: any) {
      showAlert({ title: 'Erro ao excluir bucket', description: err.message, type: 'error' });
    }
  };

  const handleRotateBucket = async (bucketName: string) => {
    const ok = await showConfirm({
      title: `Rotacionar Secret Key do Bucket '${bucketName}'?`,
      description: 'Uma nova SecretAccessKey será gerada e a chave anterior será invalidada imediatamente. Você precisará atualizar as variáveis de ambiente das aplicações que consom este bucket.',
      confirmText: 'Rotacionar Chave',
      variant: 'warning',
    });
    if (!ok) return;

    try {
      const res = await api.rotateBucket(bucketName);
      onNotify(`✓ Secret Access Key do bucket '${bucketName}' rotacionada!`);
      if (credsBucket && credsBucket.name === bucketName) {
        setCredsBucket(res.bucket);
      }
      refreshBuckets();
    } catch (err: any) {
      showAlert({ title: 'Erro ao rotacionar bucket', description: err.message, type: 'error' });
    }
  };

  const handleTogglePublic = async (b: StorageBucketData) => {
    try {
      const updated = await api.updateBucket(b.name, { is_public: !b.is_public });
      onNotify(`Bucket '${b.name}' agora é ${updated.is_public ? 'Público' : 'Privado'}`);
      setBuckets(prev => prev.map(item => item.id === b.id ? updated : item));
      if (activeBucket?.id === b.id) {
        setActiveBucket(updated);
      }
    } catch (err: any) {
      onNotify('Erro ao alterar visibilidade: ' + err.message);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!activeBucket || !e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    try {
      setUploading(true);
      await api.uploadBucketObject(activeBucket.name, file);
      onNotify(`Arquivo '${file.name}' enviado com sucesso!`);
      loadObjects(activeBucket.name);
      refreshBuckets();
    } catch (err: any) {
      showAlert({ title: 'Erro no upload', description: err.message, type: 'error' });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeleteObject = async (key: string) => {
    if (!activeBucket) return;
    const ok = await showConfirm({
      title: 'Excluir Arquivo',
      description: `Deseja excluir o arquivo '${key}' do bucket '${activeBucket.name}'?`,
      confirmText: 'Excluir',
      variant: 'danger'
    });
    if (!ok) return;

    try {
      await api.deleteBucketObject(activeBucket.name, key);
      onNotify(`Arquivo '${key}' excluído.`);
      loadObjects(activeBucket.name);
      refreshBuckets();
    } catch (err: any) {
      showAlert({ title: 'Erro ao excluir', description: err.message, type: 'error' });
    }
  };

  const handleGeneratePresigned = async (key: string) => {
    if (!activeBucket) return;
    try {
      const res = await api.presignBucketObject(activeBucket.name, key, 'GET', 3600);
      copyToClipboard(res.url, 'presign-' + key);
      onNotify('URL pré-assinada gerada (1 hora de validade) e copiada!');
    } catch (err: any) {
      showAlert({ title: 'Erro ao gerar URL pré-assinada', description: err.message, type: 'error' });
    }
  };

  // Distinct project groups
  const projectList = Array.from(new Set(buckets.map(b => b.project_group || 'default')));

  const filteredBuckets = buckets.filter(b => {
    const matchesSearch = b.name.toLowerCase().includes(search.toLowerCase()) || 
                          (b.project_group || '').toLowerCase().includes(search.toLowerCase());
    const matchesProj = projectFilter === 'all' || b.project_group === projectFilter;
    return matchesSearch && matchesProj;
  });

  const filteredObjects = objects.filter(o => 
    o.key.toLowerCase().includes(objectSearch.toLowerCase())
  );

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-[#09090B] text-[#EDEDED] p-6 gap-6">
      {/* Top Header & Metrics */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="p-1.5 rounded-lg bg-[#00E5FF]/10 text-[#00E5FF] border border-[#00E5FF]/20">
                <HardDrive className="w-5 h-5" />
              </span>
              <h1 className="text-xl font-medium tracking-tight text-[#EDEDED]">S3 Object Storage</h1>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-[#00E5FF]/10 text-[#00E5FF] border border-[#00E5FF]/20">
                S3-Compliant API
              </span>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-white/[0.05] text-[#8A8A93] border border-white/10">
                Volume: /data/storage
              </span>
            </div>
            <p className="text-[13px] text-[#8A8A93] mt-1">
              Provisionamento de buckets isolados com chaves de acesso AWS SigV4, leitura pública estática e URLs nativas.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={refreshBuckets}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] text-[12px] text-[#8A8A93] hover:text-[#EDEDED] transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Atualizar
            </button>
            <button
              onClick={() => setCreateModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#00E5FF] text-black font-medium text-[12px] hover:bg-[#00E5FF]/90 transition shadow-[0_0_15px_rgba(0,229,255,0.25)]"
            >
              <Plus className="w-3.5 h-3.5" />
              Provisionar Bucket
            </button>
          </div>
        </div>

        {/* Meters & Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="p-4 rounded-xl border border-white/[0.08] bg-white/[0.02] flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wider text-[#5A5A63] font-mono">Buckets Ativos</span>
            <span className="text-2xl font-mono font-medium text-[#EDEDED]">{metrics?.total_buckets ?? buckets.length}</span>
            <span className="text-[11px] text-[#8A8A93]">Tenants com ACL e isolamento</span>
          </div>

          <div className="p-4 rounded-xl border border-white/[0.08] bg-white/[0.02] flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wider text-[#5A5A63] font-mono">Espaço em Disco</span>
            <span className="text-2xl font-mono font-medium text-[#00E5FF]">{metrics?.total_size_formatted ?? '0 B'}</span>
            <span className="text-[11px] text-[#8A8A93]">Mapeado no volume Docker</span>
          </div>

          <div className="p-4 rounded-xl border border-white/[0.08] bg-white/[0.02] flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wider text-[#5A5A63] font-mono">Arquivos Estáticos</span>
            <span className="text-2xl font-mono font-medium text-[#EDEDED]">{metrics?.total_objects ?? 0}</span>
            <span className="text-[11px] text-[#8A8A93]">Uploads, mídias e assets</span>
          </div>

          <div className="p-4 rounded-xl border border-white/[0.08] bg-white/[0.02] flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wider text-[#5A5A63] font-mono">Endpoint S3</span>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="font-mono text-[11px] text-[#EDEDED] truncate">/s3</span>
              <button
                onClick={() => copyToClipboard(buckets[0]?.endpoint || `${window.location.origin}/s3`, 'endpoint')}
                className="text-[#5A5A63] hover:text-[#00E5FF] transition"
                title="Copiar Endpoint"
              >
                {copiedKey === 'endpoint' ? <Check className="w-3.5 h-3.5 text-[#4BFF8F]" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            <span className="text-[11px] text-[#5A5A63] truncate">Compatível com AWS SDK e MinIO</span>
          </div>
        </div>
      </div>

      {/* Main Content: Split View (Bucket List & File Explorer) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[500px]">
        {/* Left Column: Buckets List (5 cols or 12 cols if no active bucket) */}
        <div className={`flex flex-col gap-3 ${activeBucket ? 'lg:col-span-5' : 'lg:col-span-12'}`}>
          <div className="flex items-center gap-2 justify-between flex-wrap">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#5A5A63]" />
              <input
                type="text"
                placeholder="Filtrar buckets..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-white/[0.03] border border-white/[0.08] rounded-lg pl-8 pr-3 py-1.5 text-[12px] text-[#EDEDED] placeholder-[#5A5A63] focus:outline-none focus:border-[#00E5FF]/40"
              />
            </div>

            {projectList.length > 1 && (
              <select
                value={projectFilter}
                onChange={e => setProjectFilter(e.target.value)}
                className="bg-white/[0.03] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-[12px] text-[#8A8A93] focus:outline-none focus:border-[#00E5FF]/40 font-mono"
              >
                <option value="all">Todos Projetos</option>
                {projectList.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            )}
          </div>

          {filteredBuckets.length === 0 ? (
            <div className="p-8 rounded-xl border border-dashed border-white/10 text-center flex flex-col items-center justify-center gap-2">
              <HardDrive className="w-8 h-8 text-[#5A5A63]" />
              <p className="text-[13px] text-[#8A8A93]">Nenhum bucket S3 encontrado</p>
              <button
                onClick={() => setCreateModalOpen(true)}
                className="text-[12px] text-[#00E5FF] hover:underline"
              >
                Criar seu primeiro bucket
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {filteredBuckets.map(b => {
                const isSelected = activeBucket?.id === b.id;
                return (
                  <div
                    key={b.id}
                    onClick={() => setActiveBucket(b)}
                    className={`p-4 rounded-xl border transition cursor-pointer flex flex-col gap-3 ${
                      isSelected 
                        ? 'border-[#00E5FF]/40 bg-[#00E5FF]/5 shadow-[0_0_20px_rgba(0,229,255,0.08)]' 
                        : 'border-white/[0.07] bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.035]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Folder className={`w-4 h-4 shrink-0 ${isSelected ? 'text-[#00E5FF]' : 'text-[#8A8A93]'}`} />
                        <span className="font-mono text-[13px] font-medium text-[#EDEDED] truncate">{b.name}</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-white/[0.06] text-[#8A8A93] border border-white/10">
                          {b.project_group || 'default'}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => handleTogglePublic(b)}
                          title={b.is_public ? 'Público (clique para tornar privado)' : 'Privado (clique para tornar público)'}
                          className={`flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full border transition ${
                            b.is_public 
                              ? 'bg-[#4BFF8F]/10 text-[#4BFF8F] border-[#4BFF8F]/30 hover:bg-[#4BFF8F]/20' 
                              : 'bg-white/[0.05] text-[#8A8A93] border-white/10 hover:bg-white/10'
                          }`}
                        >
                          {b.is_public ? <Globe className="w-2.5 h-2.5" /> : <Lock className="w-2.5 h-2.5 text-[#FFB020]" />}
                          {b.is_public ? 'Público' : 'Privado'}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-[#5A5A63] font-mono">
                      <span>{b.object_count} arquivo(s) · {b.size_formatted}</span>
                      <span>Criado em {b.created}</span>
                    </div>

                    {/* Quick action bar */}
                    <div className="flex items-center gap-2 pt-2 border-t border-white/[0.05]" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => {
                          setCredsBucket(b);
                          setCredsModalOpen(true);
                        }}
                        className="flex items-center gap-1 text-[11px] text-[#8A8A93] hover:text-[#00E5FF] transition"
                      >
                        <Code2 className="w-3 h-3" />
                        Chaves &amp; SDK
                      </button>

                      <button
                        onClick={() => copyToClipboard(b.s3_uri, 's3uri-' + b.id)}
                        className="flex items-center gap-1 text-[11px] text-[#8A8A93] hover:text-[#EDEDED] transition ml-auto"
                      >
                        {copiedKey === 's3uri-' + b.id ? <Check className="w-3 h-3 text-[#4BFF8F]" /> : <Copy className="w-3 h-3" />}
                        S3 URI
                      </button>

                      <button
                        onClick={() => handleDeleteBucket(b)}
                        className="text-[#5A5A63] hover:text-[#FF5C5C] transition p-1"
                        title="Excluir bucket"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Interactive Object Browser (7 cols) */}
        {activeBucket && (
          <div className="lg:col-span-7 flex flex-col gap-4 p-5 rounded-2xl border border-white/[0.08] bg-white/[0.015]">
            <div className="flex items-center justify-between flex-wrap gap-3 pb-3 border-b border-white/[0.07]">
              <div className="flex items-center gap-2 min-w-0">
                <Folder className="w-4 h-4 text-[#00E5FF]" />
                <h2 className="font-mono text-[14px] text-[#EDEDED] truncate">{activeBucket.name}</h2>
                <span className="text-[11px] text-[#5A5A63]">/</span>
                <span className="text-[12px] text-[#8A8A93]">Explorador de Arquivos</span>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#00E5FF]/10 text-[#00E5FF] border border-[#00E5FF]/30 hover:bg-[#00E5FF]/20 text-[12px] font-medium transition cursor-pointer"
                >
                  <Upload className={`w-3.5 h-3.5 ${uploading ? 'animate-bounce' : ''}`} />
                  {uploading ? 'Enviando...' : 'Fazer Upload'}
                </button>
                <button
                  onClick={() => setActiveBucket(null)}
                  className="text-[#5A5A63] hover:text-[#EDEDED] p-1"
                  title="Fechar explorador"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Object Search */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#5A5A63]" />
              <input
                type="text"
                placeholder="Buscar arquivos neste bucket..."
                value={objectSearch}
                onChange={e => setObjectSearch(e.target.value)}
                className="w-full bg-white/[0.03] border border-white/[0.08] rounded-lg pl-8 pr-3 py-1.5 text-[12px] text-[#EDEDED] placeholder-[#5A5A63] focus:outline-none focus:border-[#00E5FF]/40"
              />
            </div>

            {/* Object Table */}
            {objectsLoading ? (
              <div className="p-8 text-center text-[#5A5A63] font-mono text-[12px] flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-[#00E5FF]" />
                Carregando arquivos do volume...
              </div>
            ) : filteredObjects.length === 0 ? (
              <div className="p-10 rounded-xl border border-dashed border-white/10 text-center flex flex-col items-center justify-center gap-2 text-[#5A5A63]">
                <File className="w-8 h-8" />
                <p className="text-[12px]">Nenhum arquivo no bucket</p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-[11px] text-[#00E5FF] hover:underline"
                >
                  Clique para enviar o primeiro arquivo estático
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12px]">
                  <thead>
                    <tr className="border-b border-white/[0.07] text-[#5A5A63] font-mono text-[11px]">
                      <th className="py-2 px-2.5 font-normal">Arquivo</th>
                      <th className="py-2 px-2.5 font-normal">Tipo</th>
                      <th className="py-2 px-2.5 font-normal">Tamanho</th>
                      <th className="py-2 px-2.5 font-normal text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {filteredObjects.map(obj => {
                      const isImage = obj.content_type.startsWith('image/');
                      return (
                        <tr key={obj.id} className="hover:bg-white/[0.02] transition group">
                          <td className="py-2.5 px-2.5 font-mono text-[#EDEDED] flex items-center gap-2">
                            {isImage ? (
                              <div className="w-6 h-6 rounded bg-white/[0.05] border border-white/10 overflow-hidden shrink-0 flex items-center justify-center">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={obj.public_url} alt={obj.key} className="w-full h-full object-cover" />
                              </div>
                            ) : (
                              <File className="w-4 h-4 text-[#8A8A93] shrink-0" />
                            )}
                            <span className="truncate max-w-[200px]" title={obj.key}>{obj.key}</span>
                          </td>
                          <td className="py-2.5 px-2.5 text-[#5A5A63] font-mono text-[11px]">
                            {obj.content_type.split('/')[1] || obj.content_type}
                          </td>
                          <td className="py-2.5 px-2.5 text-[#8A8A93] font-mono text-[11px]">
                            {obj.size_formatted}
                          </td>
                          <td className="py-2.5 px-2.5 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <a
                                href={obj.public_url}
                                target="_blank"
                                rel="noreferrer"
                                className="p-1 text-[#8A8A93] hover:text-[#00E5FF] transition"
                                title="Abrir URL pública"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                              <button
                                onClick={() => handleGeneratePresigned(obj.key)}
                                className="p-1 text-[#8A8A93] hover:text-[#00E5FF] transition"
                                title="Gerar e copiar URL pré-assinada temporária (1h)"
                              >
                                {copiedKey === 'presign-' + obj.key ? <Check className="w-3.5 h-3.5 text-[#4BFF8F]" /> : <KeyRound className="w-3.5 h-3.5" />}
                              </button>
                              <button
                                onClick={() => copyToClipboard(obj.public_url, 'url-' + obj.id)}
                                className="p-1 text-[#8A8A93] hover:text-[#EDEDED] transition"
                                title="Copiar URL pública direta"
                              >
                                {copiedKey === 'url-' + obj.id ? <Check className="w-3.5 h-3.5 text-[#4BFF8F]" /> : <Copy className="w-3.5 h-3.5" />}
                              </button>
                              <button
                                onClick={() => handleDeleteObject(obj.key)}
                                className="p-1 text-[#5A5A63] hover:text-[#FF5C5C] transition"
                                title="Excluir arquivo"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* MODAL: Provision New Bucket */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-[#0F0F12] border border-white/[0.1] rounded-2xl p-6 shadow-2xl flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-[#00E5FF]/10 text-[#00E5FF]">
                  <HardDrive className="w-4 h-4" />
                </span>
                <h3 className="text-base font-medium text-[#EDEDED]">Novo Bucket S3</h3>
              </div>
              <button onClick={() => setCreateModalOpen(false)} className="text-[#5A5A63] hover:text-[#EDEDED]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateBucket} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-mono text-[#8A8A93]">Nome do Bucket</label>
                <input
                  type="text"
                  placeholder="ex: app-meu-projeto-assets"
                  value={newBucketName}
                  onChange={e => setNewBucketName(e.target.value)}
                  className="bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-[13px] text-[#EDEDED] font-mono focus:outline-none focus:border-[#00E5FF]/50"
                  required
                />
                <span className="text-[11px] text-[#5A5A63]">Letras minúsculas, números e hífens. Será mapeado no volume.</span>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-mono text-[#8A8A93]">Projeto Associado</label>
                <input
                  type="text"
                  placeholder="ex: core ou cozy-curses"
                  value={newBucketProject}
                  onChange={e => setNewBucketProject(e.target.value)}
                  className="bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-[13px] text-[#EDEDED] font-mono focus:outline-none focus:border-[#00E5FF]/50"
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg border border-white/[0.08] bg-white/[0.02]">
                <div className="flex flex-col">
                  <span className="text-[12px] font-medium text-[#EDEDED]">Acesso Público HTTP</span>
                  <span className="text-[11px] text-[#5A5A63]">Permite leitura direta de arquivos sem assinatura AWS4</span>
                </div>
                <input
                  type="checkbox"
                  checked={newBucketPublic}
                  onChange={e => setNewBucketPublic(e.target.checked)}
                  className="w-4 h-4 rounded border-white/20 bg-white/10 text-[#00E5FF] focus:ring-0 cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-lg border border-white/10 text-[12px] text-[#8A8A93] hover:text-[#EDEDED]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creating || !newBucketName.trim()}
                  className="px-4 py-1.5 rounded-lg bg-[#00E5FF] text-black font-medium text-[12px] hover:bg-[#00E5FF]/90 transition"
                >
                  {creating ? 'Criando...' : 'Provisionar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: S3 Credentials & Code Snippets */}
      {credsModalOpen && credsBucket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-xl bg-[#0F0F12] border border-white/[0.1] rounded-2xl p-6 shadow-2xl flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-[#00E5FF]/10 text-[#00E5FF]">
                  <Code2 className="w-4 h-4" />
                </span>
                <h3 className="text-base font-medium text-[#EDEDED]">Conexão S3 — {credsBucket.name}</h3>
              </div>
              <button onClick={() => setCredsModalOpen(false)} className="text-[#5A5A63] hover:text-[#EDEDED]">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Credentials Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-3 rounded-lg border border-white/[0.08] bg-white/[0.02] flex flex-col gap-1">
                <span className="text-[10px] font-mono text-[#5A5A63] uppercase">S3 Endpoint</span>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-[#EDEDED] truncate">{credsBucket.endpoint}</span>
                  <button onClick={() => copyToClipboard(credsBucket.endpoint, 'c-ep')} className="text-[#5A5A63] hover:text-[#00E5FF]">
                    {copiedKey === 'c-ep' ? <Check className="w-3 h-3 text-[#4BFF8F]" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
              </div>

              <div className="p-3 rounded-lg border border-white/[0.08] bg-white/[0.02] flex flex-col gap-1">
                <span className="text-[10px] font-mono text-[#5A5A63] uppercase">Bucket Name</span>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-[#EDEDED] truncate">{credsBucket.name}</span>
                  <button onClick={() => copyToClipboard(credsBucket.name, 'c-bn')} className="text-[#5A5A63] hover:text-[#00E5FF]">
                    {copiedKey === 'c-bn' ? <Check className="w-3 h-3 text-[#4BFF8F]" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
              </div>

              <div className="p-3 rounded-lg border border-white/[0.08] bg-white/[0.02] flex flex-col gap-1">
                <span className="text-[10px] font-mono text-[#5A5A63] uppercase">Access Key ID</span>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-[#00E5FF] truncate">{credsBucket.access_key}</span>
                  <button onClick={() => copyToClipboard(credsBucket.access_key, 'c-ak')} className="text-[#5A5A63] hover:text-[#00E5FF]">
                    {copiedKey === 'c-ak' ? <Check className="w-3 h-3 text-[#4BFF8F]" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
              </div>

              <div className="p-3 rounded-lg border border-white/[0.08] bg-white/[0.02] flex flex-col gap-1">
                <span className="text-[10px] font-mono text-[#5A5A63] uppercase">Secret Access Key</span>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-[#00E5FF] truncate">{credsBucket.secret_key || '••••••••••••••••'}</span>
                  {credsBucket.secret_key && (
                    <button onClick={() => copyToClipboard(credsBucket.secret_key!, 'c-sk')} className="text-[#5A5A63] hover:text-[#00E5FF]">
                      {copiedKey === 'c-sk' ? <Check className="w-3 h-3 text-[#4BFF8F]" /> : <Copy className="w-3 h-3" />}
                    </button>
                  )}
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={() => handleRotateBucket(credsBucket.name)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#FFB020]/35 bg-[#FFB020]/[0.08] hover:bg-[#FFB020]/[0.18] text-[#FFB020] text-[11px] font-mono transition cursor-pointer"
                  title="Gera nova SecretAccessKey e invalida a anterior"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Rotacionar Secret Key</span>
                </button>
              </div>
            </div>

            {/* SDK Code Snippets Tabs */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1 border-b border-white/[0.08] pb-1">
                <button
                  onClick={() => setActiveSnippetTab('env')}
                  className={`px-3 py-1 text-[11px] font-mono rounded transition ${
                    activeSnippetTab === 'env' ? 'bg-[#00E5FF]/10 text-[#00E5FF]' : 'text-[#5A5A63] hover:text-[#8A8A93]'
                  }`}
                >
                  .env
                </button>
                <button
                  onClick={() => setActiveSnippetTab('node')}
                  className={`px-3 py-1 text-[11px] font-mono rounded transition ${
                    activeSnippetTab === 'node' ? 'bg-[#00E5FF]/10 text-[#00E5FF]' : 'text-[#5A5A63] hover:text-[#8A8A93]'
                  }`}
                >
                  Node.js (AWS SDK)
                </button>
                <button
                  onClick={() => setActiveSnippetTab('python')}
                  className={`px-3 py-1 text-[11px] font-mono rounded transition ${
                    activeSnippetTab === 'python' ? 'bg-[#00E5FF]/10 text-[#00E5FF]' : 'text-[#5A5A63] hover:text-[#8A8A93]'
                  }`}
                >
                  Python (boto3)
                </button>
                <button
                  onClick={() => setActiveSnippetTab('cli')}
                  className={`px-3 py-1 text-[11px] font-mono rounded transition ${
                    activeSnippetTab === 'cli' ? 'bg-[#00E5FF]/10 text-[#00E5FF]' : 'text-[#5A5A63] hover:text-[#8A8A93]'
                  }`}
                >
                  VPSQL CLI
                </button>
              </div>

              <div className="relative p-3 rounded-lg bg-black/60 border border-white/[0.08]">
                <button
                  onClick={() => {
                    let code = credsBucket.env_snippet;
                    if (activeSnippetTab === 'node') {
                      code = `import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: "auto",
  endpoint: "${credsBucket.endpoint}",
  credentials: {
    accessKeyId: "${credsBucket.access_key}",
    secretAccessKey: "${credsBucket.secret_key || 'YOUR_SECRET'}",
  },
  forcePathStyle: true,
});`;
                    } else if (activeSnippetTab === 'python') {
                      code = `import boto3

s3 = boto3.client(
    "s3",
    endpoint_url="${credsBucket.endpoint}",
    aws_access_key_id="${credsBucket.access_key}",
    aws_secret_access_key="${credsBucket.secret_key || 'YOUR_SECRET'}",
    region_name="auto"
)`;
                    } else if (activeSnippetTab === 'cli') {
                      code = `vpsql storage upload ${credsBucket.name} ./imagem.png --key fotos/banner.png\nvpsql storage objects ${credsBucket.name}`;
                    }
                    copyToClipboard(code, 'snippet-copied');
                  }}
                  className="absolute right-2.5 top-2.5 text-[#5A5A63] hover:text-[#00E5FF] transition p-1"
                  title="Copiar snippet"
                >
                  {copiedKey === 'snippet-copied' ? <Check className="w-3.5 h-3.5 text-[#4BFF8F]" /> : <Copy className="w-3.5 h-3.5" />}
                </button>

                <pre className="font-mono text-[11px] text-[#EDEDED] overflow-x-auto whitespace-pre">
                  {activeSnippetTab === 'env' && credsBucket.env_snippet}
                  {activeSnippetTab === 'node' && `import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: "auto",
  endpoint: "${credsBucket.endpoint}",
  credentials: {
    accessKeyId: "${credsBucket.access_key}",
    secretAccessKey: "${credsBucket.secret_key || 'YOUR_SECRET'}",
  },
  forcePathStyle: true,
});`}
                  {activeSnippetTab === 'python' && `import boto3

s3 = boto3.client(
    "s3",
    endpoint_url="${credsBucket.endpoint}",
    aws_access_key_id="${credsBucket.access_key}",
    aws_secret_access_key="${credsBucket.secret_key || 'YOUR_SECRET'}",
    region_name="auto"
)`}
                  {activeSnippetTab === 'cli' && `vpsql storage upload ${credsBucket.name} ./imagem.png --key fotos/banner.png
vpsql storage objects ${credsBucket.name}`}
                </pre>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setCredsModalOpen(false)}
                className="px-4 py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.12] text-[12px] text-[#EDEDED] transition font-medium"
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
