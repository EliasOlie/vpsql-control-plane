'use client';

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { TableSchema } from '@/lib/api';
import { Play, Sparkles, Database, Columns, History, Bookmark, Zap, Trash2, Plus, Check } from 'lucide-react';

interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  onExecute: () => void;
  onExplain?: () => void;
  tables: TableSchema[];
  running?: boolean;
  minRows?: number;
}

interface SuggestionItem {
  label: string;
  kind: 'table' | 'column' | 'keyword' | 'function' | 'snippet';
  detail?: string;
  flag?: string;
  insertText?: string;
  tableName?: string;
}

const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM',
  'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'ON', 'GROUP BY', 'ORDER BY',
  'HAVING', 'LIMIT', 'OFFSET', 'ASC', 'DESC', 'CREATE TABLE', 'DROP TABLE',
  'ALTER TABLE', 'ADD COLUMN', 'RETURNING', 'ON CONFLICT DO NOTHING', 'AND', 'OR',
  'NOT', 'IN', 'IS NULL', 'IS NOT NULL', 'LIKE', 'ILIKE', 'AS', 'DISTINCT',
  'PRIMARY KEY', 'DEFAULT', 'GENERATED ALWAYS AS IDENTITY', 'TIMESTAMPTZ', 'NOW()'
];

const SQL_FUNCTIONS = [
  { label: 'COUNT(*)', detail: 'Aggregate count of rows' },
  { label: 'SUM()', detail: 'Calculate total sum', insertText: 'SUM()' },
  { label: 'AVG()', detail: 'Calculate average', insertText: 'AVG()' },
  { label: 'MIN()', detail: 'Minimum value', insertText: 'MIN()' },
  { label: 'MAX()', detail: 'Maximum value', insertText: 'MAX()' },
  { label: 'COALESCE()', detail: 'Return first non-null', insertText: 'COALESCE(, )' },
  { label: 'NOW()', detail: 'Current timestamp with timezone' },
  { label: 'GEN_RANDOM_UUID()', detail: 'Generate random UUID v4' }
];

export default function SqlEditor({
  value,
  onChange,
  onExecute,
  onExplain,
  tables,
  running = false,
  minRows = 3
}: SqlEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [cursorPos, setCursorPos] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeToken, setActiveToken] = useState('');
  const [tokenStart, setTokenStart] = useState(0);

  // History and Snippets state
  const [panelTab, setPanelTab] = useState<'none' | 'history' | 'snippets'>('none');
  const [historyList, setHistoryList] = useState<string[]>([]);
  const [snippetsList, setSnippetsList] = useState<{ id: string; name: string; sql: string }[]>([]);
  const [newSnippetName, setNewSnippetName] = useState('');
  const [savingSnippet, setSavingSnippet] = useState(false);

  useEffect(() => {
    try {
      const savedH = localStorage.getItem('vpsql_query_history');
      if (savedH) setHistoryList(JSON.parse(savedH));
      const savedS = localStorage.getItem('vpsql_saved_snippets');
      if (savedS) setSnippetsList(JSON.parse(savedS));
    } catch (_) {}
  }, []);

  const saveToHistory = useCallback((sql: string) => {
    if (!sql.trim()) return;
    setHistoryList(prev => {
      const filtered = prev.filter(q => q.trim() !== sql.trim());
      const next = [sql.trim(), ...filtered].slice(0, 30);
      try {
        localStorage.setItem('vpsql_query_history', JSON.stringify(next));
      } catch (_) {}
      return next;
    });
  }, []);

  const handleExecute = () => {
    saveToHistory(value);
    onExecute();
  };

  const handleSaveSnippet = () => {
    if (!value.trim() || !newSnippetName.trim()) return;
    const newItem = {
      id: Date.now().toString(),
      name: newSnippetName.trim(),
      sql: value.trim()
    };
    const next = [newItem, ...snippetsList];
    setSnippetsList(next);
    try {
      localStorage.setItem('vpsql_saved_snippets', JSON.stringify(next));
    } catch (_) {}
    setNewSnippetName('');
    setSavingSnippet(false);
  };

  const handleDeleteSnippet = (id: string) => {
    const next = snippetsList.filter(s => s.id !== id);
    setSnippetsList(next);
    try {
      localStorage.setItem('vpsql_saved_snippets', JSON.stringify(next));
    } catch (_) {}
  };

  const clearHistory = () => {
    setHistoryList([]);
    try {
      localStorage.removeItem('vpsql_query_history');
    } catch (_) {}
  };

  // Parse all columns mapped by table and flat list
  const schemaCatalog = useMemo(() => {
    const tableMap = new Map<string, TableSchema>();
    const allCols: Array<{ name: string; type: string; flag?: string; tableName: string }> = [];

    tables.forEach(t => {
      tableMap.set(t.name.toLowerCase(), t);
      t.cols.forEach(c => {
        allCols.push({
          name: c.name,
          type: c.type,
          flag: c.flag,
          tableName: t.name
        });
      });
    });

    return { tableMap, allCols };
  }, [tables]);

  // Compute suggestions based on cursor context
  const suggestions = useMemo<SuggestionItem[]>(() => {
    if (!showSuggestions && !value) return [];

    const textBeforeCursor = value.slice(0, cursorPos);
    const match = textBeforeCursor.match(/([a-zA-Z0-9_.]*)$/);
    const currentWord = match ? match[1] : '';

    // Check if user is typing `tableName.`
    const dotIndex = currentWord.lastIndexOf('.');
    if (dotIndex !== -1) {
      const tablePart = currentWord.slice(0, dotIndex).toLowerCase();
      const colPart = currentWord.slice(dotIndex + 1).toLowerCase();
      const targetTable = schemaCatalog.tableMap.get(tablePart);

      if (targetTable) {
        return targetTable.cols
          .filter(c => c.name.toLowerCase().startsWith(colPart))
          .map(c => ({
            label: c.name,
            kind: 'column',
            detail: `${c.type} · ${targetTable.name}`,
            flag: c.flag,
            insertText: c.name,
            tableName: targetTable.name
          }));
      }
    }

    const term = currentWord.toLowerCase();
    const list: SuggestionItem[] = [];

    // Prioritize tables if previous word is FROM, JOIN, INTO, UPDATE, TABLE
    const cleanBefore = textBeforeCursor.slice(0, textBeforeCursor.length - currentWord.length).trimEnd().toUpperCase();
    const isExpectingTable = /\b(FROM|JOIN|INTO|UPDATE|TABLE)\s*$/.test(cleanBefore);

    if (isExpectingTable) {
      tables.forEach(t => {
        if (!term || t.name.toLowerCase().includes(term)) {
          list.push({
            label: t.name,
            kind: 'table',
            detail: `table · ${t.rows || '0'} rows · ${t.cols.length} cols`,
            insertText: t.name
          });
        }
      });
    }

    // 1. Tables
    if (!isExpectingTable) {
      tables.forEach(t => {
        if (!term || t.name.toLowerCase().includes(term)) {
          list.push({
            label: t.name,
            kind: 'table',
            detail: `table · ${t.rows || '0'} rows`,
            insertText: t.name
          });
        }
      });
    }

    // 2. Columns from schema
    schemaCatalog.allCols.forEach(c => {
      if (term && c.name.toLowerCase().includes(term)) {
        list.push({
          label: c.name,
          kind: 'column',
          detail: `${c.type} (${c.tableName})`,
          flag: c.flag,
          insertText: c.name,
          tableName: c.tableName
        });
      }
    });

    // 3. Keywords
    SQL_KEYWORDS.forEach(kw => {
      if (term && kw.toLowerCase().startsWith(term) && kw.toLowerCase() !== term) {
        list.push({
          label: kw,
          kind: 'keyword',
          detail: 'keyword',
          insertText: kw
        });
      }
    });

    // 4. Functions
    SQL_FUNCTIONS.forEach(fn => {
      if (term && fn.label.toLowerCase().includes(term)) {
        list.push({
          label: fn.label,
          kind: 'function',
          detail: fn.detail,
          insertText: fn.insertText || fn.label
        });
      }
    });

    // Limit to top 8 suggestions
    return list.slice(0, 8);
  }, [value, cursorPos, tables, schemaCatalog, showSuggestions]);

  // Handle cursor and input change
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const pos = e.target.selectionStart;
    onChange(val);
    setCursorPos(pos);

    // Extract word before cursor
    const textBefore = val.slice(0, pos);
    const match = textBefore.match(/([a-zA-Z0-9_.]*)$/);
    if (match && match[1].length > 0) {
      setActiveToken(match[1]);
      setTokenStart(pos - match[1].length);
      setShowSuggestions(true);
      setSelectedIndex(0);
    } else {
      setShowSuggestions(false);
    }
  };

  const insertSuggestion = useCallback((item: SuggestionItem) => {
    if (!textareaRef.current) return;

    const beforeToken = value.slice(0, tokenStart);
    const afterCursor = value.slice(cursorPos);

    // If typing `table.col`, preserve `table.`
    const dotIndex = activeToken.lastIndexOf('.');
    let textToInsert = item.insertText || item.label;
    if (dotIndex !== -1 && item.kind === 'column') {
      const tablePrefix = activeToken.slice(0, dotIndex + 1);
      textToInsert = tablePrefix + textToInsert;
    }

    const nextValue = beforeToken + textToInsert + ' ' + afterCursor;
    onChange(nextValue);

    const nextCursor = beforeToken.length + textToInsert.length + 1;
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(nextCursor, nextCursor);
        setCursorPos(nextCursor);
      }
    }, 10);

    setShowSuggestions(false);
  }, [value, tokenStart, cursorPos, activeToken, onChange]);

  // Handle keyboard events (Tab, Enter, Arrows, Esc, Cmd+Enter)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd+Enter or Ctrl+Enter: Execute query
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      setShowSuggestions(false);
      handleExecute();
      return;
    }

    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertSuggestion(suggestions[selectedIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowSuggestions(false);
        return;
      }
    }

    // Tab indentation inside textarea
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = e.currentTarget.selectionStart;
      const end = e.currentTarget.selectionEnd;
      const nextVal = value.substring(0, start) + '  ' + value.substring(end);
      onChange(nextVal);
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + 2;
          setCursorPos(start + 2);
        }
      }, 0);
    }
  };

  const handleKeyUp = () => {
    if (textareaRef.current) {
      setCursorPos(textareaRef.current.selectionStart);
    }
  };

  // Quick Snippets
  const applySnippet = (snippet: string) => {
    onChange(snippet);
    if (textareaRef.current) {
      textareaRef.current.focus();
      const len = snippet.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  };

  const lineCount = Math.max(minRows, value.split('\n').length);

  return (
    <div ref={containerRef} className="relative flex flex-col border border-white/10 rounded-xl bg-[#09090C] overflow-hidden focus-within:border-[#4BFF8F]/60 transition-colors shadow-2xl">
      {/* Editor Top Bar */}
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-white/[0.06] bg-white/[0.015] text-[11px] font-mono">
        <div className="flex items-center gap-2 text-[#8A8A93]">
          <Database className="w-3.5 h-3.5 text-[#4BFF8F]" />
          <span className="text-[#EDEDED] font-medium">PostgreSQL Introspective Editor</span>
          <span className="text-[#4E4E57]">·</span>
          <span className="text-[#4E4E57]">{tables.length} tables cataloged</span>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {/* History Toggle */}
          <button
            onClick={() => setPanelTab(prev => prev === 'history' ? 'none' : 'history')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md border text-[11px] transition ${
              panelTab === 'history'
                ? 'bg-[#4BFF8F]/15 border-[#4BFF8F]/40 text-[#4BFF8F]'
                : 'border-white/10 hover:border-white/20 bg-white/[0.02] text-[#8A8A93] hover:text-[#EDEDED]'
            }`}
            title="View query history"
          >
            <History className="w-3 h-3" />
            <span>History</span>
            {historyList.length > 0 && (
              <span className="text-[9px] px-1 rounded bg-white/10 text-[#EDEDED]">{historyList.length}</span>
            )}
          </button>

          {/* Snippets Toggle */}
          <button
            onClick={() => setPanelTab(prev => prev === 'snippets' ? 'none' : 'snippets')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md border text-[11px] transition ${
              panelTab === 'snippets'
                ? 'bg-[#5B8CFF]/15 border-[#5B8CFF]/40 text-[#5B8CFF]'
                : 'border-white/10 hover:border-white/20 bg-white/[0.02] text-[#8A8A93] hover:text-[#EDEDED]'
            }`}
            title="Saved snippets"
          >
            <Bookmark className="w-3 h-3" />
            <span>Snippets</span>
            {snippetsList.length > 0 && (
              <span className="text-[9px] px-1 rounded bg-white/10 text-[#EDEDED]">{snippetsList.length}</span>
            )}
          </button>

          {onExplain && (
            <button
              onClick={onExplain}
              disabled={running || !value.trim()}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-[#FFB020]/30 hover:border-[#FFB020]/60 bg-[#FFB020]/10 text-[#FFB020] text-[11px] font-medium transition disabled:opacity-50"
              title="Run EXPLAIN ANALYZE"
            >
              <Zap className="w-3 h-3" />
              <span>Explain</span>
            </button>
          )}

          <div className="hidden sm:flex items-center gap-1 text-[#5A5A63] text-[10.5px] ml-1">
            <kbd className="px-1.5 py-0.5 rounded border border-white/10 bg-white/[0.03]">⌘</kbd>
            <kbd className="px-1.5 py-0.5 rounded border border-white/10 bg-white/[0.03]">Enter</kbd>
          </div>

          <button
            onClick={handleExecute}
            disabled={running || !value.trim()}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#4BFF8F] hover:bg-[#8DFFBD] text-[#04140B] text-[12px] font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <Play className="w-3 h-3 fill-current" />
            {running ? 'Running…' : 'Execute'}
          </button>
        </div>
      </div>

      {/* History & Snippets Expandable Panel */}
      {panelTab !== 'none' && (
        <div className="px-4 py-3 border-b border-white/[0.08] bg-[#070709] animate-in slide-in-from-top-1 duration-150">
          {panelTab === 'history' && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-[11px] text-[#8A8A93] font-mono">
                <span className="font-semibold text-[#EDEDED] flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5 text-[#4BFF8F]" /> Query Execution History
                </span>
                {historyList.length > 0 && (
                  <button onClick={clearHistory} className="text-[#FF5C5C] hover:underline flex items-center gap-1">
                    <Trash2 className="w-3 h-3" /> Clear history
                  </button>
                )}
              </div>

              {historyList.length === 0 ? (
                <div className="text-[11.5px] text-[#5A5A63] font-mono py-2">Nenhuma query executada ainda nesta sessão.</div>
              ) : (
                <div className="max-h-40 overflow-y-auto flex flex-col gap-1 pr-1 font-mono text-[11.5px]">
                  {historyList.map((h, i) => (
                    <div
                      key={i}
                      onClick={() => { onChange(h); setPanelTab('none'); }}
                      className="group flex items-center justify-between p-2 rounded-lg bg-white/[0.02] hover:bg-[#4BFF8F]/10 border border-white/[0.04] hover:border-[#4BFF8F]/30 cursor-pointer transition text-[#8A8A93] hover:text-[#EDEDED]"
                    >
                      <span className="truncate flex-1">{h}</span>
                      <span className="text-[10px] text-[#5A5A63] group-hover:text-[#4BFF8F] shrink-0 ml-2">Click to load</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {panelTab === 'snippets' && (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between text-[11px] text-[#8A8A93] font-mono">
                <span className="font-semibold text-[#EDEDED] flex items-center gap-1.5">
                  <Bookmark className="w-3.5 h-3.5 text-[#5B8CFF]" /> Saved Query Snippets
                </span>
                {!savingSnippet ? (
                  <button
                    onClick={() => setSavingSnippet(true)}
                    className="text-[#4BFF8F] hover:underline flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" /> Save current query
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={newSnippetName}
                      onChange={e => setNewSnippetName(e.target.value)}
                      placeholder="Snippet name..."
                      className="px-2 py-0.5 rounded bg-[#121217] border border-white/20 text-[#EDEDED] text-[11px] outline-none"
                    />
                    <button
                      onClick={handleSaveSnippet}
                      className="px-2 py-0.5 rounded bg-[#4BFF8F] text-[#04140B] font-semibold text-[11px]"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setSavingSnippet(false)}
                      className="text-[#5A5A63] hover:text-[#EDEDED] text-[11px]"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>

              {snippetsList.length === 0 ? (
                <div className="text-[11.5px] text-[#5A5A63] font-mono py-2">Nenhum snippet salvo. Digite uma query e clique em &quot;Save current query&quot;.</div>
              ) : (
                <div className="max-h-40 overflow-y-auto flex flex-col gap-1 pr-1 font-mono text-[11.5px]">
                  {snippetsList.map(s => (
                    <div
                      key={s.id}
                      className="group flex items-center justify-between p-2 rounded-lg bg-white/[0.02] hover:bg-[#5B8CFF]/10 border border-white/[0.04] hover:border-[#5B8CFF]/30 transition"
                    >
                      <div
                        onClick={() => { onChange(s.sql); setPanelTab('none'); }}
                        className="flex items-center gap-2 truncate flex-1 cursor-pointer"
                      >
                        <span className="font-semibold text-[#5B8CFF]">{s.name}</span>
                        <span className="text-[#5A5A63] truncate">· {s.sql}</span>
                      </div>
                      <button
                        onClick={() => handleDeleteSnippet(s.id)}
                        className="opacity-0 group-hover:opacity-100 text-[#5A5A63] hover:text-[#FF5C5C] p-1 transition"
                        title="Delete snippet"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Main Editor Surface */}
      <div className="relative flex min-h-[90px]">
        {/* Line Numbers */}
        <div className="select-none py-3 px-3 text-right font-mono text-[12px] text-[#3E3E47] bg-[#070709] border-r border-white/[0.05] leading-[20px]">
          {Array.from({ length: lineCount }).map((_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>

        {/* Textarea Input */}
        <div className="relative flex-1">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
            onClick={() => {
              if (textareaRef.current) setCursorPos(textareaRef.current.selectionStart);
            }}
            placeholder="-- Escreva seu comando SQL aqui... Experimente: SELECT * FROM..."
            rows={Math.max(minRows, lineCount)}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            className="w-full h-full p-3 font-mono text-[12.5px] leading-[20px] bg-transparent text-[#EDEDED] outline-none resize-y border-none placeholder:text-[#3E3E47] selection:bg-[#4BFF8F]/20"
          />

          {/* Autocomplete Popup */}
          {showSuggestions && suggestions.length > 0 && (
            <div 
              className="absolute left-4 top-14 z-50 w-80 rounded-xl border border-white/15 bg-[#121217] shadow-2xl backdrop-blur-xl overflow-hidden animate-in fade-in zoom-in-95 duration-100"
            >
              <div className="flex items-center justify-between px-3 py-1.5 bg-white/[0.03] border-b border-white/[0.06] text-[10px] font-mono text-[#5A5A63]">
                <span className="flex items-center gap-1 text-[#4BFF8F]">
                  <Sparkles className="w-3 h-3" /> Schema Hints & Autocomplete
                </span>
                <span>Tab / ↵ to insert</span>
              </div>

              <div className="max-h-56 overflow-y-auto py-1">
                {suggestions.map((item, idx) => {
                  const isSelected = idx === selectedIndex;
                  return (
                    <div
                      key={item.label + idx}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        insertSuggestion(item);
                      }}
                      className={`flex items-center gap-2.5 px-3 py-1.5 cursor-pointer text-[12px] font-mono transition-colors ${
                        isSelected ? 'bg-[#4BFF8F]/15 text-[#EDEDED]' : 'text-[#8A8A93] hover:bg-white/[0.04]'
                      }`}
                    >
                      {/* Kind Badge */}
                      <span
                        className={`text-[9.5px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${
                          item.kind === 'table'
                            ? 'bg-[#4BFF8F]/20 text-[#4BFF8F] border border-[#4BFF8F]/30'
                            : item.kind === 'column'
                            ? 'bg-[#5B8CFF]/20 text-[#5B8CFF] border border-[#5B8CFF]/30'
                            : item.kind === 'function'
                            ? 'bg-[#FFB020]/20 text-[#FFB020] border border-[#FFB020]/30'
                            : 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                        }`}
                      >
                        {item.kind === 'table' ? 'TBL' : item.kind === 'column' ? 'COL' : item.kind === 'function' ? 'FN' : 'KEY'}
                      </span>

                      {/* Name */}
                      <span className="font-semibold text-[#EDEDED]">{item.label}</span>

                      {/* Flag if PK/FK */}
                      {item.flag && (
                        <span className="text-[9px] px-1 rounded bg-white/10 text-[#EDEDED] font-bold">
                          {item.flag}
                        </span>
                      )}

                      {/* Detail Type */}
                      {item.detail && (
                        <span className="ml-auto text-[11px] text-[#5A5A63] truncate max-w-[120px]">
                          {item.detail}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Quick Schema Helper / Snippets Bar */}
      <div className="flex items-center gap-2 px-3.5 py-2 bg-white/[0.015] border-t border-white/[0.06] text-[11px] font-mono overflow-x-auto">
        <span className="text-[#5A5A63] flex items-center gap-1 shrink-0">
          <Columns className="w-3 h-3 text-[#5B8CFF]" /> Schema Quick Select:
        </span>

        {tables.length === 0 && (
          <span className="text-[#4E4E57] italic">Nenhuma tabela detectada para atalhos rápidos</span>
        )}

        {tables.map(t => (
          <button
            key={t.name}
            onClick={() => applySnippet(`SELECT * FROM ${t.name} LIMIT 20;`)}
            className="shrink-0 px-2 py-0.5 rounded border border-white/10 bg-white/[0.03] hover:border-[#4BFF8F]/40 hover:text-[#4BFF8F] text-[#8A8A93] transition flex items-center gap-1.5"
            title={`Clique para gerar: SELECT * FROM ${t.name} LIMIT 20;`}
          >
            <span>{t.name}</span>
            <span className="text-[9.5px] text-[#5A5A63]">({t.rows} rows)</span>
          </button>
        ))}

        <div className="ml-auto shrink-0 flex items-center gap-2 text-[#4E4E57]">
          <button
            onClick={() => applySnippet('CREATE TABLE IF NOT EXISTS messages (\n  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,\n  content TEXT NOT NULL,\n  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP\n);')}
            className="hover:text-[#EDEDED] transition"
            title="Snippet: Create messages table"
          >
            + Create Table
          </button>
          <span>·</span>
          <button
            onClick={() => applySnippet('SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = \'public\';')}
            className="hover:text-[#EDEDED] transition"
            title="Snippet: Introspect catalog"
          >
            Catalog Query
          </button>
        </div>
      </div>
    </div>
  );
}
