'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { api, RedisKeyItemData } from '@/lib/api';
import { 
  X, Copy, Check, RefreshCw, Trash2, Save, 
  Braces, FileText, Edit3, Clock, AlertCircle, Sparkles
} from 'lucide-react';

interface KeyExplorerModalProps {
  isOpen: boolean;
  onClose: () => void;
  keyItem: RedisKeyItemData | null;
  instanceId: string;
  prefix: string;
  onKeyUpdated?: () => void;
  onKeyDeleted?: (cleanKey: string) => void;
}

export default function KeyExplorerModal({
  isOpen,
  onClose,
  keyItem,
  instanceId,
  prefix,
  onKeyUpdated,
  onKeyDeleted
}: KeyExplorerModalProps) {
  const [activeTab, setActiveTab] = useState<'json' | 'raw' | 'edit'>('json');
  const [fullItem, setFullItem] = useState<RedisKeyItemData | null>(keyItem);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editTTL, setEditTTL] = useState(0);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const loadFullKey = useCallback(async () => {
    if (!keyItem || !instanceId) return;
    setLoading(true);
    setErrorMsg('');
    try {
      const data = await api.getRedisKey(instanceId, keyItem.clean_key);
      if (data) {
        setFullItem(data);
        const strVal = typeof data.value === 'object' 
          ? JSON.stringify(data.value, null, 2) 
          : String(data.value ?? '');
        setEditValue(strVal);
        setEditTTL(data.ttl > 0 ? data.ttl : 0);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro ao carregar detalhes da chave');
    } finally {
      setLoading(false);
    }
  }, [keyItem, instanceId]);

  useEffect(() => {
    if (isOpen && keyItem) {
      setFullItem(keyItem);
      const strVal = typeof keyItem.value === 'object' 
        ? JSON.stringify(keyItem.value, null, 2) 
        : String(keyItem.value ?? '');
      setEditValue(strVal);
      setEditTTL(keyItem.ttl > 0 ? keyItem.ttl : 0);

      // Check if value is JSON
      let isJson = false;
      try {
        if (strVal && (strVal.trim().startsWith('{') || strVal.trim().startsWith('['))) {
          JSON.parse(strVal);
          isJson = true;
        }
      } catch {}
      setActiveTab(isJson ? 'json' : 'raw');

      loadFullKey();
    }
  }, [isOpen, keyItem, loadFullKey]);

  // JSON parsing and validation
  const { isJsonValid, parsedJson, formattedJson } = useMemo(() => {
    if (!fullItem) return { isJsonValid: false, parsedJson: null, formattedJson: '' };
    
    let rawStr = '';
    if (typeof fullItem.value === 'object') {
      try {
        return {
          isJsonValid: true,
          parsedJson: fullItem.value,
          formattedJson: JSON.stringify(fullItem.value, null, 2)
        };
      } catch {
        return { isJsonValid: false, parsedJson: null, formattedJson: '' };
      }
    }

    rawStr = String(fullItem.value ?? '').trim();
    if (!rawStr || (!rawStr.startsWith('{') && !rawStr.startsWith('['))) {
      return { isJsonValid: false, parsedJson: null, formattedJson: '' };
    }

    try {
      const parsed = JSON.parse(rawStr);
      return {
        isJsonValid: true,
        parsedJson: parsed,
        formattedJson: JSON.stringify(parsed, null, 2)
      };
    } catch {
      return { isJsonValid: false, parsedJson: null, formattedJson: '' };
    }
  }, [fullItem]);

  const rawStringValue = useMemo(() => {
    if (!fullItem) return '';
    if (typeof fullItem.value === 'object') {
      try {
        return JSON.stringify(fullItem.value, null, 2);
      } catch {
        return String(fullItem.value);
      }
    }
    return String(fullItem.value ?? '');
  }, [fullItem]);

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleSaveEdit = async () => {
    if (!fullItem || !instanceId) return;
    setSaving(true);
    setErrorMsg('');
    try {
      await api.setRedisKey(instanceId, fullItem.clean_key, editValue, editTTL);
      await loadFullKey();
      if (onKeyUpdated) onKeyUpdated();
      setActiveTab(isJsonValid ? 'json' : 'raw');
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro ao salvar alterações');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!fullItem || !onKeyDeleted) return;
    if (confirm(`Tem certeza que deseja excluir a chave "${fullItem.clean_key}"?`)) {
      onKeyDeleted(fullItem.clean_key);
      onClose();
    }
  };

  const handleFormatEditJson = () => {
    try {
      const parsed = JSON.parse(editValue);
      setEditValue(JSON.stringify(parsed, null, 2));
    } catch (e: any) {
      setErrorMsg('Não foi possível formatar: JSON inválido');
    }
  };

  // Syntax highlighting for JSON
  const renderHighlightedJson = (jsonStr: string) => {
    const escaped = jsonStr
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const highlighted = escaped.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      (match) => {
        let cls = 'text-[#85B7EB]'; // number
        if (/^"/.test(match)) {
          if (/:$/.test(match)) {
            cls = 'text-[#4BFF8F] font-semibold'; // key
          } else {
            cls = 'text-[#E4C381]'; // string
          }
        } else if (/true|false/.test(match)) {
          cls = 'text-[#FF80DF] font-medium'; // boolean
        } else if (/null/.test(match)) {
          cls = 'text-[#6E6E7A] italic'; // null
        }
        return `<span class="${cls}">${match}</span>`;
      }
    );

    return <code dangerouslySetInnerHTML={{ __html: highlighted }} />;
  };

  if (!isOpen || !keyItem) return null;

  return (
    <div 
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div 
        onClick={e => e.stopPropagation()}
        className="relative w-full max-w-4xl rounded-2xl border border-white/10 bg-[#0C0C0F] shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-white/[0.02]">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="p-2.5 rounded-xl bg-[#FF5C5C]/15 border border-[#FF5C5C]/30 text-[#FF5C5C] flex-shrink-0">
              <Braces className="w-5 h-5" />
            </div>
            <div className="overflow-hidden">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[15px] font-semibold text-[#EDEDED] font-mono tracking-tight truncate">
                  {keyItem.clean_key}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] bg-white/[0.06] text-[#85B7EB] uppercase font-mono font-medium">
                  {fullItem?.type || keyItem.type}
                </span>
                {fullItem && (
                  <span className="px-2 py-0.5 rounded text-[10px] bg-white/[0.06] text-[#E4C381] font-mono flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {fullItem.ttl < 0 ? 'Sem expiração' : `${fullItem.ttl}s`}
                  </span>
                )}
                {isJsonValid && (
                  <span className="px-2 py-0.5 rounded text-[10px] bg-[#4BFF8F]/10 border border-[#4BFF8F]/30 text-[#4BFF8F] font-mono flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> JSON Válido
                  </span>
                )}
              </div>
              <div className="text-[11.5px] text-[#6E6E7A] font-mono mt-0.5 flex items-center gap-1.5 truncate">
                <span>Namespace:</span>
                <span className="text-[#FF5C5C]">{prefix}</span>
                <span className="text-[#EDEDED] font-medium truncate">{keyItem.clean_key}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={loadFullKey}
              disabled={loading}
              title="Recarregar dados do Redis"
              className="p-1.5 rounded-lg text-[#8A8A93] hover:text-[#EDEDED] hover:bg-white/10 transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-[#FF5C5C]' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#8A8A93] hover:text-[#EDEDED] hover:bg-white/10 transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center justify-between px-6 border-b border-white/[0.06] bg-[#09090B]">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveTab('json')}
              className={`flex items-center gap-1.5 px-3.5 py-2.5 font-mono text-[12px] border-b-2 transition cursor-pointer ${
                activeTab === 'json'
                  ? 'border-[#4BFF8F] text-[#EDEDED] font-semibold bg-white/[0.02]'
                  : 'border-transparent text-[#6E6E7A] hover:text-[#EDEDED]'
              }`}
            >
              <Braces className="w-3.5 h-3.5" />
              <span>JSON Viewer</span>
              {isJsonValid && (
                <span className="w-1.5 h-1.5 rounded-full bg-[#4BFF8F]" />
              )}
            </button>

            <button
              onClick={() => setActiveTab('raw')}
              className={`flex items-center gap-1.5 px-3.5 py-2.5 font-mono text-[12px] border-b-2 transition cursor-pointer ${
                activeTab === 'raw'
                  ? 'border-[#85B7EB] text-[#EDEDED] font-semibold bg-white/[0.02]'
                  : 'border-transparent text-[#6E6E7A] hover:text-[#EDEDED]'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Texto / Raw</span>
              <span className="text-[10.5px] text-[#5A5A63]">({rawStringValue.length} chars)</span>
            </button>

            <button
              onClick={() => setActiveTab('edit')}
              className={`flex items-center gap-1.5 px-3.5 py-2.5 font-mono text-[12px] border-b-2 transition cursor-pointer ${
                activeTab === 'edit'
                  ? 'border-[#FF5C5C] text-[#EDEDED] font-semibold bg-white/[0.02]'
                  : 'border-transparent text-[#6E6E7A] hover:text-[#EDEDED]'
              }`}
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Editar Chave &amp; TTL</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleCopy(keyItem.clean_key, 'key')}
              className="flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded bg-white/[0.04] text-[#8A8A93] hover:text-[#EDEDED] transition cursor-pointer"
            >
              {copied === 'key' ? <Check className="w-3 h-3 text-[#4BFF8F]" /> : <Copy className="w-3 h-3" />}
              <span>{copied === 'key' ? 'Copiado!' : 'Copiar Chave'}</span>
            </button>

            <button
              onClick={() => handleCopy(rawStringValue, 'val')}
              className="flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded bg-white/[0.04] text-[#8A8A93] hover:text-[#EDEDED] transition cursor-pointer"
            >
              {copied === 'val' ? <Check className="w-3 h-3 text-[#4BFF8F]" /> : <Copy className="w-3 h-3" />}
              <span>{copied === 'val' ? 'Copiado!' : 'Copiar Valor'}</span>
            </button>
          </div>
        </div>

        {/* Error Alert */}
        {errorMsg && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-[#FF5C5C]/10 border border-[#FF5C5C]/25 text-[#FF5C5C] text-[12px] font-mono flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <button onClick={() => setErrorMsg('')} className="text-[#FF5C5C] hover:underline text-[11px]">
              Fechar
            </button>
          </div>
        )}

        {/* Tab Content */}
        <div className="p-6 flex-1 overflow-y-auto">
          {activeTab === 'json' && (
            <div className="flex flex-col gap-3">
              {isJsonValid ? (
                <div className="relative rounded-xl border border-white/10 bg-[#070709] p-4 overflow-x-auto">
                  <div className="flex items-center justify-between mb-3 pb-2 border-b border-white/[0.06] text-[11px] font-mono text-[#6E6E7A]">
                    <span>Objeto JSON formatado e validado:</span>
                    <button
                      onClick={() => handleCopy(formattedJson, 'json')}
                      className="flex items-center gap-1 hover:text-[#EDEDED] transition cursor-pointer"
                    >
                      {copied === 'json' ? <Check className="w-3 h-3 text-[#4BFF8F]" /> : <Copy className="w-3 h-3" />}
                      <span>{copied === 'json' ? 'JSON copiado!' : 'Copiar formatado'}</span>
                    </button>
                  </div>
                  <pre className="font-mono text-[12.5px] leading-relaxed overflow-x-auto whitespace-pre selection:bg-[#4BFF8F]/20">
                    {renderHighlightedJson(formattedJson)}
                  </pre>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center p-10 rounded-xl border border-dashed border-white/10 bg-white/[0.01] text-center gap-2.5">
                  <FileText className="w-8 h-8 text-[#5A5A63]" />
                  <p className="text-[13px] text-[#EDEDED] font-medium">O valor desta chave não é um JSON válido</p>
                  <p className="text-[11.5px] text-[#6E6E7A] max-w-md">
                    Ela contém texto simples ou formato arbitrário. Você pode inspecionar seu conteúdo na aba &quot;Texto / Raw&quot;.
                  </p>
                  <button
                    onClick={() => setActiveTab('raw')}
                    className="mt-2 px-3 py-1.5 rounded-lg bg-white/[0.05] border border-white/10 text-[#85B7EB] hover:text-white text-[12px] font-mono transition cursor-pointer"
                  >
                    Ver na aba Raw →
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'raw' && (
            <div className="flex flex-col gap-2">
              <div className="rounded-xl border border-white/10 bg-[#070709] p-4 overflow-x-auto">
                <pre className="font-mono text-[12px] text-[#EDEDED] leading-relaxed whitespace-pre-wrap break-all selection:bg-[#85B7EB]/20">
                  {rawStringValue || '— Vazio —'}
                </pre>
              </div>
            </div>
          )}

          {activeTab === 'edit' && (
            <div className="flex flex-col gap-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-mono text-[11px] uppercase tracking-wider text-[#8A8A93]">
                    Valor da Chave
                  </label>
                  <button
                    type="button"
                    onClick={handleFormatEditJson}
                    className="text-[11px] font-mono text-[#4BFF8F] hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <Sparkles className="w-3 h-3" /> Formatar como JSON
                  </button>
                </div>
                <textarea
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  rows={9}
                  placeholder="Insira o valor..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#070709] border border-white/15 text-[#EDEDED] font-mono text-[12px] leading-relaxed outline-none focus:border-[#4BFF8F] transition resize-y selection:bg-[#4BFF8F]/20"
                />
              </div>

              <div>
                <label className="block font-mono text-[11px] uppercase tracking-wider text-[#8A8A93] mb-1.5">
                  TTL (Time-To-Live em Segundos)
                </label>
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="number"
                    value={editTTL}
                    onChange={e => setEditTTL(Number(e.target.value))}
                    min={0}
                    placeholder="0 = sem expiração"
                    className="w-40 px-3 py-1.5 rounded-lg bg-[#070709] border border-white/15 text-[#EDEDED] font-mono text-[12px] outline-none focus:border-[#4BFF8F] transition"
                  />
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setEditTTL(0)}
                      className="px-2 py-1 rounded bg-white/[0.04] hover:bg-white/[0.08] text-[11px] font-mono text-[#8A8A93] hover:text-[#EDEDED] transition cursor-pointer"
                    >
                      Persistente (0s)
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditTTL(60)}
                      className="px-2 py-1 rounded bg-white/[0.04] hover:bg-white/[0.08] text-[11px] font-mono text-[#8A8A93] hover:text-[#EDEDED] transition cursor-pointer"
                    >
                      60s (1m)
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditTTL(300)}
                      className="px-2 py-1 rounded bg-white/[0.04] hover:bg-white/[0.08] text-[11px] font-mono text-[#8A8A93] hover:text-[#EDEDED] transition cursor-pointer"
                    >
                      300s (5m)
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditTTL(3600)}
                      className="px-2 py-1 rounded bg-white/[0.04] hover:bg-white/[0.08] text-[11px] font-mono text-[#8A8A93] hover:text-[#EDEDED] transition cursor-pointer"
                    >
                      1h (3600s)
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditTTL(86400)}
                      className="px-2 py-1 rounded bg-white/[0.04] hover:bg-white/[0.08] text-[11px] font-mono text-[#8A8A93] hover:text-[#EDEDED] transition cursor-pointer"
                    >
                      24h (86400s)
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/[0.08] bg-[#09090B]">
          <button
            type="button"
            onClick={handleDelete}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#FF5C5C]/30 text-[#FF5C5C] hover:bg-[#FF5C5C]/10 text-[12px] font-mono transition cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Excluir Chave</span>
          </button>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-white/10 text-[#8A8A93] hover:text-[#EDEDED] text-[12.5px] transition cursor-pointer"
            >
              Fechar
            </button>
            {activeTab === 'edit' && (
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#4BFF8F] hover:bg-[#3de07c] text-black font-semibold text-[12.5px] transition cursor-pointer disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>{saving ? 'Salvando...' : 'Salvar Alterações'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
