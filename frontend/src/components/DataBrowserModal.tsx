'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { TableSchema } from '@/lib/api';
import { X, RefreshCw, ChevronLeft, ChevronRight, Download, Search, Table2, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

interface DataBrowserModalProps {
  isOpen: boolean;
  onClose: () => void;
  tableName: string;
  databaseName: string;
  tableSchema?: TableSchema;
  onExecuteQuery: (sql: string) => Promise<any>;
}

export default function DataBrowserModal({
  isOpen,
  onClose,
  tableName,
  databaseName,
  tableSchema,
  onExecuteQuery
}: DataBrowserModalProps) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [totalRows, setTotalRows] = useState<number>(0);
  const [page, setPage] = useState(0);
  const [pageSize] = useState(25);
  const [sortCol, setSortCol] = useState<string>('');
  const [sortDir, setSortDir] = useState<'ASC' | 'DESC'>('ASC');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchCol, setSearchCol] = useState('');
  const [duration, setDuration] = useState(0);

  // Load data
  const loadData = useCallback(async () => {
    if (!tableName || !isOpen) return;
    setLoading(true);

    try {
      // 1. Fetch count
      let countSql = `SELECT COUNT(*) as cnt FROM "${tableName}"`;
      if (searchTerm && searchCol) {
        countSql += ` WHERE "${searchCol}"::text ILIKE '%${searchTerm.replace(/'/g, "''")}%'`;
      }
      const countRes = await onExecuteQuery(countSql);
      if (countRes?.rows?.[0]?.cnt !== undefined) {
        setTotalRows(Number(countRes.rows[0].cnt));
      }

      // 2. Fetch rows
      let sql = `SELECT * FROM "${tableName}"`;
      if (searchTerm && searchCol) {
        sql += ` WHERE "${searchCol}"::text ILIKE '%${searchTerm.replace(/'/g, "''")}%'`;
      }
      if (sortCol) {
        sql += ` ORDER BY "${sortCol}" ${sortDir}`;
      }
      sql += ` LIMIT ${pageSize} OFFSET ${page * pageSize};`;

      const res = await onExecuteQuery(sql);
      if (res?.columns) {
        setColumns(res.columns);
        setRows(res.rows || []);
        setDuration(res.duration_ms || 0);
        if (!searchCol && res.columns.length > 0) {
          setSearchCol(res.columns[0]);
        }
      }
    } catch (err) {
      console.error('Failed to load table data:', err);
    } finally {
      setLoading(false);
    }
  }, [tableName, isOpen, page, pageSize, sortCol, sortDir, searchTerm, searchCol, onExecuteQuery]);

  useEffect(() => {
    if (isOpen) {
      setPage(0);
      loadData();
    }
  }, [isOpen, tableName, loadData]);

  if (!isOpen) return null;

  // Sorting handler
  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir(prev => (prev === 'ASC' ? 'DESC' : 'ASC'));
    } else {
      setSortCol(col);
      setSortDir('ASC');
    }
    setPage(0);
  };

  // Export CSV
  const handleExportCSV = () => {
    if (rows.length === 0) return;
    const header = columns.join(',');
    const csvRows = rows.map(r => 
      columns.map(c => {
        const val = r[c] === null ? '' : String(r[c]);
        return `"${val.replace(/"/g, '""')}"`;
      }).join(',')
    );
    const content = [header, ...csvRows].join('\n');
    const blob = new Blob([content], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${tableName}_export.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalPages = Math.ceil(totalRows / pageSize);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-6xl rounded-2xl border border-white/10 bg-[#0C0C0F] shadow-2xl flex flex-col h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[#4BFF8F]/15 border border-[#4BFF8F]/30 text-[#4BFF8F]">
              <Table2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[16px] font-semibold text-[#EDEDED] font-mono">{tableName}</h2>
                <span className="text-[11px] font-mono text-[#5A5A63]">in {databaseName}</span>
              </div>
              <p className="text-[11.5px] text-[#8A8A93] font-mono">
                {totalRows} rows total · {columns.length} columns · {duration.toFixed(2)} ms
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCSV}
              disabled={rows.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20 bg-white/[0.03] text-[12px] font-medium text-[#EDEDED] transition disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5 text-[#4BFF8F]" />
              <span>Export CSV</span>
            </button>

            <button
              onClick={loadData}
              disabled={loading}
              className="p-1.5 rounded-lg border border-white/10 hover:border-white/20 bg-white/[0.03] text-[#8A8A93] hover:text-[#EDEDED] transition"
              title="Refresh rows"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-[#4BFF8F]' : ''}`} />
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#8A8A93] hover:text-[#EDEDED] hover:bg-white/10 transition ml-2"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Toolbar: Search & Filters */}
        <div className="flex items-center gap-3 px-6 py-2.5 border-b border-white/[0.06] bg-[#070709] text-[12px] font-mono">
          <div className="flex items-center gap-2 flex-1 max-w-md bg-[#0C0C0F] border border-white/10 rounded-lg px-2.5 py-1 focus-within:border-[#4BFF8F]/60 transition">
            <Search className="w-3.5 h-3.5 text-[#5A5A63]" />
            <select
              value={searchCol}
              onChange={e => setSearchCol(e.target.value)}
              className="bg-transparent text-[#8A8A93] outline-none text-[11px] border-r border-white/10 pr-2"
            >
              {columns.map(c => (
                <option key={c} value={c} className="bg-[#121217] text-[#EDEDED]">{c}</option>
              ))}
            </select>
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && loadData()}
              placeholder="Search in column... (Press Enter)"
              className="bg-transparent text-[#EDEDED] outline-none flex-1 placeholder:text-[#3E3E47] text-[11.5px]"
            />
            {searchTerm && (
              <button onClick={() => { setSearchTerm(''); setTimeout(loadData, 0); }} className="text-[#5A5A63] hover:text-[#EDEDED]">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2 text-[11px] text-[#5A5A63]">
            <span>Showing {rows.length > 0 ? page * pageSize + 1 : 0} - {Math.min((page + 1) * pageSize, totalRows)} of {totalRows}</span>
          </div>
        </div>

        {/* Spreadsheet Data Grid */}
        <div className="flex-1 overflow-auto bg-[#070709] relative font-mono text-[12px]">
          {loading && (
            <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] flex items-center justify-center z-10">
              <RefreshCw className="w-6 h-6 animate-spin text-[#4BFF8F]" />
            </div>
          )}

          {rows.length === 0 && !loading ? (
            <div className="h-full flex flex-col items-center justify-center text-[#5A5A63] gap-2">
              <Table2 className="w-8 h-8 stroke-1 text-[#3E3E47]" />
              <span>Nenhum registro encontrado nesta tabela.</span>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-[#0C0C0F] z-1 border-b border-white/10 shadow-sm">
                <tr>
                  <th className="px-3 py-2 text-[#4E4E57] text-[10px] w-12 text-center border-r border-white/[0.04]">#</th>
                  {columns.map(c => {
                    const colSchema = tableSchema?.cols.find(sc => sc.name === c);
                    return (
                      <th
                        key={c}
                        onClick={() => handleSort(c)}
                        className="px-3.5 py-2.5 text-[#8A8A93] hover:text-[#EDEDED] cursor-pointer select-none border-r border-white/[0.04] transition group"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold">{c}</span>
                          {colSchema?.flag && (
                            <span className="text-[9px] px-1 rounded bg-[#4BFF8F]/10 text-[#4BFF8F] font-mono">
                              {colSchema.flag}
                            </span>
                          )}
                          <span className="text-[9.5px] text-[#5A5A63] ml-1">
                            {colSchema?.type}
                          </span>
                          <span className="ml-auto text-[#4E4E57] group-hover:text-[#EDEDED]">
                            {sortCol === c ? (
                              sortDir === 'ASC' ? <ArrowUp className="w-3 h-3 text-[#4BFF8F]" /> : <ArrowDown className="w-3 h-3 text-[#4BFF8F]" />
                            ) : (
                              <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-100" />
                            )}
                          </span>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-white/[0.03] hover:bg-white/[0.025] transition-colors">
                    <td className="px-3 py-1.5 text-[#4E4E57] text-[10.5px] text-center border-r border-white/[0.04]">
                      {page * pageSize + i + 1}
                    </td>
                    {columns.map(c => {
                      const val = r[c];
                      const isNull = val === null;
                      return (
                        <td key={c} className="px-3.5 py-1.5 border-r border-white/[0.04] max-w-xs truncate">
                          {isNull ? (
                            <span className="text-[#4E4E57] italic text-[11px]">NULL</span>
                          ) : typeof val === 'object' ? (
                            <span className="text-[#85B7EB] text-[11px]">{JSON.stringify(val)}</span>
                          ) : typeof val === 'boolean' ? (
                            <span className={`text-[11px] font-bold ${val ? 'text-[#4BFF8F]' : 'text-[#FF5C5C]'}`}>
                              {String(val)}
                            </span>
                          ) : (
                            <span className="text-[#EDEDED]">{String(val)}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer Pagination */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-white/[0.08] bg-white/[0.015] text-[12px] font-mono">
          <div className="flex items-center gap-1.5 text-[#8A8A93]">
            <span>Página {totalPages > 0 ? page + 1 : 0} de {totalPages || 1}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0 || loading}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-white/10 hover:border-white/20 bg-white/[0.03] text-[11.5px] text-[#EDEDED] transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Anterior</span>
            </button>

            <button
              onClick={() => setPage(p => p + 1)}
              disabled={(page + 1) * pageSize >= totalRows || loading}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-white/10 hover:border-white/20 bg-white/[0.03] text-[11.5px] text-[#EDEDED] transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span>Próxima</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
