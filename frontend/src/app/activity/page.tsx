'use client';

import React from 'react';
import { useVPSQL } from '@/context/VPSQLContext';

export default function ActivityPage() {
  const { activity, refreshActivity } = useVPSQL();

  return (
    <div className="flex flex-col gap-4 animate-vpsql-fade">
      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight">Activity</h1>
          <p className="text-[13px] text-[#5A5A63] mt-1">Trilha de auditoria das operações do plano de controle executadas via API ou CLI.</p>
        </div>
        <button
          onClick={refreshActivity}
          className="ml-auto px-3 py-1.5 border border-white/10 rounded-lg text-[#8A8A93] hover:text-[#EDEDED] font-mono text-[12px] cursor-pointer"
        >
          ↻ Recarregar
        </button>
      </div>

      <div className="border border-white/[0.07] rounded-xl bg-white/[0.022] overflow-hidden">
        {activity.length === 0 && (
          <div className="p-8 text-center font-mono text-[12px] text-[#5A5A63]">Nenhuma atividade registrada ainda.</div>
        )}
        {activity.map((a, i) => (
          <div
            key={a.id || i}
            className="flex items-center gap-3.5 px-4 py-3 border-b border-white/[0.045] flex-wrap hover:bg-white/[0.03] transition"
          >
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: a.color }}></span>
            <span className="font-mono text-[12px] min-w-[120px]" style={{ color: a.color }}>{a.action}</span>
            <span className="font-mono text-[12px] text-[#8A8A93] min-w-0">{a.target}</span>
            <span className="text-[11.5px] text-[#5A5A63]">via {a.via}</span>
            <span className="ml-auto font-mono text-[11px] text-[#4E4E57]">{a.time}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
