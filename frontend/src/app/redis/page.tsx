'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { 
  api, 
  RedisInstanceData, 
  RedisKeyItemData 
} from '@/lib/api';
import { useVPSQL } from '@/context/VPSQLContext';
import { useDialog } from '@/components/ModalDialog';
import KeyExplorerModal from '@/components/KeyExplorerModal';
import { 
  Layers, Plus, RefreshCw, Copy, Check, Trash2, KeyRound, 
  Search, Eye, X 
} from 'lucide-react';

function RedisContent() {
  const searchParams = useSearchParams();
  const selectedParam = searchParams.get('selected');

  const { confirm: showConfirm, alert: showAlert } = useDialog();
  const { 
    redisList, 
    refreshRedis, 
    redisMetrics, 
    refreshRedisMetrics, 
    flash, 
    nodeMetrics 
  } = useVPSQL();

  const [selectedRedisIndex, setSelectedRedisIndex] = useState(0);
  const [redisKeys, setRedisKeys] = useState<RedisKeyItemData[]>([]);
  const [loadingRedisKeys, setLoadingRedisKeys] = useState(false);
  const [redisSearchPattern, setRedisSearchPattern] = useState('');

  // Modals state
  const [newRedisModalOpen, setNewRedisModalOpen] = useState(false);
  const [newRedisName, setNewRedisName] = useState('');
  const [provisioningRedis, setProvisioningRedis] = useState(false);

  const [newKeyModalOpen, setNewKeyModalOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [newKeyTTL, setNewKeyTTL] = useState(0);
  const [settingKey, setSettingKey] = useState(false);

  // Key Inspector state
  const [inspectModalOpen, setInspectModalOpen] = useState(false);
  const [inspectingKey, setInspectingKey] = useState<RedisKeyItemData | null>(null);

  // Settings
  const [snippetLang, setSnippetLang] = useState<'node' | 'python' | 'go' | 'cli'>('node');
  const [redisUseTLS, setRedisUseTLS] = useState<boolean>(false);
  const [redisSelectedPort, setRedisSelectedPort] = useState<number | null>(null);

  // Sync selected namespace from URL
  useEffect(() => {
    if (selectedParam && redisList.length > 0) {
      const idx = redisList.findIndex(r => r.name === selectedParam || r.username === selectedParam);
      if (idx >= 0) {
        setSelectedRedisIndex(idx);
      }
    }
  }, [selectedParam, redisList]);

  const currentRedis = redisList[selectedRedisIndex] || redisList[0];

  const currentHost = process.env.NEXT_PUBLIC_DB_HOST || nodeMetrics?.node_host || 'db.example.com';
  const defaultPort = 6380;
  const redisPort = redisSelectedPort !== null ? redisSelectedPort : (currentRedis?.port || defaultPort);

  const activeRedisUri = React.useMemo(() => {
    if (!currentRedis) return '';
    const user = currentRedis.username;
    const pass = currentRedis.password || '••••••••';
    const proto = redisUseTLS ? 'rediss' : 'redis';
    return `${proto}://${user}:${pass}@${currentHost}:${redisPort}`;
  }, [currentRedis, currentHost, redisPort, redisUseTLS]);

  const activeRedisCli = React.useMemo(() => {
    if (!currentRedis) return '';
    const pass = currentRedis.password || '••••••••';
    const tlsFlag = redisUseTLS ? ' --tls --insecure' : '';
    return `redis-cli -h ${currentHost} -p ${redisPort}${tlsFlag} --user ${currentRedis.username} -a '${pass}'`;
  }, [currentRedis, currentHost, redisPort, redisUseTLS]);

  const copyToClipboard = (text: string, msg: string) => {
    navigator.clipboard.writeText(text);
    flash(msg);
  };

  // Refresh keys for current namespace
  const refreshRedisKeys = async (idOrName: string, pattern = '') => {
    setLoadingRedisKeys(true);
    try {
      const keys = await api.listRedisKeys(idOrName, pattern);
      setRedisKeys(Array.isArray(keys) ? keys : []);
    } catch (err: any) {
      console.error('Failed to list redis keys:', err);
      flash(`Falha ao carregar chaves: ${err.message}`);
    } finally {
      setLoadingRedisKeys(false);
    }
  };

  const selectedRedisId = currentRedis?.id || currentRedis?.name;
  useEffect(() => {
    if (selectedRedisId) {
      refreshRedisKeys(selectedRedisId, redisSearchPattern);
    }
  }, [selectedRedisId, redisSearchPattern]);

  // Create Redis
  const handleCreateRedis = async () => {
    const name = newRedisName.trim();
    if (!name) {
      flash('Informe o nome do namespace Redis');
      return;
    }
    setProvisioningRedis(true);
    try {
      await api.createRedis(name);
      flash(`✓ Namespace Redis "${name}" provisionado com sucesso!`);
      await refreshRedis();
      await refreshRedisMetrics();
      setNewRedisModalOpen(false);
      setNewRedisName('');
      setSelectedRedisIndex(0);
    } catch (err: any) {
      flash(`Falha no provisionamento: ${err.message}`);
    } finally {
      setProvisioningRedis(false);
    }
  };

  // Delete Redis
  const handleDeleteRedis = async (inst: RedisInstanceData) => {
    const ok = await showConfirm({
      title: `Excluir namespace Redis "${inst.name}"?`,
      description: `Esta ação removerá o usuário ACL "${inst.username}" e expurgará todas as chaves associadas sob o prefixo "${inst.key_prefix}*".`,
    });
    if (!ok) return;

    try {
      await api.deleteRedis(inst.id || inst.name);
      flash(`Namespace "${inst.name}" excluído.`);
      await refreshRedis();
      await refreshRedisMetrics();
      setSelectedRedisIndex(0);
    } catch (err: any) {
      flash(`Falha ao excluir: ${err.message}`);
    }
  };

  // Rotate Redis
  const handleRotateRedis = async (inst: RedisInstanceData) => {
    const ok = await showConfirm({
      title: `Rotacionar credencial do Redis "${inst.name}"?`,
      description: 'Uma nova senha forte será configurada no Redis via ACL (resetpass) e todas as conexões ativas de clientes para este usuário serão encerradas imediatamente.',
      confirmText: 'Rotacionar Senha',
      variant: 'warning',
    });
    if (!ok) return;

    try {
      await api.rotateRedis(inst.id || inst.name);
      flash(`✓ Senha do Redis "${inst.name}" rotacionada com sucesso!`);
      await refreshRedis();
      await refreshRedisMetrics();
    } catch (err: any) {
      flash(`Erro ao rotacionar Redis: ${err.message}`);
    }
  };

  // Set Key
  const handleSetKey = async () => {
    if (!currentRedis) return;
    const cleanKey = newKeyName.trim();
    if (!cleanKey) {
      flash('Informe o nome da chave');
      return;
    }

    setSettingKey(true);
    try {
      let parsedValue: any = newKeyValue;
      try {
        parsedValue = JSON.parse(newKeyValue);
      } catch {
        parsedValue = newKeyValue;
      }

      await api.setRedisKey(currentRedis.id || currentRedis.name, cleanKey, parsedValue, newKeyTTL);
      flash(`✓ Chave "${cleanKey}" gravada com sucesso!`);
      setNewKeyModalOpen(false);
      setNewKeyName('');
      setNewKeyValue('');
      setNewKeyTTL(0);
      await refreshRedisKeys(currentRedis.id || currentRedis.name, redisSearchPattern);
      await refreshRedis();
      await refreshRedisMetrics();
    } catch (err: any) {
      flash(`Falha ao gravar chave: ${err.message}`);
    } finally {
      setSettingKey(false);
    }
  };

  // Delete Key
  const handleDeleteKey = async (cleanKey: string) => {
    if (!currentRedis) return;
    try {
      await api.deleteRedisKey(currentRedis.id || currentRedis.name, cleanKey);
      flash(`Chave "${cleanKey}" excluída.`);
      await refreshRedisKeys(currentRedis.id || currentRedis.name, redisSearchPattern);
      await refreshRedis();
      await refreshRedisMetrics();
      setInspectModalOpen(false);
    } catch (err: any) {
      flash(`Falha ao excluir chave: ${err.message}`);
    }
  };

  // Flush Keys
  const handleFlushKeys = async () => {
    if (!currentRedis) return;
    const ok = await showConfirm({
      title: `Limpar todas as chaves de "${currentRedis.name}"?`,
      description: `Todas as chaves sob o prefixo "${currentRedis.key_prefix}*" serão excluídas permanentemente.`,
    });
    if (!ok) return;

    try {
      const res = await api.flushRedisKeys(currentRedis.id || currentRedis.name);
      flash(`✓ ${res.deleted_keys} chaves limpas.`);
      await refreshRedisKeys(currentRedis.id || currentRedis.name, redisSearchPattern);
      await refreshRedis();
      await refreshRedisMetrics();
    } catch (err: any) {
      flash(`Falha ao limpar chaves: ${err.message}`);
    }
  };

  return (
    <div className="flex flex-col gap-5 animate-vpsql-fade">
      {/* Header */}
      <div className="flex items-start gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-[20px] font-semibold tracking-tight text-[#EDEDED] flex items-center gap-2">
              <Layers className="w-5 h-5 text-[#FF5C5C]" />
              Redis &amp; Key-Value Cache
            </h1>
            <span className="flex items-center gap-1 text-[11px] font-mono text-[#FF5C5C] border border-[#FF5C5C]/30 bg-[#FF5C5C]/10 rounded px-2 py-0.5">
              ● Redis 7 ACLs
            </span>
            <span className="text-[11px] font-mono text-[#5A5A63]">Porta pública: 6380</span>
          </div>
          <p className="text-[13px] text-[#8A8A93] mt-1">
            Caches e repositórios em memória isolados com controle de acesso granular por ACL (sem colisão com outros serviços).
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => { refreshRedis(); refreshRedisMetrics(); }}
            className="px-3 py-1.5 border border-white/10 hover:border-white/20 rounded-lg text-[#8A8A93] hover:text-[#EDEDED] font-mono text-[12px] transition flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5 text-[#FF5C5C]" />
            <span>Recarregar</span>
          </button>

          <button
            onClick={() => { setNewRedisName(''); setNewRedisModalOpen(true); }}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#FF5C5C] hover:bg-[#FF7A7A] text-[#1E0505] text-[12.5px] font-semibold transition cursor-pointer shadow-[0_0_20px_-6px_rgba(255,92,92,0.6)]"
          >
            <Plus className="w-4 h-4" />
            <span>Provisionar Redis</span>
          </button>
        </div>
      </div>

      {/* Redis Cluster Metrics Bar */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
        <div className="p-3.5 border border-white/[0.07] rounded-xl bg-white/[0.02] flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-[#5A5A63]">Memória Usada</span>
          <div className="flex items-baseline gap-1.5 font-mono">
            <span className="text-[18px] font-semibold text-[#EDEDED]">{redisMetrics?.used_memory || '0 B'}</span>
            <span className="text-[11px] text-[#5A5A63]">/ {redisMetrics?.max_memory || '512 MB'}</span>
          </div>
          <span className="text-[10.5px] text-[#4E4E57] font-mono">pico: {redisMetrics?.used_memory_peak || '0 B'}</span>
        </div>

        <div className="p-3.5 border border-white/[0.07] rounded-xl bg-white/[0.02] flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-[#5A5A63]">Total de Chaves</span>
          <span className="text-[18px] font-semibold text-[#4BFF8F] font-mono">{redisMetrics?.total_keys || 0}</span>
          <span className="text-[10.5px] text-[#4E4E57] font-mono">todas as namespaces</span>
        </div>

        <div className="p-3.5 border border-white/[0.07] rounded-xl bg-white/[0.02] flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-[#5A5A63]">Taxa de Hit (Cache)</span>
          <span className="text-[18px] font-semibold text-[#5B8CFF] font-mono">
            {redisMetrics?.hit_rate_pct ? `${redisMetrics.hit_rate_pct.toFixed(1)}%` : '100%'}
          </span>
          <span className="text-[10.5px] text-[#4E4E57] font-mono">eficiência do cache</span>
        </div>

        <div className="p-3.5 border border-white/[0.07] rounded-xl bg-white/[0.02] flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-[#5A5A63]">Operações / Seg</span>
          <span className="text-[18px] font-semibold text-[#E4C381] font-mono">{redisMetrics?.ops_per_sec || 0}</span>
          <span className="text-[10.5px] text-[#4E4E57] font-mono">{redisMetrics?.connected_clients || 1} clientes ativos</span>
        </div>
      </div>

      {/* Main Content: Namespaces & Keys */}
      {redisList.length === 0 ? (
        <div className="p-12 border border-dashed border-white/10 rounded-2xl text-center flex flex-col items-center justify-center gap-3 bg-white/[0.01]">
          <div className="p-3 rounded-xl bg-[#FF5C5C]/10 text-[#FF5C5C]">
            <Layers className="w-8 h-8 stroke-1" />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-[#EDEDED]">Nenhum namespace Redis provisionado</h3>
            <p className="text-[12px] text-[#5A5A63] mt-1 max-w-md">
              Crie um namespace isolado para seu app. Cada tenant possui credenciais ACL próprias e acesso restrito a suas chaves.
            </p>
          </div>
          <button
            onClick={() => { setNewRedisName(''); setNewRedisModalOpen(true); }}
            className="mt-2 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#FF5C5C] hover:bg-[#FF7A7A] text-[#1E0505] text-[12.5px] font-semibold transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Provisionar primeiro Redis</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4 items-start">
          {/* Left Column: Namespaces List */}
          <div className="flex flex-col gap-2">
            <div className="text-[11px] uppercase tracking-wider text-[#5A5A63] font-mono px-1">
              Namespaces ({redisList.length})
            </div>
            <div className="flex flex-col gap-1.5">
              {redisList.map((item, idx) => (
                <div
                  key={item.id}
                  onClick={() => setSelectedRedisIndex(idx)}
                  className={`p-3 rounded-xl border transition cursor-pointer flex flex-col gap-1.5 ${
                    selectedRedisIndex === idx
                      ? 'bg-[#FF5C5C]/10 border-[#FF5C5C]/40 text-[#EDEDED]'
                      : 'bg-white/[0.02] border-white/[0.06] hover:border-white/15 text-[#8A8A93] hover:text-[#EDEDED]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[13px] font-medium text-[#EDEDED] flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#4BFF8F]"></span>
                      {item.name}
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-[#EDEDED]">
                      {item.key_count} chaves
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] font-mono text-[#5A5A63]">
                    <span>user: {item.username}</span>
                    <span>{item.created}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right Column: Selected Tenant Details & Keys */}
          {currentRedis && (
            <div className="flex flex-col gap-4 border border-white/[0.07] rounded-xl bg-[#0A0A0D] p-5">
              {/* Tenant Title & Actions */}
              <div className="flex items-center justify-between flex-wrap gap-3 pb-3 border-b border-white/[0.06]">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-[17px] font-semibold text-[#EDEDED] font-mono">{currentRedis.name}</h2>
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#4BFF8F]/10 text-[#4BFF8F] border border-[#4BFF8F]/20">
                      ACL Active
                    </span>
                  </div>
                  <div className="text-[12px] font-mono text-[#5A5A63] mt-0.5">
                    prefixo isolado: <code className="text-[#FF5C5C] font-bold">{currentRedis.key_prefix}*</code> · usuário: <code className="text-[#EDEDED]">{currentRedis.username}</code>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setNewKeyName(''); setNewKeyValue(''); setNewKeyTTL(0); setNewKeyModalOpen(true); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#4BFF8F]/30 bg-[#4BFF8F]/10 hover:bg-[#4BFF8F]/20 text-[#4BFF8F] text-[11.5px] font-medium transition cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Set Key</span>
                  </button>

                  <button
                    onClick={handleFlushKeys}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 hover:border-[#FF5C5C]/40 hover:text-[#FF5C5C] bg-white/[0.02] text-[#8A8A93] text-[11.5px] transition cursor-pointer"
                    title="Limpar chaves desta namespace"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Flush</span>
                  </button>

                  <button
                    onClick={() => handleRotateRedis(currentRedis)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#FFB020]/30 bg-[#FFB020]/[0.08] hover:bg-[#FFB020]/[0.18] text-[#FFB020] text-[11.5px] transition cursor-pointer"
                    title="Rotacionar senha do usuário Redis e derrubar conexões ativas"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Rotacionar Senha</span>
                  </button>

                  <button
                    onClick={() => handleDeleteRedis(currentRedis)}
                    className="px-2.5 py-1.5 rounded-lg border border-white/10 hover:border-red-500/40 text-[#8A8A93] hover:text-[#FF5C5C] text-[11.5px] transition cursor-pointer"
                    title="Excluir namespace"
                  >
                    Excluir
                  </button>
                </div>
              </div>

              {/* Connection String Box */}
              <div className="flex flex-col gap-2.5 p-3.5 rounded-xl bg-[#0E0E12] border border-white/[0.06]">
                <div className="flex items-center justify-between text-[11.5px] text-[#8A8A93] flex-wrap gap-2">
                  <span className="font-semibold text-[#EDEDED] flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-[#FF5C5C]" /> Connection URI (Redis 7 ACL)
                  </span>

                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center bg-black/40 border border-white/10 rounded-md p-0.5 text-[10.5px] font-mono">
                      <button
                        onClick={() => setRedisUseTLS(true)}
                        className={`px-2 py-0.5 rounded transition cursor-pointer ${redisUseTLS ? 'bg-[#FF5C5C]/20 text-[#FF7A7A] font-semibold' : 'text-[#8A8A93] hover:text-[#EDEDED]'}`}
                        title="Usar rediss:// com criptografia TLS"
                      >
                        TLS (rediss://)
                      </button>
                      <button
                        onClick={() => setRedisUseTLS(false)}
                        className={`px-2 py-0.5 rounded transition cursor-pointer ${!redisUseTLS ? 'bg-white/10 text-[#EDEDED] font-semibold' : 'text-[#8A8A93] hover:text-[#EDEDED]'}`}
                        title="Usar redis:// em texto plano"
                      >
                        Plain (redis://)
                      </button>
                    </div>

                    <div className="flex items-center bg-black/40 border border-white/10 rounded-md p-0.5 text-[10.5px] font-mono">
                      <button
                        onClick={() => { setRedisSelectedPort(6380); setRedisUseTLS(false); }}
                        className={`px-2 py-0.5 rounded transition cursor-pointer ${redisPort === 6380 ? 'bg-[#4BFF8F]/20 text-[#4BFF8F] font-semibold' : 'text-[#8A8A93] hover:text-[#EDEDED]'}`}
                      >
                        :6380 (VPSQL)
                      </button>
                      <button
                        onClick={() => { setRedisSelectedPort(6379); setRedisUseTLS(true); }}
                        className={`px-2 py-0.5 rounded transition cursor-pointer ${redisPort === 6379 ? 'bg-[#FF5C5C]/20 text-[#FF7A7A] font-semibold' : 'text-[#8A8A93] hover:text-[#EDEDED]'}`}
                      >
                        :6379 (TLS)
                      </button>
                    </div>

                    <button
                      onClick={() => copyToClipboard(activeRedisUri, 'Redis connection string copiada!')}
                      className="text-[#4BFF8F] hover:underline flex items-center gap-1 text-[11px] font-mono cursor-pointer ml-1"
                    >
                      <Copy className="w-3 h-3" /> Copiar URI
                    </button>
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-[#070709] border border-white/[0.05] overflow-x-auto">
                  <code className="text-[#8DFFBD] text-[12px] font-mono whitespace-nowrap">{activeRedisUri}</code>
                </div>

                {/* Code Snippets */}
                <div className="flex items-center gap-2 pt-1 border-t border-white/[0.04]">
                  <span className="text-[10px] uppercase tracking-wider text-[#5A5A63]">Quick Code:</span>
                  {(['node', 'python', 'go', 'cli'] as const).map(lang => (
                    <button
                      key={lang}
                      onClick={() => setSnippetLang(lang)}
                      className={`px-2 py-0.5 rounded text-[11px] font-mono transition cursor-pointer ${
                        snippetLang === lang
                          ? 'bg-[#FF5C5C]/20 text-[#FF7A7A] font-semibold border border-[#FF5C5C]/30'
                          : 'text-[#8A8A93] hover:text-[#EDEDED]'
                      }`}
                    >
                      {lang === 'node' ? 'Node (ioredis)' : lang === 'python' ? 'Python' : lang === 'go' ? 'Go' : 'CLI'}
                    </button>
                  ))}
                </div>

                <div className="p-2.5 rounded-lg bg-[#070709] border border-white/[0.05] text-[11.5px] font-mono text-[#85B7EB] overflow-x-auto">
                  {snippetLang === 'node' && (
                    <pre>{`import Redis from 'ioredis';\n\nconst redis = new Redis('${activeRedisUri}', {\n  keyPrefix: '${currentRedis.key_prefix}',${redisUseTLS ? `\n  tls: { rejectUnauthorized: false }, // Certificado da VPS` : ''}\n});\n\n// Chaves são salvas automaticamente sob a namespace isolada\nawait redis.set('minha_chave', 'meu_valor', 'EX', 3600);\nconst val = await redis.get('minha_chave');\nconsole.log(val);`}</pre>
                  )}
                  {snippetLang === 'python' && (
                    <pre>{`import redis\n\n# Conexão com Redis 7 ACL\nr = redis.from_url('${activeRedisUri}${redisUseTLS ? '?ssl_cert_reqs=none' : ''}', decode_responses=True)\n\n# Acesso restrito ao prefixo do tenant\nr.set('${currentRedis.key_prefix}minha_chave', 'meu_valor', ex=3600)\nprint(r.get('${currentRedis.key_prefix}minha_chave'))`}</pre>
                  )}
                  {snippetLang === 'go' && (
                    <pre>{`opt, err := redis.ParseURL("${activeRedisUri}")\n${redisUseTLS ? `opt.TLSConfig = &tls.Config{InsecureSkipVerify: true}\n` : ''}rdb := redis.NewClient(opt)\n\n// Chave com prefixo obrigatório da namespace\nerr = rdb.Set(ctx, "${currentRedis.key_prefix}minha_chave", "meu_valor", time.Hour).Err()`}</pre>
                  )}
                  {snippetLang === 'cli' && (
                    <pre>{`${activeRedisCli}`}</pre>
                  )}
                </div>
              </div>

              {/* Key-Value Explorer */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="font-semibold text-[13px] text-[#EDEDED] font-mono flex items-center gap-1.5">
                    Key-Value Explorer ({redisKeys.length} chaves listadas)
                  </span>

                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 bg-[#0C0C0F] border border-white/10 rounded-lg px-2.5 py-1 focus-within:border-[#FF5C5C]/60 transition">
                      <Search className="w-3.5 h-3.5 text-[#5A5A63]" />
                      <input
                        type="text"
                        value={redisSearchPattern}
                        onChange={e => setRedisSearchPattern(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && refreshRedisKeys(currentRedis.id || currentRedis.name, redisSearchPattern)}
                        placeholder="Buscar chave... (Enter)"
                        className="bg-transparent text-[#EDEDED] outline-none text-[11.5px] font-mono w-44 placeholder:text-[#4E4E57]"
                      />
                    </div>
                    <button
                      onClick={() => refreshRedisKeys(currentRedis.id || currentRedis.name, redisSearchPattern)}
                      className="p-1 rounded-lg border border-white/10 hover:border-white/20 text-[#8A8A93] hover:text-[#EDEDED] transition cursor-pointer"
                      title="Atualizar chaves"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${loadingRedisKeys ? 'animate-spin text-[#FF5C5C]' : ''}`} />
                    </button>
                  </div>
                </div>

                <div className="border border-white/[0.06] rounded-xl overflow-hidden bg-[#070709] relative min-h-[160px]">
                  {loadingRedisKeys && redisKeys.length === 0 ? (
                    <div className="p-8 text-center text-[#5A5A63] font-mono text-[12px] flex items-center justify-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin text-[#FF5C5C]" />
                      <span>Buscando chaves na namespace...</span>
                    </div>
                  ) : redisKeys.length === 0 ? (
                    <div className="p-8 text-center text-[#5A5A63] font-mono text-[12px] flex flex-col items-center justify-center gap-1">
                      <span>Nenhuma chave encontrada com o prefixo <code>{currentRedis.key_prefix}*</code></span>
                      <span className="text-[11px] text-[#4E4E57]">Clique em &quot;Set Key&quot; acima para adicionar sua primeira chave de teste.</span>
                    </div>
                  ) : (
                    <table className="w-full text-left font-mono text-[11.5px]">
                      <thead className="bg-[#0C0C0F] border-b border-white/10">
                        <tr className="text-[#8A8A93]">
                          <th className="px-3 py-2 w-12 text-center text-[#4E4E57]">#</th>
                          <th className="px-3 py-2">Chave</th>
                          <th className="px-3 py-2 w-24">Tipo</th>
                          <th className="px-3 py-2 w-28">TTL</th>
                          <th className="px-3 py-2">Preview de Valor</th>
                          <th className="px-3 py-2 w-20 text-center">Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {redisKeys.map((k, i) => (
                          <tr 
                            key={k.key} 
                            onClick={() => {
                              setInspectingKey(k);
                              setInspectModalOpen(true);
                            }}
                            className="border-b border-white/[0.03] hover:bg-white/[0.04] cursor-pointer group transition"
                          >
                            <td className="px-3 py-2 text-[#4E4E57] text-center">{i + 1}</td>
                            <td className="px-3 py-2 text-[#EDEDED] font-semibold">
                              <span className="truncate group-hover:text-[#4BFF8F] transition">{k.clean_key}</span>
                            </td>
                            <td className="px-3 py-2">
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-white/[0.05] text-[#85B7EB] uppercase font-mono">
                                {k.type}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-[#8A8A93]">
                              {k.ttl < 0 ? (
                                <span className="text-[#5A5A63]">Sem expiração</span>
                              ) : (
                                <span className="text-[#E4C381]">{k.ttl}s</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-[#8A8A93] truncate max-w-xs font-mono text-[11px] group-hover:text-[#EDEDED] transition">
                              {k.value ? String(k.value) : '—'}
                            </td>
                            <td className="px-3 py-2 text-center" onClick={e => e.stopPropagation()}>
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  onClick={() => {
                                    setInspectingKey(k);
                                    setInspectModalOpen(true);
                                  }}
                                  className="text-[#5A5A63] hover:text-[#4BFF8F] p-1 transition cursor-pointer"
                                  title="Inspecionar & Editar Chave"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDeleteKey(k.clean_key)}
                                  className="text-[#5A5A63] hover:text-[#FF5C5C] p-1 transition cursor-pointer"
                                  title="Excluir chave"
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
            </div>
          )}
        </div>
      )}

      {/* MODAL: PROVISION NEW REDIS */}
      {newRedisModalOpen && (
        <div
          onClick={() => setNewRedisModalOpen(false)}
          className="fixed inset-0 z-50 bg-[#040406]/75 backdrop-blur-sm flex items-center justify-center p-5 animate-vpsql-fade"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-[460px] border border-white/10 rounded-2xl bg-[#0C0C0F] shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-white/[0.02]">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-[#FF5C5C]/15 border border-[#FF5C5C]/30 text-[#FF5C5C]">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-[15px] font-semibold text-[#EDEDED]">Novo Namespace Redis</h2>
                  <p className="text-[11.5px] text-[#8A8A93] font-mono">Redis 7 ACL Tenant Isolation</p>
                </div>
              </div>
              <button
                onClick={() => setNewRedisModalOpen(false)}
                className="p-1.5 rounded-lg text-[#8A8A93] hover:text-[#EDEDED] hover:bg-white/10 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 flex flex-col gap-4">
              <div>
                <label className="block font-mono text-[11.5px] uppercase tracking-wider text-[#8A8A93] mb-1.5">
                  Nome do Namespace *
                </label>
                <input
                  type="text"
                  value={newRedisName}
                  onChange={e => setNewRedisName(e.target.value)}
                  placeholder="ex: app_ecommerce, cache_auth"
                  autoFocus
                  className="w-full bg-[#050507] border border-white/10 rounded-lg px-3.5 py-2.5 font-mono text-[13px] text-[#EDEDED] placeholder-[#4E4E57] outline-none focus:border-[#FF5C5C]/60"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setNewRedisModalOpen(false)}
                  className="px-4 py-2 border border-white/10 rounded-lg text-[#8A8A93] hover:text-[#EDEDED] text-[12.5px] transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleCreateRedis}
                  disabled={provisioningRedis || !newRedisName.trim()}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#FF5C5C] hover:bg-[#FF7A7A] text-[#1E0505] text-[12.5px] font-semibold transition disabled:opacity-50 cursor-pointer shadow-[0_0_20px_-6px_rgba(255,92,92,0.7)]"
                >
                  {provisioningRedis ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  <span>{provisioningRedis ? 'Provisionando…' : 'Criar Namespace'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: SET KEY */}
      {newKeyModalOpen && currentRedis && (
        <div
          onClick={() => setNewKeyModalOpen(false)}
          className="fixed inset-0 z-50 bg-[#040406]/75 backdrop-blur-sm flex items-center justify-center p-5 animate-vpsql-fade"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-[500px] border border-white/10 rounded-2xl bg-[#0C0C0F] shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-white/[0.02]">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-[#4BFF8F]/15 border border-[#4BFF8F]/30 text-[#4BFF8F]">
                  <Plus className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-[15px] font-semibold text-[#EDEDED]">Gravar Chave Redis (SET)</h2>
                  <p className="text-[11.5px] text-[#8A8A93] font-mono">Namespace: {currentRedis.name}</p>
                </div>
              </div>
              <button
                onClick={() => setNewKeyModalOpen(false)}
                className="p-1.5 rounded-lg text-[#8A8A93] hover:text-[#EDEDED] hover:bg-white/10 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 flex flex-col gap-4">
              <div>
                <label className="block font-mono text-[11.5px] uppercase tracking-wider text-[#8A8A93] mb-1.5">
                  Chave * (sem o prefixo)
                </label>
                <div className="flex items-center bg-[#050507] border border-white/10 rounded-lg overflow-hidden focus-within:border-[#4BFF8F]/60">
                  <span className="px-3 py-2.5 font-mono text-[12px] text-[#5A5A63] bg-white/[0.02] border-r border-white/5 select-none">
                    {currentRedis.key_prefix}
                  </span>
                  <input
                    type="text"
                    value={newKeyName}
                    onChange={e => setNewKeyName(e.target.value)}
                    placeholder="sessao:usuario_123"
                    autoFocus
                    className="flex-1 bg-transparent px-3 py-2.5 font-mono text-[13px] text-[#EDEDED] placeholder-[#4E4E57] outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-mono text-[11.5px] uppercase tracking-wider text-[#8A8A93] mb-1.5">
                  Valor * (string ou JSON)
                </label>
                <textarea
                  value={newKeyValue}
                  onChange={e => setNewKeyValue(e.target.value)}
                  placeholder={`"ativo" ou {"user_id": 1, "role": "admin"}`}
                  rows={4}
                  className="w-full bg-[#050507] border border-white/10 rounded-lg px-3.5 py-2.5 font-mono text-[12.5px] text-[#EDEDED] placeholder-[#4E4E57] outline-none focus:border-[#4BFF8F]/60"
                />
              </div>

              <div>
                <label className="block font-mono text-[11.5px] uppercase tracking-wider text-[#8A8A93] mb-1.5">
                  TTL (Expiração em segundos, 0 = sem expiração)
                </label>
                <input
                  type="number"
                  value={newKeyTTL}
                  onChange={e => setNewKeyTTL(parseInt(e.target.value) || 0)}
                  min={0}
                  className="w-full bg-[#050507] border border-white/10 rounded-lg px-3.5 py-2 font-mono text-[13px] text-[#EDEDED] outline-none focus:border-[#4BFF8F]/60"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setNewKeyModalOpen(false)}
                  className="px-4 py-2 border border-white/10 rounded-lg text-[#8A8A93] hover:text-[#EDEDED] text-[12.5px] transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSetKey}
                  disabled={settingKey || !newKeyName.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#4BFF8F] hover:bg-[#8DFFBD] text-[#04140B] text-[12.5px] font-semibold transition disabled:opacity-50 cursor-pointer shadow-[0_0_20px_-6px_rgba(75,255,143,0.7)]"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{settingKey ? 'Salvando…' : 'Salvar Chave'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: KEY EXPLORER */}
      {currentRedis && (
        <KeyExplorerModal
          isOpen={inspectModalOpen}
          onClose={() => setInspectModalOpen(false)}
          keyItem={inspectingKey}
          instanceId={currentRedis.id || currentRedis.name}
          prefix={currentRedis.key_prefix}
          onKeyUpdated={() => {
            refreshRedisKeys(currentRedis.id || currentRedis.name, redisSearchPattern);
            refreshRedis();
          }}
          onKeyDeleted={cleanKey => {
            handleDeleteKey(cleanKey);
          }}
        />
      )}
    </div>
  );
}

export default function RedisPage() {
  return (
    <Suspense fallback={
      <div className="p-12 text-center text-[#5A5A63] font-mono text-[12px] flex items-center justify-center gap-2">
        <RefreshCw className="w-4 h-4 animate-spin text-[#FF5C5C]" />
        Carregando Redis...
      </div>
    }>
      <RedisContent />
    </Suspense>
  );
}
