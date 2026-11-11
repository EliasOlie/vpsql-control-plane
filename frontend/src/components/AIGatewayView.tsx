'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  api, 
  getApiBaseUrl, 
  AIKeyData, 
  AIWorkerStatusData 
} from '@/lib/api';
import { 
  Sparkles, Bot, Key, Send, Copy, Check, RefreshCw, Trash2, 
  Plus, Terminal, ShieldCheck, Clock, ExternalLink, Cpu, X, AlertCircle,
  Edit3, Wrench, Layers, Image as ImageIcon, PauseCircle, PlayCircle,
  Lock, MessageSquare, Sliders
} from 'lucide-react';
import { 
  ChatMessageContent, 
  ImageLightboxModal, 
  ImagePreviewData 
} from '@/components/ChatMessageRenderer';


export const VPSQL_SYSTEM_PROMPT = `Você é o VPSQL Intelligent Assistant, um assistente avançado de banco de dados e inteligência artificial integrado diretamente ao ecossistema VPSQL.

SOBRE O PROJETO VPSQL:
- O VPSQL é uma plataforma moderna e completa de gerenciamento para PostgreSQL 16 e Redis 7 com IA integrada.
- Recursos e Módulos Principais:
  1. PostgreSQL & PgBouncer: Pool de conexões otimizado em modo de transação, migrations automáticas, SQL Runner interativo com EXPLAIN ANALYZE, visualizador de esquemas e tabelas, criação e isolamento de roles, e branching de bancos de dados.
  2. Suporte a Extensões Avançadas: pgvector (para embeddings e buscas vetoriais semânticas), pgcrypto, uuid-ossp, pg_stat_statements, postgis e timescaledb.
  3. Redis 7: Cache em memória de ultra-baixa latência, Key Explorer com inspetor e editor JSON com realce sintático, métricas de memória, conexões, comandos por segundo, hit rate e TTL.
  4. VPSQL AI Gateway: Proxy compatível com a API OpenAI (/v1/ai/chat/completions), descoberta dinâmica de workers GPU (vLLM / Google Colab executando Qwen 2.5 14B) via heartbeat no Redis ("app_ia:llm:local:endpoint"), autenticação com chaves virtuais ("vpsql_sk_live_..."), rate limiting por RPM, isolamento multi-tenant e autorização granular de ferramentas MCP (Model Context Protocol, ex: ERP WinThor via "query_winthor").
  5. Geração de Imagens com IA: Suporte nativo à geração e exibição de imagens visuais. Quando gerar ou responder com uma imagem, SEMPRE forneça o link estritamente no formato Markdown: ![descrição detalhada da imagem](url_da_imagem). O frontend renderizará automaticamente um card interativo com zoom, download e link direto.

DIRETRIZES DE RESPOSTA:
- Responda sempre em português do Brasil por padrão, de forma prestativa, técnica, elegante e precisa.
- Ao sugerir queries SQL, priorize performance, índices adequados, window functions, CTEs legíveis e segurança.
- Mantenha a continuidade da conversa lembrando do contexto, tabelas, consultas e imagens geradas anteriormente na sessão.
- Quando o usuário solicitar a geração de uma imagem, ou quando você retornar imagens, formate sempre como ![prompt ou descrição](URL).`;

const CHAT_STORAGE_KEY = 'vpsql_ai_chat_history_v1';

interface AIGatewayViewProps {
  workerStatus: AIWorkerStatusData | null;
  loadingStatus: boolean;
  onRefreshStatus: () => void;
  flash: (msg: string) => void;
  showConfirm: (opts: any) => Promise<boolean>;
}

export default function AIGatewayView({
  workerStatus,
  loadingStatus,
  onRefreshStatus,
  flash,
  showConfirm
}: AIGatewayViewProps) {
  const [activeTab, setActiveTab] = useState<'keys' | 'playground' | 'studio' | 'snippets'>('keys');
  const [snippetLang, setSnippetLang] = useState<'python' | 'images' | 'ts' | 'curl' | 'colab'>('python');

  // Keys management state
  const [keys, setKeys] = useState<AIKeyData[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(false);
  
  // Create Modal state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyTenant, setNewKeyTenant] = useState('default');
  const [newKeyTools, setNewKeyTools] = useState('*');
  const [newKeyServices, setNewKeyServices] = useState<string[]>(['chat', 'images']);
  const [newKeyRpm, setNewKeyRpm] = useState(60);
  const [creatingKey, setCreatingKey] = useState(false);
  const [createdKey, setCreatedKey] = useState<AIKeyData | null>(null);

  // Edit Key Modal state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<AIKeyData | null>(null);
  const [editKeyName, setEditKeyName] = useState('');
  const [editKeyTenant, setEditKeyTenant] = useState('default');
  const [editKeyTools, setEditKeyTools] = useState('*');
  const [editKeyServices, setEditKeyServices] = useState<string[]>(['chat', 'images']);
  const [editKeyActive, setEditKeyActive] = useState<boolean>(true);
  const [editKeyRpm, setEditKeyRpm] = useState(60);
  const [savingEdit, setSavingEdit] = useState(false);

  // Image Studio state
  const [studioPrompt, setStudioPrompt] = useState('');
  const [studioModel, setStudioModel] = useState<'flux' | 'sdxl'>('flux');
  const [studioLoading, setStudioLoading] = useState(false);
  const [studioImages, setStudioImages] = useState<Array<{ url: string; prompt: string; created: number }>>([]);
  const [studioSelectedKey, setStudioSelectedKey] = useState<string>('');

  // Playground state
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant' | 'system'; content: string }>>([
    { role: 'system', content: VPSQL_SYSTEM_PROMPT }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [selectedPlaygroundKey, setSelectedPlaygroundKey] = useState<string>('');
  const [lightboxImg, setLightboxImg] = useState<ImagePreviewData | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Load saved chat history from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CHAT_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const userAssistantOnly = parsed.filter((m: any) => m.role === 'user' || m.role === 'assistant');
          if (userAssistantOnly.length > 0) {
            setChatMessages([
              { role: 'system', content: VPSQL_SYSTEM_PROMPT },
              ...userAssistantOnly
            ]);
          }
        }
      }
    } catch {}
  }, []);

  // Save chat history to localStorage whenever conversation updates
  useEffect(() => {
    if (chatLoading) return;
    try {
      const userAssistantOnly = chatMessages.filter(
        m => m.role === 'user' || (m.role === 'assistant' && m.content.trim() !== '')
      );
      if (userAssistantOnly.length > 0) {
        localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(userAssistantOnly));
      }
    } catch {}
  }, [chatMessages, chatLoading]);

  const handleClearChat = async () => {
    const ok = await showConfirm({
      title: 'Limpar Conversa',
      message: 'Deseja realmente limpar o histórico da conversa local? Todas as mensagens e imagens geradas nesta sessão serão removidas.',
      confirmText: 'Limpar Histórico',
      cancelText: 'Cancelar',
      danger: true
    });
    if (!ok) return;

    try {
      localStorage.removeItem(CHAT_STORAGE_KEY);
    } catch {}

    setChatMessages([
      { role: 'system', content: VPSQL_SYSTEM_PROMPT }
    ]);
    flash('Histórico da conversa reiniciado com sucesso.');
  };


  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    flash(`Copiado para a área de transferência!`);
    setTimeout(() => setCopied(null), 2000);
  };

  const loadKeys = useCallback(async () => {
    setLoadingKeys(true);
    try {
      const data = await api.listAIKeys();
      setKeys(data);
      if (data.length > 0 && !selectedPlaygroundKey) {
        setSelectedPlaygroundKey(data[0].id);
      }
    } catch (err: any) {
      flash(`Erro ao carregar chaves: ${err.message}`);
    } finally {
      setLoadingKeys(false);
    }
  }, [flash, selectedPlaygroundKey]);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatLoading]);

  const handleToggleKey = async (id: string, name: string, willActivate: boolean) => {
    try {
      const updated = await api.toggleAIKeyStatus(id);
      setKeys(prev => prev.map(k => k.id === id ? updated : k));
      flash(willActivate ? `✓ Chave "${name}" reativada com sucesso!` : `Chave "${name}" suspensa temporariamente.`);
    } catch (err: any) {
      flash(`Erro ao alterar status da chave: ${err.message}`);
    }
  };

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;
    setCreatingKey(true);
    try {
      const tools = newKeyTools
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

      const key = await api.createAIKey(
        newKeyName.trim(), 
        newKeyTenant.trim() || 'default', 
        tools.length > 0 ? tools : ['*'], 
        newKeyServices.length > 0 ? newKeyServices : ['*'],
        newKeyRpm
      );
      setCreatedKey(key);
      flash(`✓ Chave "${key.name}" criada com sucesso!`);
      await loadKeys();
    } catch (err: any) {
      flash(`Erro ao criar chave: ${err.message}`);
    } finally {
      setCreatingKey(false);
    }
  };

  const handleOpenEdit = (key: AIKeyData) => {
    setEditingKey(key);
    setEditKeyName(key.name);
    setEditKeyTenant(key.tenant_id || 'default');
    setEditKeyTools(key.allowed_tools && key.allowed_tools.length > 0 ? key.allowed_tools.join(', ') : '*');
    setEditKeyServices(key.allowed_services && key.allowed_services.length > 0 ? key.allowed_services : ['chat', 'images']);
    setEditKeyActive(key.is_active);
    setEditKeyRpm(key.rate_limit_rpm || 60);
    setEditModalOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editingKey) return;
    setSavingEdit(true);
    try {
      const tools = editKeyTools
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

      await api.updateAIKey(editingKey.id, {
        name: editKeyName.trim(),
        tenant_id: editKeyTenant.trim() || 'default',
        allowed_tools: tools.length > 0 ? tools : ['*'],
        allowed_services: editKeyServices.length > 0 ? editKeyServices : ['*'],
        rate_limit_rpm: editKeyRpm,
        is_active: editKeyActive,
      });

      flash(`✓ Chave "${editKeyName}" atualizada com sucesso!`);
      setEditModalOpen(false);
      await loadKeys();
    } catch (err: any) {
      flash(`Erro ao atualizar chave: ${err.message}`);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleRotateKey = async (id: string, name: string) => {
    const ok = await showConfirm({
      title: `Rotacionar chave "${name}"?`,
      description: 'O token vpsql_sk_live_... atual será revogado imediatamente e um novo token secreto será emitido para este mesmo escopo de ferramentas e rate limits.',
      confirmText: 'Rotacionar Chave',
      variant: 'warning',
    });
    if (!ok) return;

    try {
      const updated = await api.rotateAIKey(id);
      setCreatedKey(updated);
      flash(`✓ Chave "${name}" rotacionada com sucesso!`);
      await loadKeys();
    } catch (err: any) {
      flash(`Erro ao rotacionar chave: ${err.message}`);
    }
  };

  const handleDeleteKey = async (id: string, name: string) => {
    const ok = await showConfirm({
      title: `Excluir definitivamente chave "${name}"?`,
      description: 'Esta chave será apagada do banco. Aplicações que a utilizam receberão HTTP 401 imediatamente.',
      confirmText: 'Excluir Definitivamente',
      variant: 'danger',
    });
    if (!ok) return;

    try {
      await api.deleteAIKey(id);
      flash(`✓ Chave "${name}" excluída.`);
      await loadKeys();
    } catch (err: any) {
      flash(`Erro ao excluir chave: ${err.message}`);
    }
  };

  const handleGenerateStudioImage = async () => {
    if (!studioPrompt.trim() || studioLoading) return;
    setStudioLoading(true);
    try {
      const keyObj = keys.find(k => k.id === studioSelectedKey) || keys.find(k => k.is_active);
      const res = await api.generateAIImage(studioPrompt.trim(), studioModel, keyObj?.raw_key);
      const generatedUrl = res?.data?.[0]?.url;
      if (generatedUrl) {
        const newImg = {
          url: generatedUrl,
          prompt: studioPrompt.trim(),
          created: res.created || Date.now() / 1000,
        };
        setStudioImages(prev => [newImg, ...prev]);
        flash('✓ Imagem gerada com sucesso via Cloudflare FLUX e salva no Dokploy!');
      } else {
        flash('Nenhuma imagem retornada.');
      }
    } catch (err: any) {
      flash(`Erro ao gerar imagem: ${err.message}`);
    } finally {
      setStudioLoading(false);
    }
  };

  // Playground Chat Streaming
  const handleSendChatMessage = async () => {
    if (!chatInput.trim() || chatLoading) return;
    if (!workerStatus?.online) {
      flash('O worker de IA está offline no momento.');
      return;
    }

    const userMsg = chatInput.trim();
    setChatInput('');
    const newHistory = [...chatMessages, { role: 'user' as const, content: userMsg }];
    setChatMessages(newHistory);
    setChatLoading(true);

    // Append empty assistant message for streaming
    setChatMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    try {
      const adminToken = typeof window !== 'undefined' ? localStorage.getItem('vpsql_token') || '' : '';
      const base = getApiBaseUrl();

      // Ensure system prompt is always present and bound context to recent turns (last 20 messages)
      const systemMsg = newHistory.find(m => m.role === 'system') || { role: 'system' as const, content: VPSQL_SYSTEM_PROMPT };
      const nonSystem = newHistory.filter(m => m.role !== 'system');
      const messagesToSend = [systemMsg, ...nonSystem.slice(-20)];

      const res = await fetch(`${base}/v1/ai/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          model: 'qwen',
          messages: messagesToSend,
          stream: true,
        }),
      });


      if (!res.ok) {
        let errTxt = `HTTP ${res.status}`;
        try {
          const errJson = await res.json();
          errTxt = errJson?.error?.message || JSON.stringify(errJson);
        } catch {
          errTxt = await res.text();
        }
        setChatMessages(prev => {
          const next = [...prev];
          next[next.length - 1] = { role: 'assistant', content: `[Erro: ${errTxt}]` };
          return next;
        });
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6);
            if (dataStr === '[DONE]') continue;
            try {
              const data = JSON.parse(dataStr);
              const delta = data?.choices?.[0]?.delta?.content || '';
              if (delta) {
                fullContent += delta;
                setChatMessages(prev => {
                  const next = [...prev];
                  next[next.length - 1] = { role: 'assistant', content: fullContent };
                  return next;
                });
              }
            } catch {}
          }
        }
      }
    } catch (err: any) {
      setChatMessages(prev => {
        const next = [...prev];
        next[next.length - 1] = { role: 'assistant', content: `[Erro de conexão: ${err.message}]` };
        return next;
      });
    } finally {
      setChatLoading(false);
    }
  };

  const publicGatewayUrl = 'https://vpsql.example.com/v1/ai';

  return (
    <div className="flex flex-col gap-6 animate-vpsql-fade">
      {/* 1. Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-[20px] font-semibold tracking-tight text-[#EDEDED] flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-[#C77DFF]" />
              AI Gateway &amp; LLM Distribution
            </h1>
            <span className="flex items-center gap-1 text-[11px] font-mono text-[#C77DFF] border border-[#C77DFF]/30 bg-[#C77DFF]/10 rounded px-2 py-0.5">
              ● OpenAI Compatible
            </span>
          </div>
          <p className="text-[13px] text-[#8A8A93] mt-1">
            Distribua modelos de IA efêmeros com isolamento por Tenant, controle de ferramentas MCP e chaves virtuais.
          </p>
        </div>

        <button
          onClick={() => {
            onRefreshStatus();
            loadKeys();
          }}
          disabled={loadingStatus || loadingKeys}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-[#8A8A93] hover:text-[#EDEDED] text-[12px] font-mono transition cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingStatus ? 'animate-spin text-[#C77DFF]' : ''}`} />
          <span>Recarregar</span>
        </button>
      </div>

      {/* 2. Top Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
        {/* Card 1: Worker Status */}
        <div className="p-4 rounded-xl border border-white/[0.08] bg-white/[0.02] flex flex-col justify-between relative overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-mono uppercase tracking-wider text-[#8A8A93] flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-[#C77DFF]" />
              Provedor de IA (Cloudflare / Colab)
            </span>
            <span className={`flex items-center gap-1.5 text-[10.5px] font-mono px-2 py-0.5 rounded-full border ${
              workerStatus?.online 
                ? 'bg-[#4BFF8F]/10 border-[#4BFF8F]/30 text-[#4BFF8F]'
                : 'bg-white/[0.05] border-white/10 text-[#8A8A93]'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${workerStatus?.online ? 'bg-[#4BFF8F] animate-pulse' : 'bg-[#5A5A63]'}`} />
              {workerStatus?.online ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>

          <div>
            <div className="text-[14px] font-semibold text-[#EDEDED] font-mono truncate">
              {workerStatus?.model || 'Qwen 2.5 / Meta Llama 3.3'}
            </div>
            <div className="text-[11.5px] font-mono text-[#8A8A93] mt-1 truncate">
              {workerStatus?.online ? (
                <span className="text-[#85B7EB] flex items-center gap-1 truncate">
                  <ExternalLink className="w-3 h-3 flex-shrink-0" />
                  {workerStatus.url}
                </span>
              ) : (
                <span className="text-[#5A5A63]">Nenhum provedor ativo (Colab ou Cloudflare)</span>
              )}
            </div>
          </div>

          <div className="mt-3 pt-2.5 border-t border-white/[0.06] flex items-center justify-between text-[11px] font-mono text-[#5A5A63]">
            <span>Conexão:</span>
            <span className="text-[#E4C381]">
              {workerStatus?.online 
                ? (workerStatus.url?.includes('Cloudflare') || workerStatus.url?.includes('cloudflare') ? 'Serverless Edge (Sempre Ativo)' : `${workerStatus.ttl}s restantes`) 
                : 'Offline'}
            </span>
          </div>
        </div>

        {/* Card 2: Gateway Endpoint */}
        <div className="p-4 rounded-xl border border-white/[0.08] bg-white/[0.02] flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-mono uppercase tracking-wider text-[#8A8A93] flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-[#4BFF8F]" />
              Gateway Base URL
            </span>
            <button
              onClick={() => copyToClipboard(publicGatewayUrl, 'endpoint')}
              className="text-[10.5px] font-mono text-[#8A8A93] hover:text-[#4BFF8F] transition flex items-center gap-1 cursor-pointer"
            >
              {copied === 'endpoint' ? <Check className="w-3 h-3 text-[#4BFF8F]" /> : <Copy className="w-3 h-3" />}
              <span>{copied === 'endpoint' ? 'Copiado!' : 'Copiar'}</span>
            </button>
          </div>

          <div>
            <div className="text-[13px] font-semibold text-[#4BFF8F] font-mono truncate">
              {publicGatewayUrl}
            </div>
            <div className="text-[11px] font-mono text-[#8A8A93] mt-1">
              POST /chat/completions (OpenAI SDK drop-in)
            </div>
          </div>

          <div className="mt-3 pt-2.5 border-t border-white/[0.06] flex items-center justify-between text-[11px] font-mono text-[#5A5A63]">
            <span>Protocolo:</span>
            <span className="text-[#EDEDED]">SSE Real-time Passthrough</span>
          </div>
        </div>

        {/* Card 3: Security & Access */}
        <div className="p-4 rounded-xl border border-white/[0.08] bg-white/[0.02] flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-mono uppercase tracking-wider text-[#8A8A93] flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-[#5B8CFF]" />
              Controle de Acesso &amp; MCPs
            </span>
            <span className="text-[10.5px] font-mono text-[#5B8CFF] bg-[#5B8CFF]/10 px-2 py-0.5 rounded border border-[#5B8CFF]/20">
              Isolamento por Tenant
            </span>
          </div>

          <div>
            <div className="text-[14px] font-semibold text-[#EDEDED] font-mono">
              {keys.length} {keys.length === 1 ? 'Chave ativa' : 'Chaves ativas'}
            </div>
            <div className="text-[11px] font-mono text-[#8A8A93] mt-1">
              {keys.reduce((acc, k) => acc + (k.total_requests || 0), 0)} requisições processadas
            </div>
          </div>

          <div className="mt-3 pt-2.5 border-t border-white/[0.06] flex items-center justify-between text-[11px] font-mono text-[#5A5A63]">
            <span>Validação:</span>
            <span className="text-[#EDEDED]">Tenant + Tool Gating Ativo</span>
          </div>
        </div>
      </div>

      {/* 3. Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-white/[0.08] pb-1">
        <button
          onClick={() => setActiveTab('keys')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition cursor-pointer ${
            activeTab === 'keys'
              ? 'bg-white/[0.08] text-[#EDEDED]'
              : 'text-[#8A8A93] hover:text-[#EDEDED] hover:bg-white/[0.03]'
          }`}
        >
          <Key className="w-4 h-4 text-[#C77DFF]" />
          <span>Chaves &amp; Permissões de MCP ({keys.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('playground')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition cursor-pointer ${
            activeTab === 'playground'
              ? 'bg-white/[0.08] text-[#EDEDED]'
              : 'text-[#8A8A93] hover:text-[#EDEDED] hover:bg-white/[0.03]'
          }`}
        >
          <Bot className="w-4 h-4 text-[#4BFF8F]" />
          <span>Playground de Chat</span>
          {workerStatus?.online && (
            <span className="w-2 h-2 rounded-full bg-[#4BFF8F]" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('studio')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition cursor-pointer ${
            activeTab === 'studio'
              ? 'bg-white/[0.08] text-[#EDEDED]'
              : 'text-[#8A8A93] hover:text-[#EDEDED] hover:bg-white/[0.03]'
          }`}
        >
          <ImageIcon className="w-4 h-4 text-[#FF70A6]" />
          <span>Estúdio de Imagens (FLUX)</span>
        </button>

        <button
          onClick={() => setActiveTab('snippets')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition cursor-pointer ${
            activeTab === 'snippets'
              ? 'bg-white/[0.08] text-[#EDEDED]'
              : 'text-[#8A8A93] hover:text-[#EDEDED] hover:bg-white/[0.03]'
          }`}
        >
          <Terminal className="w-4 h-4 text-[#85B7EB]" />
          <span>Guia de Conexão &amp; SDKs</span>
        </button>
      </div>

      {/* 4. Tab Content */}
      {/* TAB 1: KEYS */}
      {activeTab === 'keys' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-[15px] font-semibold text-[#EDEDED]">Chaves Virtuais e Escopos de Tenant</h2>
              <p className="text-[12px] text-[#8A8A93]">
                Defina exatamente quais ferramentas e MCPs cada chave de API pode acionar.
              </p>
            </div>

            <button
              onClick={() => {
                setCreatedKey(null);
                setNewKeyName('');
                setNewKeyTenant('default');
                setNewKeyTools('*');
                setNewKeyRpm(60);
                setCreateModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#C77DFF] hover:bg-[#b86df0] text-black text-[12.5px] font-semibold transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Criar Nova Chave</span>
            </button>
          </div>

          <div className="border border-white/[0.08] rounded-xl bg-[#09090B] overflow-hidden">
            {loadingKeys && keys.length === 0 ? (
              <div className="p-8 text-center text-[#5A5A63] font-mono text-[12px]">
                Carregando chaves de acesso...
              </div>
            ) : keys.length === 0 ? (
              <div className="p-10 text-center flex flex-col items-center justify-center gap-2">
                <ShieldCheck className="w-8 h-8 text-[#5A5A63]" />
                <p className="text-[13px] text-[#EDEDED] font-medium">Nenhuma chave criada ainda</p>
                <p className="text-[12px] text-[#8A8A93] max-w-sm">
                  Crie sua primeira chave virtual para autenticar aplicações no AI Gateway.
                </p>
                <button
                  onClick={() => setCreateModalOpen(true)}
                  className="mt-2 px-3 py-1.5 rounded-lg bg-white/[0.05] border border-white/10 text-[#C77DFF] hover:text-white text-[12px] font-mono transition cursor-pointer"
                >
                  + Criar primeira chave
                </button>
              </div>
            ) : (
              <table className="w-full text-left font-mono text-[11.5px]">
                <thead className="bg-[#0C0C0F] border-b border-white/10 text-[#8A8A93]">
                  <tr>
                    <th className="px-4 py-2.5">Nome / Aplicação</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Serviços</th>
                    <th className="px-4 py-2.5">Tenant</th>
                    <th className="px-4 py-2.5">Identificador</th>
                    <th className="px-4 py-2.5">MCPs Autorizadas</th>
                    <th className="px-4 py-2.5">Cota (RPM)</th>
                    <th className="px-4 py-2.5">Requisições</th>
                    <th className="px-4 py-2.5">Último Acesso</th>
                    <th className="px-4 py-2.5 text-center">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map(k => (
                    <tr key={k.id} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                      <td className="px-4 py-2 text-[#EDEDED] font-semibold">{k.name}</td>
                      <td className="px-4 py-2">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10.5px] font-mono border ${
                          k.is_active 
                            ? 'bg-[#4BFF8F]/10 border-[#4BFF8F]/30 text-[#4BFF8F]' 
                            : 'bg-[#FF5C5C]/10 border-[#FF5C5C]/30 text-[#FF5C5C]'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${k.is_active ? 'bg-[#4BFF8F]' : 'bg-[#FF5C5C]'}`} />
                          {k.is_active ? 'Ativa' : 'Suspensa'}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-[11px]">
                        <div className="flex items-center gap-1 flex-wrap">
                          {(!k.allowed_services || k.allowed_services.includes('*') || k.allowed_services.includes('chat')) && (
                            <span className="text-[#85B7EB] bg-[#85B7EB]/10 px-1.5 py-0.5 rounded text-[10px] border border-[#85B7EB]/20 flex items-center gap-1">
                              <MessageSquare className="w-2.5 h-2.5" /> Chat
                            </span>
                          )}
                          {(!k.allowed_services || k.allowed_services.includes('*') || k.allowed_services.includes('images')) && (
                            <span className="text-[#FF70A6] bg-[#FF70A6]/10 px-1.5 py-0.5 rounded text-[10px] border border-[#FF70A6]/20 flex items-center gap-1">
                              <ImageIcon className="w-2.5 h-2.5" /> Imagens
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <span className="px-2 py-0.5 rounded text-[10.5px] bg-[#5B8CFF]/10 border border-[#5B8CFF]/20 text-[#85B7EB]">
                          {k.tenant_id || 'default'}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-[#C77DFF] font-mono">{k.key_prefix}</td>
                      <td className="px-4 py-2 font-mono text-[11px]">
                        {k.allowed_tools?.includes('*') || !k.allowed_tools || k.allowed_tools.length === 0 ? (
                          <span className="text-[#4BFF8F] bg-[#4BFF8F]/10 px-1.5 py-0.5 rounded text-[10px] border border-[#4BFF8F]/20">
                            Todas (*)
                          </span>
                        ) : (
                          <div className="flex items-center gap-1 flex-wrap max-w-xs">
                            {k.allowed_tools.map(tool => (
                              <span key={tool} className="text-[#C77DFF] bg-[#C77DFF]/10 px-1.5 py-0.5 rounded text-[10px] border border-[#C77DFF]/20">
                                {tool}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-[#8A8A93]">{k.rate_limit_rpm} req/min</td>
                      <td className="px-4 py-2 text-[#EDEDED]">{k.total_requests || 0}</td>
                      <td className="px-4 py-2 text-[#8A8A93]">
                        {k.last_used_at ? new Date(k.last_used_at).toLocaleString('pt-BR') : 'Nunca usada'}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => handleToggleKey(k.id, k.name, !k.is_active)}
                            className={`p-1.5 rounded transition cursor-pointer ${
                              k.is_active 
                                ? 'text-[#8A8A93] hover:text-[#FFB020] hover:bg-[#FFB020]/10' 
                                : 'text-[#4BFF8F] hover:text-[#3ce07b] hover:bg-[#4BFF8F]/10'
                            }`}
                            title={k.is_active ? 'Bloquear temporariamente (ex: falta de pagamento)' : 'Reativar chave de API'}
                          >
                            {k.is_active ? <PauseCircle className="w-3.5 h-3.5" /> : <PlayCircle className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={() => handleOpenEdit(k)}
                            className="text-[#8A8A93] hover:text-[#EDEDED] hover:bg-white/10 p-1.5 rounded transition cursor-pointer"
                            title="Editar permissões, serviços e MCPs"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleRotateKey(k.id, k.name)}
                            className="text-[#8A8A93] hover:text-[#FFB020] hover:bg-[#FFB020]/10 p-1.5 rounded transition cursor-pointer"
                            title="Rotacionar token secreto (invalida chave antiga)"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteKey(k.id, k.name)}
                            className="text-[#8A8A93] hover:text-[#FF5C5C] hover:bg-[#FF5C5C]/10 p-1.5 rounded transition cursor-pointer"
                            title="Excluir definitivamente"
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

      {/* TAB 2: PLAYGROUND */}
      {activeTab === 'playground' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-[15px] font-semibold text-[#EDEDED] flex items-center gap-2">
                <Bot className="w-4 h-4 text-[#4BFF8F]" />
                Testar Modelo ao Vivo (Playground)
              </h2>
              <p className="text-[12px] text-[#8A8A93]">
                Envie perguntas para a instância efêmera da Qwen 2.5 14B com streaming direto no navegador.
              </p>
            </div>

            <div className="flex items-center gap-2">
              {chatMessages.filter(m => m.role !== 'system').length > 0 && (
                <button
                  type="button"
                  onClick={handleClearChat}
                  title="Limpar histórico da conversa e reiniciar sessão"
                  className="px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-white/20 text-[#8A8A93] hover:text-[#EDEDED] text-[11px] font-mono flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Trash2 className="w-3 h-3 text-[#FF5C5C]" />
                  <span>Nova Conversa</span>
                </button>
              )}
              <span className={`text-[11px] font-mono px-2.5 py-1 rounded-lg border ${
                workerStatus?.online 
                  ? 'bg-[#4BFF8F]/10 border-[#4BFF8F]/30 text-[#4BFF8F]'
                  : 'bg-[#FF5C5C]/10 border-[#FF5C5C]/30 text-[#FF5C5C]'
              }`}>
                {workerStatus?.online ? `● Ativo (${workerStatus.model})` : '✕ Provedor Offline'}
              </span>
            </div>

          </div>

          {/* Chat Window */}
          <div className="border border-white/[0.08] rounded-2xl bg-[#09090B] flex flex-col h-[560px] overflow-hidden">
            {/* Messages Scroll Area */}
            <div className="flex-1 p-5 overflow-y-auto flex flex-col gap-3.5">
              {chatMessages.filter(m => m.role !== 'system').length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center gap-3 text-[#5A5A63]">
                  <Sparkles className="w-8 h-8 text-[#C77DFF]/50" />
                  <p className="text-[13px] text-[#EDEDED] font-medium">Faça sua primeira pergunta ao modelo</p>
                  <p className="text-[11.5px] max-w-sm text-[#8A8A93]">
                    O streaming de tokens é entregue em tempo real através do túnel Cloudflare configurado no Colab.
                  </p>
                  <div className="flex items-center gap-2 mt-2 flex-wrap justify-center">
                    <button
                      onClick={() => setChatInput('Explique em 3 frases como o VPSQL AI Gateway funciona.')}
                      className="px-2.5 py-1 rounded-lg bg-white/[0.03] border border-white/10 hover:border-white/20 text-[#85B7EB] text-[11px] font-mono transition cursor-pointer"
                    >
                      &quot;Como o VPSQL AI Gateway funciona?&quot;
                    </button>
                    <button
                      onClick={() => setChatInput('Escreva uma query SQL PostgreSQL com Window Function para calcular saldo acumulado.')}
                      className="px-2.5 py-1 rounded-lg bg-white/[0.03] border border-white/10 hover:border-white/20 text-[#4BFF8F] text-[11px] font-mono transition cursor-pointer"
                    >
                      &quot;Query SQL com Window Function&quot;
                    </button>
                    <button
                      onClick={() => setChatInput('Gere uma imagem de uma maçã verde futurista.')}
                      className="px-2.5 py-1 rounded-lg bg-white/[0.03] border border-white/10 hover:border-white/20 text-[#C77DFF] text-[11px] font-mono transition cursor-pointer flex items-center gap-1.5"
                    >
                      <ImageIcon className="w-3 h-3" /> &quot;Gere uma imagem (Maçã Verde)&quot;
                    </button>
                  </div>
                </div>
              ) : (
                chatMessages
                  .filter(m => m.role !== 'system')
                  .map((m, idx) => (
                    <div
                      key={idx}
                      className={`flex flex-col ${
                        m.role === 'user' ? 'items-end' : 'items-start'
                      }`}
                    >
                      <span className="text-[10px] font-mono text-[#5A5A63] mb-1 px-1">
                        {m.role === 'user' ? 'Você' : 'Qwen 2.5 (14B)'}
                      </span>
                      <div
                        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed font-sans ${
                          m.role === 'user'
                            ? 'bg-[#C77DFF] text-black font-medium'
                            : 'bg-white/[0.04] border border-white/10 text-[#EDEDED]'
                        }`}
                      >
                        <ChatMessageContent
                          content={m.content}
                          role={m.role}
                          onOpenImage={img => setLightboxImg(img)}
                          flash={flash}
                        />
                      </div>
                    </div>
                  ))
              )}
              <div ref={chatBottomRef} />
            </div>

            {/* Input Bar */}
            <div className="p-3 border-t border-white/[0.08] bg-[#0C0C0F] flex items-center gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendChatMessage();
                  }
                }}
                disabled={chatLoading || !workerStatus?.online}
                placeholder={
                  workerStatus?.online 
                    ? `Digite sua mensagem para ${workerStatus.model}...` 
                    : "Provedor offline. Defina CF_ACCOUNT_ID e CF_API_TOKEN no Dokploy ou inicie o Colab."
                }
                className="flex-1 px-4 py-2.5 rounded-xl bg-[#121217] border border-white/15 text-[#EDEDED] text-[13px] outline-none focus:border-[#C77DFF] transition disabled:opacity-50"
              />
              <button
                onClick={handleSendChatMessage}
                disabled={chatLoading || !chatInput.trim() || !workerStatus?.online}
                className="px-4 py-2.5 rounded-xl bg-[#4BFF8F] hover:bg-[#3ce07b] text-black font-semibold text-[13px] transition flex items-center gap-1.5 disabled:opacity-40 cursor-pointer"
              >
                {chatLoading ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                <span>Enviar</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB: ESTÚDIO DE IMAGENS (FLUX / CLOUDFLARE) */}
      {activeTab === 'studio' && (
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-[15px] font-semibold text-[#EDEDED] flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-[#FF70A6]" />
                Estúdio de Geração de Imagens com IA
              </h2>
              <p className="text-[12px] text-[#8A8A93]">
                Gere imagens em alta resolução com Cloudflare Workers AI (FLUX &amp; SDXL) salvas de forma perpétua no volume Dokploy.
              </p>
            </div>

            <div className="flex items-center gap-2 font-mono text-[11px]">
              <span className="px-2.5 py-1 rounded-lg border border-[#FF70A6]/30 bg-[#FF70A6]/10 text-[#FF70A6] flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5" />
                <span>FLUX.1 Schnell &amp; SDXL</span>
              </span>
              <span className="px-2.5 py-1 rounded-lg border border-white/10 bg-white/[0.03] text-[#8A8A93]">
                /v1/ai/images/generations
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Coluna 1: Formulário de Criação (5 cols) */}
            <div className="lg:col-span-5 flex flex-col gap-4 border border-white/[0.08] rounded-2xl bg-[#09090B] p-4">
              <div>
                <label className="block font-mono text-[11px] uppercase tracking-wider text-[#8A8A93] mb-1.5">
                  Modelo de Imagem
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setStudioModel('flux')}
                    className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                      studioModel === 'flux'
                        ? 'border-[#FF70A6] bg-[#FF70A6]/10 text-[#EDEDED]'
                        : 'border-white/10 bg-white/[0.02] text-[#8A8A93] hover:border-white/20'
                    }`}
                  >
                    <div className="text-[12px] font-semibold flex items-center justify-between">
                      <span>FLUX-1-schnell</span>
                      {studioModel === 'flux' && <Check className="w-3.5 h-3.5 text-[#FF70A6]" />}
                    </div>
                    <div className="text-[10.5px] font-mono text-[#8A8A93] mt-0.5">
                      Black Forest Labs • 4 steps
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setStudioModel('sdxl')}
                    className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                      studioModel === 'sdxl'
                        ? 'border-[#C77DFF] bg-[#C77DFF]/10 text-[#EDEDED]'
                        : 'border-white/10 bg-white/[0.02] text-[#8A8A93] hover:border-white/20'
                    }`}
                  >
                    <div className="text-[12px] font-semibold flex items-center justify-between">
                      <span>SDXL Lightning</span>
                      {studioModel === 'sdxl' && <Check className="w-3.5 h-3.5 text-[#C77DFF]" />}
                    </div>
                    <div className="text-[10.5px] font-mono text-[#8A8A93] mt-0.5">
                      Stability AI • Base 1.0
                    </div>
                  </button>
                </div>
              </div>

              <div>
                <label className="block font-mono text-[11px] uppercase tracking-wider text-[#8A8A93] mb-1.5">
                  Chave de API para Autenticação
                </label>
                <select
                  value={studioSelectedKey}
                  onChange={e => setStudioSelectedKey(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#121217] border border-white/15 text-[#EDEDED] font-mono text-[12px] outline-none focus:border-[#FF70A6] transition"
                >
                  <option value="">Chave do Administrador Ativa (Padrão)</option>
                  {keys.map(k => (
                    <option key={k.id} value={k.id} disabled={!k.is_active}>
                      {k.name} ({k.key_prefix}) {!k.is_active ? '[SUSPENSA]' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-mono text-[11px] uppercase tracking-wider text-[#8A8A93]">
                    Prompt de Geração
                  </label>
                  <span className="text-[10.5px] font-mono text-[#5A5A63]">Inglês recomendado</span>
                </div>
                <textarea
                  rows={4}
                  value={studioPrompt}
                  onChange={e => setStudioPrompt(e.target.value)}
                  placeholder="Ex: A futuristic neon glass apple floating over a dark reflective database server room, 8k resolution, volumetric light, highly detailed..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#121217] border border-white/15 text-[#EDEDED] text-[12.5px] outline-none focus:border-[#FF70A6] transition resize-none"
                />

                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setStudioPrompt('A futuristic green apple with glowing neon microchips floating inside a dark database server, 8k render, octane render style')}
                    className="px-2 py-0.5 rounded text-[10.5px] font-mono bg-white/[0.04] text-[#8A8A93] hover:text-[#FF70A6] hover:bg-white/[0.08] transition"
                  >
                    + Maçã Futurista
                  </button>
                  <button
                    type="button"
                    onClick={() => setStudioPrompt('PostgreSQL glowing blue elephant mascot surrounded by neon circuits and database streams, high definition wallpaper')}
                    className="px-2 py-0.5 rounded text-[10.5px] font-mono bg-white/[0.04] text-[#8A8A93] hover:text-[#4BFF8F] hover:bg-white/[0.08] transition"
                  >
                    + Mascote PostgreSQL
                  </button>
                  <button
                    type="button"
                    onClick={() => setStudioPrompt('Cyberpunk command center with high-tech dashboard, holographic charts, dark sleek minimalism')}
                    className="px-2 py-0.5 rounded text-[10.5px] font-mono bg-white/[0.04] text-[#8A8A93] hover:text-[#85B7EB] hover:bg-white/[0.08] transition"
                  >
                    + Cyberpunk Dashboard
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={handleGenerateStudioImage}
                disabled={studioLoading || !studioPrompt.trim()}
                className="mt-2 w-full py-3 rounded-xl bg-gradient-to-r from-[#FF70A6] to-[#C77DFF] hover:opacity-95 text-black font-semibold text-[13px] transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {studioLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Gerando imagem via Cloudflare...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Gerar Imagem com {studioModel === 'flux' ? 'FLUX' : 'SDXL'}</span>
                  </>
                )}
              </button>

              <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] text-[11px] text-[#8A8A93] flex flex-col gap-1 font-mono">
                <span className="text-[#EDEDED] font-semibold flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#4BFF8F]" /> Armazenamento Dokploy
                </span>
                <span>As imagens são salvas em volume montado <code>/data/images</code> e acessadas publicamente via HTTPS com cache HTTP de 30 dias.</span>
              </div>
            </div>

            {/* Coluna 2: Resultado Principal e Histórico (7 cols) */}
            <div className="lg:col-span-7 flex flex-col gap-4">
              {/* Preview Atual */}
              <div className="border border-white/[0.08] rounded-2xl bg-[#09090B] p-4 flex flex-col min-h-[380px]">
                <div className="flex items-center justify-between pb-3 border-b border-white/[0.08] mb-3">
                  <span className="font-mono text-[12px] text-[#8A8A93] flex items-center gap-1.5">
                    <ImageIcon className="w-3.5 h-3.5 text-[#FF70A6]" />
                    Visualização &amp; Renderização
                  </span>
                  {studioImages.length > 0 && (
                    <span className="font-mono text-[11px] text-[#4BFF8F] bg-[#4BFF8F]/10 border border-[#4BFF8F]/20 px-2 py-0.5 rounded">
                      {studioImages.length} {studioImages.length === 1 ? 'imagem gerada' : 'imagens geradas'}
                    </span>
                  )}
                </div>

                {studioLoading ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-8 gap-3">
                    <div className="relative">
                      <div className="w-16 h-16 rounded-full border-2 border-[#FF70A6]/30 border-t-[#FF70A6] animate-spin" />
                      <Sparkles className="w-6 h-6 text-[#FF70A6] absolute inset-0 m-auto animate-pulse" />
                    </div>
                    <div className="text-[13px] font-medium text-[#EDEDED]">Processando nos nós Cloudflare Workers AI...</div>
                    <div className="text-[11.5px] font-mono text-[#8A8A93] max-w-sm">
                      O modelo FLUX.1 sintetiza pixels em múltiplos steps e persiste o arquivo PNG no volume Dokploy.
                    </div>
                  </div>
                ) : studioImages.length > 0 ? (
                  <div className="flex flex-col gap-3">
                    <div className="relative rounded-xl overflow-hidden border border-white/10 group bg-black/40 max-h-[420px] flex items-center justify-center">
                      <img
                        src={studioImages[0].url}
                        alt={studioImages[0].prompt}
                        className="w-full h-auto max-h-[420px] object-contain rounded-xl cursor-pointer hover:opacity-95 transition"
                        onClick={() => setLightboxImg({ url: studioImages[0].url, alt: studioImages[0].prompt })}
                      />
                      <div className="absolute top-3 right-3 flex items-center gap-1.5 opacity-90 group-hover:opacity-100 transition">
                        <button
                          onClick={() => copyToClipboard(studioImages[0].url, 'studio_img_url')}
                          className="px-2.5 py-1.5 rounded-lg bg-black/70 hover:bg-black/90 backdrop-blur-md border border-white/20 text-[#EDEDED] text-[11px] font-mono flex items-center gap-1 cursor-pointer"
                          title="Copiar URL perpétua"
                        >
                          {copied === 'studio_img_url' ? <Check className="w-3 h-3 text-[#4BFF8F]" /> : <Copy className="w-3 h-3" />}
                          <span>{copied === 'studio_img_url' ? 'Copiado!' : 'Copiar URL'}</span>
                        </button>
                        <button
                          onClick={() => setLightboxImg({ url: studioImages[0].url, alt: studioImages[0].prompt })}
                          className="p-1.5 rounded-lg bg-black/70 hover:bg-black/90 backdrop-blur-md border border-white/20 text-[#EDEDED] text-[11px] font-mono cursor-pointer"
                          title="Expandir Imagem"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] flex flex-col gap-2">
                      <div className="text-[12px] text-[#EDEDED] font-medium leading-relaxed">
                        &quot;{studioImages[0].prompt}&quot;
                      </div>
                      <div className="flex items-center justify-between text-[11px] font-mono text-[#8A8A93] pt-1 border-t border-white/[0.04]">
                        <span className="truncate max-w-[320px] text-[#85B7EB]">{studioImages[0].url}</span>
                        <span>{new Date(studioImages[0].created * 1000).toLocaleTimeString('pt-BR')}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-8 gap-3 text-[#5A5A63]">
                    <ImageIcon className="w-10 h-10 text-white/10" />
                    <p className="text-[13px] text-[#EDEDED] font-medium">Nenhuma imagem gerada nesta sessão</p>
                    <p className="text-[11.5px] max-w-sm text-[#8A8A93]">
                      Escolha o modelo, digite uma descrição e clique em &quot;Gerar Imagem&quot; para criar e persistir arquivos gráficos no Dokploy.
                    </p>
                  </div>
                )}
              </div>

              {/* Galeria de Histórico */}
              {studioImages.length > 1 && (
                <div className="border border-white/[0.08] rounded-2xl bg-[#09090B] p-4 flex flex-col gap-3">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-[#8A8A93]">
                    Galeria da Sessão ({studioImages.length})
                  </span>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                    {studioImages.map((img, i) => (
                      <div
                        key={i}
                        onClick={() => setLightboxImg({ url: img.url, alt: img.prompt })}
                        className="group relative aspect-square rounded-xl overflow-hidden border border-white/10 bg-black/30 cursor-pointer hover:border-[#FF70A6] transition"
                      >
                        <img src={img.url} alt={img.prompt} className="w-full h-full object-cover group-hover:scale-105 transition duration-300" />
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition flex items-center justify-center p-2 text-center">
                          <span className="text-[10px] text-white line-clamp-3 font-mono">{img.prompt}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: SNIPPETS */}
      {activeTab === 'snippets' && (
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-[15px] font-semibold text-[#EDEDED]">Como Integrar em suas Aplicações</h2>
            <p className="text-[12px] text-[#8A8A93]">
              Basta apontar a biblioteca oficial do OpenAI para o VPSQL e usar sua chave virtual escopada.
            </p>
          </div>

          {/* Lang Selector */}
          <div className="flex items-center gap-1 border-b border-white/[0.06] pb-2 flex-wrap">
            {[
              { id: 'python', label: 'Python (Chat & WinThor)' },
              { id: 'images', label: 'Imagens (FLUX / OpenAI SDK)' },
              { id: 'ts', label: 'TypeScript / Node' },
              { id: 'curl', label: 'cURL' },
              { id: 'colab', label: 'Script Python Colab (Heartbeat)' },
            ].map(l => (
              <button
                key={l.id}
                onClick={() => setSnippetLang(l.id as any)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-mono transition cursor-pointer ${
                  snippetLang === l.id
                    ? 'bg-white/[0.08] text-[#4BFF8F] font-semibold'
                    : 'text-[#8A8A93] hover:text-[#EDEDED]'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>

          <div className="relative rounded-xl border border-white/10 bg-[#070709] p-4 overflow-x-auto">
            <button
              onClick={() => {
                let code = '';
                if (snippetLang === 'python') {
                  code = `from openai import OpenAI\n\nclient = OpenAI(\n    base_url="${publicGatewayUrl}",\n    api_key="vpsql_sk_live_sua_chave_aqui"\n)\n\n# Chamada com tools/MCP escopados\nresponse = client.chat.completions.create(\n    model="qwen",\n    messages=[{"role": "user", "content": "Quanto vendemos ontem? Use a ferramenta."}],\n    tools=[\n        {\n            "type": "function",\n            "function": {\n                "name": "query_winthor",\n                "description": "Executa SQL no ERP WinThor",\n                "parameters": {\n                    "type": "object",\n                    "properties": {"sql": {"type": "string"}},\n                    "required": ["sql"],\n                },\n            },\n        }\n    ],\n    tool_choice="auto",\n)\n\nprint(response.choices[0].message.tool_calls)\n`;
                } else if (snippetLang === 'images') {
                  code = `from openai import OpenAI\n\n# 100% compatível com a OpenAI Images API\nclient = OpenAI(\n    base_url="${publicGatewayUrl}",\n    api_key="vpsql_sk_live_sua_chave_aqui"\n)\n\nresponse = client.images.generate(\n    model="@cf/black-forest-labs/flux-1-schnell",  # ou "flux", "sdxl"\n    prompt="A futuristic neon green apple in a database server room, 8k render",\n    n=1,\n    size="1024x1024"\n)\n\n# URL persistente salva no Dokploy (/data/images):\nimage_url = response.data[0].url\nprint("Imagem gerada:", image_url)\n`;
                } else if (snippetLang === 'ts') {
                  code = `import OpenAI from 'openai';\n\nconst openai = new OpenAI({\n  baseURL: '${publicGatewayUrl}',\n  apiKey: 'vpsql_sk_live_sua_chave_aqui',\n});\n\nasync function main() {\n  const res = await openai.chat.completions.create({\n    model: 'qwen',\n    messages: [{ role: 'user', content: 'Quanto vendemos ontem?' }],\n    tools: [{\n      type: 'function',\n      function: {\n        name: 'query_winthor',\n        description: 'Executa SQL no ERP WinThor',\n        parameters: {\n          type: 'object',\n          properties: { sql: { type: 'string' } },\n          required: ['sql']\n        }\n      }\n    }],\n  });\n  console.log(res.choices[0]?.message?.tool_calls);\n}\nmain();\n`;
                } else if (snippetLang === 'curl') {
                  code = `curl -X POST ${publicGatewayUrl}/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer vpsql_sk_live_sua_chave_aqui" \\\n  -d '{\n    "model": "qwen",\n    "messages": [{"role": "user", "content": "Quanto vendemos ontem?"}],\n    "tools": [{\n      "type": "function",\n      "function": {\n        "name": "query_winthor",\n        "description": "Executa SQL no WinThor",\n        "parameters": {\n          "type": "object",\n          "properties": {"sql": {"type": "string"}},\n          "required": ["sql"]\n        }\n      }\n    }],\n    "tool_choice": "auto"\n  }'\n`;
                } else {
                  code = `import redis, json, threading, time\n\nREDIS_URL = "redis://app_ia:CHANGE_ME@db.example.com:6380"\nCHAVE = "app_ia:llm:local:endpoint"\n\nAPI_URL = "https://repeated-live-uploaded-essays.trycloudflare.com"\nAPI_KEY = "vpsql_worker_key_here"\nMODEL = "Qwen/Qwen2.5-14B-Instruct"\n\nr = redis.from_url(REDIS_URL, decode_responses=True)\n_CURRENT_HB_ID = time.time()\n\ndef _heartbeat(my_id):\n    while _CURRENT_HB_ID == my_id:\n        try:\n            payload = {"url": API_URL, "api_key": API_KEY, "model": MODEL, "ts": int(time.time())}\n            r.set(CHAVE, json.dumps(payload), ex=90)\n        except Exception as e:\n            print("Erro no heartbeat:", e)\n        time.sleep(30)\n\nthreading.Thread(target=_heartbeat, args=(_CURRENT_HB_ID,), daemon=True).start()\nprint("✓ Heartbeat conectado ao VPSQL AI Gateway!")\n`;
                }
                copyToClipboard(code, 'snippet');
              }}
              className="absolute top-3.5 right-3.5 flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded bg-white/[0.04] text-[#8A8A93] hover:text-[#EDEDED] transition cursor-pointer"
            >
              {copied === 'snippet' ? <Check className="w-3 h-3 text-[#4BFF8F]" /> : <Copy className="w-3 h-3" />}
              <span>{copied === 'snippet' ? 'Copiado!' : 'Copiar Snippet'}</span>
            </button>

            <pre className="font-mono text-[12px] leading-relaxed text-[#EDEDED] whitespace-pre selection:bg-[#C77DFF]/20">
              {snippetLang === 'python' && `# 1. Instale: pip install openai
from openai import OpenAI

client = OpenAI(
    base_url="${publicGatewayUrl}",
    api_key="vpsql_sk_live_sua_chave_aqui"  # Crie na aba 'Chaves & Permissões'
)

# Chamada com tools/MCP escopados para o tenant
response = client.chat.completions.create(
    model="qwen",
    messages=[{"role": "user", "content": "Quanto vendemos ontem? Use a ferramenta."}],
    tools=[
        {
            "type": "function",
            "function": {
                "name": "query_winthor",
                "description": "Executa SQL no ERP WinThor",
                "parameters": {
                    "type": "object",
                    "properties": {"sql": {"type": "string"}},
                    "required": ["sql"],
                },
            },
        }
    ],
    tool_choice="auto",
)

# Qwen gera a chamada de ferramenta para o WinThor se autorizado para o Tenant:
print(response.choices[0].message.tool_calls)
`}

              {snippetLang === 'images' && `# 1. Instale: pip install openai
from openai import OpenAI

client = OpenAI(
    base_url="${publicGatewayUrl}",
    api_key="vpsql_sk_live_sua_chave_aqui"  # Requer permissão 'images'
)

# Geração de imagem com Cloudflare Workers AI FLUX-1-schnell
response = client.images.generate(
    model="@cf/black-forest-labs/flux-1-schnell",  # ou "flux", "sdxl"
    prompt="A futuristic neon green apple in a dark database server room, 8k render",
    n=1,
    size="1024x1024"
)

# URL persistente servida pelo volume Dokploy (/data/images):
image_url = response.data[0].url
print("URL gerada:", image_url)
# Ex: https://vpsql.example.com/v1/ai/images/view/img_78cceb42.png

# Chamada direta via cURL:
# curl -X POST ${publicGatewayUrl}/images/generations \\
#   -H "Content-Type: application/json" \\
#   -H "Authorization: Bearer vpsql_sk_live_sua_chave_aqui" \\
#   -d '{"prompt": "A futuristic neon apple", "model": "flux"}'
`}

              {snippetLang === 'ts' && `// 1. Instale: npm install openai
import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: '${publicGatewayUrl}',
  apiKey: 'vpsql_sk_live_sua_chave_aqui',
});

async function main() {
  const res = await openai.chat.completions.create({
    model: 'qwen',
    messages: [{ role: 'user', content: 'Quanto vendemos ontem?' }],
    tools: [{
      type: 'function',
      function: {
        name: 'query_winthor',
        description: 'Executa SQL no ERP WinThor',
        parameters: {
          type: 'object',
          properties: { sql: { type: 'string' } },
          required: ['sql']
        }
      }
    }],
    tool_choice: 'auto',
  });

  console.log(res.choices[0]?.message?.tool_calls);
}

main();
`}

              {snippetLang === 'curl' && `curl -X POST ${publicGatewayUrl}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer vpsql_sk_live_sua_chave_aqui" \\
  -d '{
    "model": "qwen",
    "messages": [
      {"role": "user", "content": "Quanto vendemos ontem? Use a ferramenta."}
    ],
    "tools": [{
      "type": "function",
      "function": {
        "name": "query_winthor",
        "description": "Executa SQL no WinThor",
        "parameters": {
          "type": "object",
          "properties": {"sql": {"type": "string"}},
          "required": ["sql"]
        }
      }
    }],
    "tool_choice": "auto"
  }'
`}

              {snippetLang === 'colab' && `# Script para rodar no Google Colab / Instância Spot
import redis, json, threading, time

REDIS_URL = "redis://app_ia:CHANGE_ME@db.example.com:6380"
CHAVE = "app_ia:llm:local:endpoint"

API_URL = "https://repeated-live-uploaded-essays.trycloudflare.com"
API_KEY = "vpsql_worker_key_here"
MODEL = "Qwen/Qwen2.5-14B-Instruct"

r = redis.from_url(REDIS_URL, decode_responses=True)
_CURRENT_HB_ID = time.time()

def _heartbeat(my_id):
    while _CURRENT_HB_ID == my_id:
        try:
            payload = {"url": API_URL, "api_key": API_KEY, "model": MODEL, "ts": int(time.time())}
            r.set(CHAVE, json.dumps(payload), ex=90)
            print(f"[{time.strftime('%H:%M:%S')}] ✓ Heartbeat ativo no VPSQL")
        except Exception as e:
            print("Erro no heartbeat:", e)
        time.sleep(30)

threading.Thread(target=_heartbeat, args=(_CURRENT_HB_ID,), daemon=True).start()
print("✓ Heartbeat conectado ao VPSQL AI Gateway!")
`}
            </pre>
          </div>
        </div>
      )}

      {/* MODAL: CREATE AI KEY */}
      {createModalOpen && (
        <div 
          onClick={() => setCreateModalOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
        >
          <div 
            onClick={e => e.stopPropagation()}
            className="w-full max-w-[500px] border border-white/10 rounded-2xl bg-[#0C0C0F] shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-white/[0.02]">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-[#C77DFF]/15 border border-[#C77DFF]/30 text-[#C77DFF]">
                  <Key className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-[15px] font-semibold text-[#EDEDED]">
                    {createdKey ? 'Chave de IA Gerada!' : 'Nova Chave de IA'}
                  </h2>
                  <p className="text-[11.5px] text-[#8A8A93] font-mono">VPSQL AI Gateway</p>
                </div>
              </div>
              <button
                onClick={() => setCreateModalOpen(false)}
                className="p-1.5 rounded-lg text-[#8A8A93] hover:text-[#EDEDED] hover:bg-white/10 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 flex flex-col gap-4">
              {createdKey ? (
                <div className="flex flex-col gap-3.5">
                  <div className="p-3 rounded-xl bg-[#4BFF8F]/10 border border-[#4BFF8F]/30 text-[#4BFF8F] text-[12px] font-mono flex items-center gap-2">
                    <Check className="w-4 h-4 flex-shrink-0" />
                    <span>Chave &quot;{createdKey.name}&quot; gerada com sucesso!</span>
                  </div>

                  <div>
                    <label className="block font-mono text-[11px] uppercase tracking-wider text-[#8A8A93] mb-1">
                      Sua Chave de Acesso (Copie agora)
                    </label>
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-[#070709] border border-white/15">
                      <code className="flex-1 font-mono text-[12px] text-[#C77DFF] break-all select-all">
                        {createdKey.raw_key}
                      </code>
                      <button
                        onClick={() => copyToClipboard(createdKey.raw_key || '', 'new_key')}
                        className="p-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-[#EDEDED] transition cursor-pointer"
                        title="Copiar Chave"
                      >
                        {copied === 'new_key' ? <Check className="w-4 h-4 text-[#4BFF8F]" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <p className="text-[11.5px] text-[#FFB020] flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    Esta chave não será exibida novamente por motivos de segurança.
                  </p>

                  <div className="flex justify-end pt-2">
                    <button
                      onClick={() => setCreateModalOpen(false)}
                      className="px-4 py-2 rounded-lg bg-white/[0.1] hover:bg-white/[0.15] text-[#EDEDED] text-[12.5px] transition cursor-pointer font-medium"
                    >
                      Entendido &amp; Fechar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div>
                    <label className="block font-mono text-[11px] uppercase tracking-wider text-[#8A8A93] mb-1">
                      Nome / Descrição da Aplicação
                    </label>
                    <input
                      type="text"
                      value={newKeyName}
                      onChange={e => setNewKeyName(e.target.value)}
                      placeholder="ex: WinThor Operacional, App Cliente A"
                      autoFocus
                      className="w-full px-3.5 py-2 rounded-lg bg-[#121217] border border-white/15 text-[#EDEDED] font-mono text-[12.5px] outline-none focus:border-[#C77DFF] transition"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-mono text-[11px] uppercase tracking-wider text-[#8A8A93] mb-1">
                        Tenant ID
                      </label>
                      <input
                        type="text"
                        value={newKeyTenant}
                        onChange={e => setNewKeyTenant(e.target.value)}
                        placeholder="default, winthor, cliente_a"
                        className="w-full px-3 py-1.5 rounded-lg bg-[#121217] border border-white/15 text-[#EDEDED] font-mono text-[12.5px] outline-none focus:border-[#C77DFF] transition"
                      />
                    </div>

                    <div>
                      <label className="block font-mono text-[11px] uppercase tracking-wider text-[#8A8A93] mb-1">
                        Limite RPM (req/min)
                      </label>
                      <input
                        type="number"
                        value={newKeyRpm}
                        onChange={e => setNewKeyRpm(Number(e.target.value))}
                        min={1}
                        placeholder="60"
                        className="w-full px-3 py-1.5 rounded-lg bg-[#121217] border border-white/15 text-[#EDEDED] font-mono text-[12.5px] outline-none focus:border-[#C77DFF] transition"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="font-mono text-[11px] uppercase tracking-wider text-[#8A8A93]">
                        MCPs &amp; Ferramentas Autorizadas
                      </label>
                      <span className="text-[10px] font-mono text-[#5A5A63]">* = todas</span>
                    </div>
                    <input
                      type="text"
                      value={newKeyTools}
                      onChange={e => setNewKeyTools(e.target.value)}
                      placeholder="* ou query_winthor, calc"
                      className="w-full px-3.5 py-2 rounded-lg bg-[#121217] border border-white/15 text-[#EDEDED] font-mono text-[12.5px] outline-none focus:border-[#C77DFF] transition"
                    />
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setNewKeyTools('*')}
                        className="px-2 py-0.5 rounded text-[10.5px] font-mono bg-white/[0.04] text-[#8A8A93] hover:text-[#4BFF8F] hover:bg-white/[0.08] transition cursor-pointer"
                      >
                        Todas (*)
                      </button>
                      <button
                        type="button"
                        onClick={() => setNewKeyTools(prev => prev && prev !== '*' ? `${prev}, janus:*` : 'janus:*')}
                        className="px-2 py-0.5 rounded text-[10.5px] font-mono bg-[#4BFF8F]/10 text-[#4BFF8F] hover:bg-[#4BFF8F]/20 transition cursor-pointer"
                      >
                        + janus:*
                      </button>
                      <button
                        type="button"
                        onClick={() => setNewKeyTools(prev => prev && prev !== '*' ? `${prev}, janus:read` : 'janus:read')}
                        className="px-2 py-0.5 rounded text-[10.5px] font-mono bg-[#5B8CFF]/10 text-[#5B8CFF] hover:bg-[#5B8CFF]/20 transition cursor-pointer"
                      >
                        + janus:read
                      </button>
                      <button
                        type="button"
                        onClick={() => setNewKeyTools(prev => prev && prev !== '*' ? `${prev}, vpsql:query` : 'vpsql:query')}
                        className="px-2 py-0.5 rounded text-[10.5px] font-mono bg-[#FFB020]/10 text-[#FFB020] hover:bg-[#FFB020]/20 transition cursor-pointer"
                      >
                        + vpsql:query
                      </button>
                      <button
                        type="button"
                        onClick={() => setNewKeyTools(prev => prev && prev !== '*' ? `${prev}, query_winthor` : 'query_winthor')}
                        className="px-2 py-0.5 rounded text-[10.5px] font-mono bg-[#C77DFF]/10 text-[#C77DFF] hover:bg-[#C77DFF]/20 transition cursor-pointer"
                      >
                        + query_winthor
                      </button>
                      <button
                        type="button"
                        onClick={() => setNewKeyTools('')}
                        className="px-2 py-0.5 rounded text-[10.5px] font-mono bg-white/[0.04] text-[#8A8A93] hover:text-[#EDEDED] transition cursor-pointer"
                      >
                        Apenas Chat (Sem MCP)
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block font-mono text-[11px] uppercase tracking-wider text-[#8A8A93] mb-1.5">
                      Serviços de IA Autorizados
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className={`flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer transition select-none ${
                        newKeyServices.includes('chat') || newKeyServices.includes('*')
                          ? 'border-[#85B7EB]/40 bg-[#85B7EB]/10 text-[#EDEDED]'
                          : 'border-white/10 bg-white/[0.02] text-[#8A8A93]'
                      }`}>
                        <input
                          type="checkbox"
                          checked={newKeyServices.includes('chat') || newKeyServices.includes('*')}
                          onChange={e => {
                            if (e.target.checked) {
                              setNewKeyServices(prev => prev.includes('*') ? ['chat', 'images'] : [...prev.filter(s => s !== '*'), 'chat']);
                            } else {
                              const curr = newKeyServices.includes('*') ? ['images'] : newKeyServices.filter(s => s !== 'chat');
                              setNewKeyServices(curr.length === 0 ? ['images'] : curr);
                            }
                          }}
                          className="rounded text-[#85B7EB] focus:ring-0 bg-[#121217]"
                        />
                        <div className="flex flex-col">
                          <span className="text-[12px] font-medium flex items-center gap-1.5">
                            <MessageSquare className="w-3.5 h-3.5 text-[#85B7EB]" /> Chat &amp; Texto
                          </span>
                          <span className="text-[10px] font-mono text-[#8A8A93]">/chat/completions</span>
                        </div>
                      </label>

                      <label className={`flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer transition select-none ${
                        newKeyServices.includes('images') || newKeyServices.includes('*')
                          ? 'border-[#FF70A6]/40 bg-[#FF70A6]/10 text-[#EDEDED]'
                          : 'border-white/10 bg-white/[0.02] text-[#8A8A93]'
                      }`}>
                        <input
                          type="checkbox"
                          checked={newKeyServices.includes('images') || newKeyServices.includes('*')}
                          onChange={e => {
                            if (e.target.checked) {
                              setNewKeyServices(prev => prev.includes('*') ? ['chat', 'images'] : [...prev.filter(s => s !== '*'), 'images']);
                            } else {
                              const curr = newKeyServices.includes('*') ? ['chat'] : newKeyServices.filter(s => s !== 'images');
                              setNewKeyServices(curr.length === 0 ? ['chat'] : curr);
                            }
                          }}
                          className="rounded text-[#FF70A6] focus:ring-0 bg-[#121217]"
                        />
                        <div className="flex flex-col">
                          <span className="text-[12px] font-medium flex items-center gap-1.5">
                            <ImageIcon className="w-3.5 h-3.5 text-[#FF70A6]" /> Imagens (FLUX)
                          </span>
                          <span className="text-[10px] font-mono text-[#8A8A93]">/images/generations</span>
                        </div>
                      </label>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2.5 pt-2">
                    <button
                      type="button"
                      onClick={() => setCreateModalOpen(false)}
                      className="px-3.5 py-2 rounded-lg border border-white/10 text-[#8A8A93] hover:text-[#EDEDED] text-[12.5px] transition cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleCreateKey}
                      disabled={creatingKey || !newKeyName.trim()}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#C77DFF] hover:bg-[#b86df0] text-black text-[12.5px] font-semibold transition disabled:opacity-50 cursor-pointer"
                    >
                      <Key className="w-3.5 h-3.5" />
                      <span>{creatingKey ? 'Gerando…' : 'Gerar Chave'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: EDIT AI KEY PERMISSIONS */}
      {editModalOpen && editingKey && (
        <div 
          onClick={() => setEditModalOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
        >
          <div 
            onClick={e => e.stopPropagation()}
            className="w-full max-w-[500px] border border-white/10 rounded-2xl bg-[#0C0C0F] shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-white/[0.02]">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-[#5B8CFF]/15 border border-[#5B8CFF]/30 text-[#5B8CFF]">
                  <Wrench className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-[15px] font-semibold text-[#EDEDED]">
                    Ajustar Permissões &amp; MCPs
                  </h2>
                  <p className="text-[11.5px] text-[#8A8A93] font-mono">{editingKey.key_prefix}</p>
                </div>
              </div>
              <button
                onClick={() => setEditModalOpen(false)}
                className="p-1.5 rounded-lg text-[#8A8A93] hover:text-[#EDEDED] hover:bg-white/10 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 flex flex-col gap-4">
              <div>
                <label className="block font-mono text-[11px] uppercase tracking-wider text-[#8A8A93] mb-1">
                  Nome da Chave
                </label>
                <input
                  type="text"
                  value={editKeyName}
                  onChange={e => setEditKeyName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg bg-[#121217] border border-white/15 text-[#EDEDED] font-mono text-[12.5px] outline-none focus:border-[#5B8CFF] transition"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-mono text-[11px] uppercase tracking-wider text-[#8A8A93] mb-1">
                    Tenant ID (Isolamento)
                  </label>
                  <input
                    type="text"
                    value={editKeyTenant}
                    onChange={e => setEditKeyTenant(e.target.value)}
                    placeholder="winthor, default"
                    className="w-full px-3 py-1.5 rounded-lg bg-[#121217] border border-white/15 text-[#EDEDED] font-mono text-[12.5px] outline-none focus:border-[#5B8CFF] transition"
                  />
                </div>

                <div>
                  <label className="block font-mono text-[11px] uppercase tracking-wider text-[#8A8A93] mb-1">
                    Limite RPM (req/min)
                  </label>
                  <input
                    type="number"
                    value={editKeyRpm}
                    onChange={e => setEditKeyRpm(Number(e.target.value))}
                    min={1}
                    className="w-full px-3 py-1.5 rounded-lg bg-[#121217] border border-white/15 text-[#EDEDED] font-mono text-[12.5px] outline-none focus:border-[#5B8CFF] transition"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-mono text-[11px] uppercase tracking-wider text-[#8A8A93]">
                    Ferramentas &amp; MCPs Autorizados
                  </label>
                  <span className="text-[10px] font-mono text-[#5A5A63]">Separe por vírgulas</span>
                </div>
                <input
                  type="text"
                  value={editKeyTools}
                  onChange={e => setEditKeyTools(e.target.value)}
                  placeholder="ex: query_winthor, read_schema"
                  className="w-full px-3.5 py-2 rounded-lg bg-[#121217] border border-white/15 text-[#EDEDED] font-mono text-[12.5px] outline-none focus:border-[#5B8CFF] transition"
                />
                
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setEditKeyTools('*')}
                    className="px-2 py-0.5 rounded text-[10.5px] font-mono bg-white/[0.04] text-[#8A8A93] hover:text-[#4BFF8F] hover:bg-white/[0.08] transition cursor-pointer"
                  >
                    Liberar Todas (*)
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditKeyTools(prev => prev && prev !== '*' ? `${prev}, janus:*` : 'janus:*')}
                    className="px-2 py-0.5 rounded text-[10.5px] font-mono bg-[#4BFF8F]/10 text-[#4BFF8F] hover:bg-[#4BFF8F]/20 transition cursor-pointer"
                  >
                    + janus:*
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditKeyTools(prev => prev && prev !== '*' ? `${prev}, janus:read` : 'janus:read')}
                    className="px-2 py-0.5 rounded text-[10.5px] font-mono bg-[#5B8CFF]/10 text-[#5B8CFF] hover:bg-[#5B8CFF]/20 transition cursor-pointer"
                  >
                    + janus:read
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditKeyTools(prev => prev && prev !== '*' ? `${prev}, vpsql:query` : 'vpsql:query')}
                    className="px-2 py-0.5 rounded text-[10.5px] font-mono bg-[#FFB020]/10 text-[#FFB020] hover:bg-[#FFB020]/20 transition cursor-pointer"
                  >
                    + vpsql:query
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditKeyTools(prev => prev && prev !== '*' ? `${prev}, query_winthor` : 'query_winthor')}
                    className="px-2 py-0.5 rounded text-[10.5px] font-mono bg-[#C77DFF]/10 text-[#C77DFF] hover:bg-[#C77DFF]/20 transition cursor-pointer"
                  >
                    + query_winthor
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditKeyTools('')}
                    className="px-2 py-0.5 rounded text-[10.5px] font-mono bg-white/[0.04] text-[#8A8A93] hover:text-[#EDEDED] transition cursor-pointer"
                  >
                    Bloquear MCPs (Apenas Chat)
                  </button>
                </div>
              </div>

              {/* Status do Ciclo de Vida */}
              <div>
                <label className="block font-mono text-[11px] uppercase tracking-wider text-[#8A8A93] mb-1.5">
                  Status do Ciclo de Vida (Acesso)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setEditKeyActive(true)}
                    className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex items-center justify-between ${
                      editKeyActive
                        ? 'border-[#4BFF8F] bg-[#4BFF8F]/10 text-[#4BFF8F]'
                        : 'border-white/10 bg-white/[0.02] text-[#8A8A93] hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <PlayCircle className="w-4 h-4" />
                      <span className="text-[12px] font-semibold">Ativa (Liberada)</span>
                    </div>
                    {editKeyActive && <Check className="w-3.5 h-3.5" />}
                  </button>

                  <button
                    type="button"
                    onClick={() => setEditKeyActive(false)}
                    className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex items-center justify-between ${
                      !editKeyActive
                        ? 'border-[#FF5C5C] bg-[#FF5C5C]/10 text-[#FF5C5C]'
                        : 'border-white/10 bg-white/[0.02] text-[#8A8A93] hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <PauseCircle className="w-4 h-4" />
                      <span className="text-[12px] font-semibold">Suspensa (Bloqueada)</span>
                    </div>
                    {!editKeyActive && <Check className="w-3.5 h-3.5" />}
                  </button>
                </div>
                {!editKeyActive && (
                  <p className="text-[11px] font-mono text-[#FF5C5C] mt-1.5 flex items-center gap-1">
                    <Lock className="w-3 h-3 flex-shrink-0" /> Chave temporariamente suspensa por inadimplência. Retorna HTTP 403.
                  </p>
                )}
              </div>

              {/* Serviços Autorizados */}
              <div>
                <label className="block font-mono text-[11px] uppercase tracking-wider text-[#8A8A93] mb-1.5">
                  Serviços de IA Autorizados
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className={`flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer transition select-none ${
                    editKeyServices.includes('chat') || editKeyServices.includes('*')
                      ? 'border-[#85B7EB]/40 bg-[#85B7EB]/10 text-[#EDEDED]'
                      : 'border-white/10 bg-white/[0.02] text-[#8A8A93]'
                  }`}>
                    <input
                      type="checkbox"
                      checked={editKeyServices.includes('chat') || editKeyServices.includes('*')}
                      onChange={e => {
                        if (e.target.checked) {
                          setEditKeyServices(prev => prev.includes('*') ? ['chat', 'images'] : [...prev.filter(s => s !== '*'), 'chat']);
                        } else {
                          const curr = editKeyServices.includes('*') ? ['images'] : editKeyServices.filter(s => s !== 'chat');
                          setEditKeyServices(curr.length === 0 ? ['images'] : curr);
                        }
                      }}
                      className="rounded text-[#85B7EB] focus:ring-0 bg-[#121217]"
                    />
                    <div className="flex flex-col">
                      <span className="text-[12px] font-medium flex items-center gap-1.5">
                        <MessageSquare className="w-3.5 h-3.5 text-[#85B7EB]" /> Chat &amp; Texto
                      </span>
                      <span className="text-[10px] font-mono text-[#8A8A93]">/chat/completions</span>
                    </div>
                  </label>

                  <label className={`flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer transition select-none ${
                    editKeyServices.includes('images') || editKeyServices.includes('*')
                      ? 'border-[#FF70A6]/40 bg-[#FF70A6]/10 text-[#EDEDED]'
                      : 'border-white/10 bg-white/[0.02] text-[#8A8A93]'
                  }`}>
                    <input
                      type="checkbox"
                      checked={editKeyServices.includes('images') || editKeyServices.includes('*')}
                      onChange={e => {
                        if (e.target.checked) {
                          setEditKeyServices(prev => prev.includes('*') ? ['chat', 'images'] : [...prev.filter(s => s !== '*'), 'images']);
                        } else {
                          const curr = editKeyServices.includes('*') ? ['chat'] : editKeyServices.filter(s => s !== 'images');
                          setEditKeyServices(curr.length === 0 ? ['chat'] : curr);
                        }
                      }}
                      className="rounded text-[#FF70A6] focus:ring-0 bg-[#121217]"
                    />
                    <div className="flex flex-col">
                      <span className="text-[12px] font-medium flex items-center gap-1.5">
                        <ImageIcon className="w-3.5 h-3.5 text-[#FF70A6]" /> Imagens (FLUX)
                      </span>
                      <span className="text-[10px] font-mono text-[#8A8A93]">/images/generations</span>
                    </div>
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setEditModalOpen(false)}
                  className="px-3.5 py-2 rounded-lg border border-white/10 text-[#8A8A93] hover:text-[#EDEDED] text-[12.5px] transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={savingEdit || !editKeyName.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#5B8CFF] hover:bg-[#4879eb] text-white text-[12.5px] font-semibold transition disabled:opacity-50 cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{savingEdit ? 'Salvando…' : 'Salvar Permissões'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Image Lightbox Modal */}
      <ImageLightboxModal
        image={lightboxImg}
        onClose={() => setLightboxImg(null)}
        flash={flash}
      />

    </div>
  );
}

