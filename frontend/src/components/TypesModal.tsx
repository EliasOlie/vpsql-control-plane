'use client';

import React, { useState } from 'react';
import { TableSchema } from '@/lib/api';
import { generateAllInterfaces, generateTableInterface } from '@/lib/typesGenerator';
import { X, Copy, Check, Download, Code2, FileCode } from 'lucide-react';

interface TypesModalProps {
  isOpen: boolean;
  onClose: () => void;
  tables: TableSchema[];
  databaseName: string;
  initialTable?: string;
}

export default function TypesModal({
  isOpen,
  onClose,
  tables,
  databaseName,
  initialTable
}: TypesModalProps) {
  const [selectedTable, setSelectedTable] = useState<string>(initialTable || 'all');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const currentCode = selectedTable === 'all'
    ? generateAllInterfaces(tables, databaseName)
    : (() => {
        const found = tables.find(t => t.name === selectedTable);
        return found ? generateTableInterface(found) : '// Table not found';
      })();

  const handleCopy = () => {
    navigator.clipboard.writeText(currentCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const filename = selectedTable === 'all' ? `${databaseName}.types.ts` : `${selectedTable}.types.ts`;
    const blob = new Blob([currentCode], { type: 'text/typescript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-3xl rounded-2xl border border-white/10 bg-[#0C0C0F] shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-white/[0.02]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-[#3178C6]/15 border border-[#3178C6]/30 text-[#3178C6]">
              <Code2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-[#EDEDED]">TypeScript Type Generator</h2>
              <p className="text-[11.5px] text-[#8A8A93] font-mono">Auto-generated interfaces from database schema</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 hover:border-[#4BFF8F]/40 bg-white/[0.03] text-[12px] font-medium text-[#EDEDED] transition hover:text-[#4BFF8F]"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-[#4BFF8F]" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy Code'}</span>
            </button>

            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20 bg-white/[0.03] text-[12px] font-medium text-[#EDEDED] transition"
            >
              <Download className="w-3.5 h-3.5 text-[#5B8CFF]" />
              <span>Download .ts</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#8A8A93] hover:text-[#EDEDED] hover:bg-white/10 transition ml-2"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 px-6 py-2.5 border-b border-white/[0.06] bg-[#070709] overflow-x-auto text-[11px] font-mono">
          <button
            onClick={() => setSelectedTable('all')}
            className={`px-2.5 py-1 rounded-md transition ${
              selectedTable === 'all'
                ? 'bg-[#3178C6] text-white font-semibold'
                : 'text-[#8A8A93] hover:text-[#EDEDED] hover:bg-white/5'
            }`}
          >
            All Tables ({tables.length})
          </button>
          {tables.map(t => (
            <button
              key={t.name}
              onClick={() => setSelectedTable(t.name)}
              className={`px-2.5 py-1 rounded-md transition flex items-center gap-1 ${
                selectedTable === t.name
                  ? 'bg-[#3178C6]/30 text-[#85B7EB] border border-[#3178C6]/50 font-semibold'
                  : 'text-[#8A8A93] hover:text-[#EDEDED] hover:bg-white/5 border border-transparent'
              }`}
            >
              <FileCode className="w-3 h-3" />
              <span>{t.name}</span>
            </button>
          ))}
        </div>

        {/* Code Viewer */}
        <div className="flex-1 p-6 overflow-y-auto font-mono text-[12.5px] leading-relaxed bg-[#070709]">
          <pre className="text-[#85B7EB]">
            <code>{currentCode}</code>
          </pre>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-white/[0.08] bg-white/[0.015] text-[11px] text-[#5A5A63]">
          <span>Includes nullability, optional flags and standard PostgreSQL type mappings.</span>
          <span className="font-mono">{tables.reduce((acc, t) => acc + t.cols.length, 0)} total columns analyzed</span>
        </div>
      </div>
    </div>
  );
}
