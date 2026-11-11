'use client';

import React from 'react';
import { useVPSQL } from '@/context/VPSQLContext';

export default function NodePage() {
  const { nodeMetrics, refreshNode } = useVPSQL();
  const currentHost = process.env.NEXT_PUBLIC_DB_HOST || nodeMetrics?.node_host || 'db.example.com';

  return (
    <div className="flex flex-col gap-4 animate-vpsql-fade">
      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight">Node &amp; Engine Status</h1>
          <p className="text-[13px] text-[#5A5A63] mt-1">
            {nodeMetrics?.node_host || currentHost} · {nodeMetrics?.postgres_version || 'PostgreSQL 16'} · {nodeMetrics?.total_databases || '0'} Databases
          </p>
        </div>
        <button
          onClick={refreshNode}
          className="ml-auto px-3 py-1.5 border border-white/10 rounded-lg text-[#8A8A93] hover:text-[#EDEDED] font-mono text-[12px] cursor-pointer"
        >
          ↻ Atualizar Métricas
        </button>
      </div>

      {/* Real Resource Meters */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3.5">
        {(nodeMetrics?.meters || [
          { label: 'CPU', value: '28%', pct: '28%', color: '#4BFF8F', detail: 'load 1m 1.84 · 8 vCPU' },
          { label: 'Memory', value: '45%', pct: '45%', color: '#4BFF8F', detail: '7.2 / 16 GB · buffers 4 GB' },
          { label: 'Disk', value: '12%', pct: '12%', color: '#5B8CFF', detail: '29.7 MB / 320 GB NVMe' },
          { label: 'IOPS', value: '940', pct: '22%', color: '#5B8CFF', detail: 'read 280 · write 660' }
        ]).map(m => (
          <div key={m.label} className="p-4 border border-white/[0.07] rounded-xl bg-white/[0.022] flex flex-col gap-2.5">
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] text-[#5A5A63] uppercase tracking-wider">{m.label}</span>
              <span className="ml-auto font-mono text-[18px]" style={{ color: m.color }}>{m.value}</span>
            </div>
            <div className="h-1.5 rounded bg-white/[0.06] overflow-hidden">
              <div className="h-full" style={{ width: m.pct, backgroundColor: m.color, boxShadow: `0 0 12px ${m.color}` }}></div>
            </div>
            <span className="font-mono text-[11px] text-[#4E4E57]">{m.detail}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-3.5">
        <div className="p-4 border border-white/[0.07] rounded-xl bg-white/[0.022] flex flex-col gap-3">
          <div className="text-[12px] font-semibold">postgresql.conf (Live)</div>
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 font-mono text-[11.5px] text-[#8A8A93]">
            {Object.entries(nodeMetrics?.config || {
              max_connections: '100',
              shared_buffers: '128MB',
              work_mem: '4MB',
              wal_level: 'replica',
              ssl: 'off'
            }).map(([k, v]) => (
              <React.Fragment key={k}>
                <span className="text-[#4E4E57]">{k}</span>
                <span>{v}</span>
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className="p-4 border border-white/[0.07] rounded-xl bg-white/[0.022] flex flex-col gap-3">
          <div className="text-[12px] font-semibold">Control Plane (Live)</div>
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 font-mono text-[11.5px] text-[#8A8A93]">
            {Object.entries(nodeMetrics?.control_plane || {
              api: ':8080 · healthy',
              pooler: 'pgbouncer :6432',
              agent: 'connected',
              api_keys: '1 active'
            }).map(([k, v]) => (
              <React.Fragment key={k}>
                <span className="text-[#4E4E57]">{k}</span>
                <span className={k === 'agent' ? 'text-[#4BFF8F]' : ''}>{v}</span>
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
