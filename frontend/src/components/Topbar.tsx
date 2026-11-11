'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { useVPSQL } from '@/context/VPSQLContext';

export default function Topbar() {
  const pathname = usePathname();
  const { apiConnected, apiLatency, setPaletteOpen } = useVPSQL();

  const getBreadcrumb = () => {
    if (pathname.startsWith('/databases')) return 'databases';
    if (pathname.startsWith('/redis')) return 'redis';
    if (pathname.startsWith('/ai')) return 'ai gateway';
    if (pathname.startsWith('/storage')) return 's3 storage';
    if (pathname.startsWith('/projects')) return 'projects';
    if (pathname.startsWith('/clients')) return 'clients & auth';
    if (pathname.startsWith('/roles')) return 'roles & grants';
    if (pathname.startsWith('/activity')) return 'activity';
    if (pathname.startsWith('/node')) return 'node';
    if (pathname.startsWith('/backups')) return 'backups';
    return 'control plane';
  };

  return (
    <header className="sticky top-0 z-20 flex items-center gap-3.5 px-6 py-3.5 border-b border-white/[0.07] bg-[#09090B]/80 backdrop-blur-md">
      <div className="flex items-center gap-2 font-mono text-[12px] text-[#5A5A63] min-w-0">
        <span>vpsql</span>
        <span className="text-[#2F2F36]">/</span>
        <span className="text-[#EDEDED] truncate capitalize">
          {getBreadcrumb()}
        </span>
      </div>

      {/* API Health Pill */}
      <div className="flex items-center gap-2 px-3 py-1 rounded-full border border-white/[0.08] bg-white/[0.02] text-[11px] font-mono">
        <span className={`w-2 h-2 rounded-full ${apiConnected ? 'bg-[#4BFF8F] shadow-[0_0_8px_#4BFF8F] animate-pulse' : 'bg-[#FF5C5C] shadow-[0_0_8px_#FF5C5C]'}`}></span>
        <span className={apiConnected ? 'text-[#EDEDED]' : 'text-[#FF5C5C]'}>
          {apiConnected ? `API Live (${apiLatency}ms)` : 'API Offline'}
        </span>
      </div>

      <button
        onClick={() => setPaletteOpen(true)}
        className="ml-auto flex items-center gap-2.5 min-w-[220px] px-3 py-1.5 border border-white/[0.08] rounded-lg bg-white/[0.025] text-[#5A5A63] hover:border-white/[0.18] text-[12.5px] transition cursor-pointer"
      >
        Search or run a command
        <kbd className="ml-auto font-mono text-[10px] border border-white/10 rounded px-1.5 py-0.5 text-[#8A8A93]">⌘K</kbd>
      </button>
    </header>
  );
}
