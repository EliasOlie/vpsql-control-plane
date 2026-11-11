'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useVPSQL } from '@/context/VPSQLContext';
import { 
  Database, Layers, Sparkles, HardDrive, FolderKanban, Users, 
  Archive, Plus, Activity as ActivityIcon, Server, Shield
} from 'lucide-react';

export default function Sidebar() {
  const pathname = usePathname();
  const { 
    databases, 
    redisList, 
    groupedProjects, 
    aiWorkerStatus, 
    roles, 
    apiConnected, 
    nodeMetrics, 
    loginEmail, 
    handleSignOut,
    setPaletteOpen,
    setCreateProjectModalOpen
  } = useVPSQL();

  const currentHost = process.env.NEXT_PUBLIC_DB_HOST || nodeMetrics?.node_host || 'db.example.com';

  // Sincronizar contagem de projetos
  const displayProjects = React.useMemo(() => {
    if (groupedProjects && groupedProjects.length > 0) {
      return groupedProjects.map(g => ({
        name: g.name,
        count: g.total_resources,
        color: g.color || '#5B8CFF',
      }));
    }
    // Fallback básico
    return [{ name: 'default', count: databases.length, color: '#5B8CFF' }];
  }, [groupedProjects, databases]);

  const navItems = [
    {
      label: 'Databases',
      href: '/databases',
      icon: <Database className="w-3.5 h-3.5 text-[#4BFF8F]" />,
      activeClass: 'bg-[#4BFF8F]/10 text-[#4BFF8F] ring-1 ring-[#4BFF8F]/25 font-medium',
      badge: String(databases.length).padStart(2, '0'),
      badgeClass: 'text-[#5A5A63]',
    },
    {
      label: 'Redis Cache',
      href: '/redis',
      icon: <Layers className="w-3.5 h-3.5 text-[#FF5C5C]" />,
      activeClass: 'bg-[#FF5C5C]/10 text-[#FF5C5C] ring-1 ring-[#FF5C5C]/25 font-medium',
      badge: String(redisList.length).padStart(2, '0'),
      badgeClass: 'text-[#5A5A63]',
    },
    {
      label: 'AI Gateway',
      href: '/ai',
      icon: <Sparkles className="w-3.5 h-3.5 text-[#C77DFF]" />,
      activeClass: 'bg-[#C77DFF]/10 text-[#C77DFF] ring-1 ring-[#C77DFF]/25 font-medium',
      customBadge: (
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px]">
          {aiWorkerStatus?.online ? (
            <span className="flex items-center gap-1 text-[#4BFF8F]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#4BFF8F] animate-pulse" />
              Live
            </span>
          ) : (
            <span className="text-[#5A5A63]">Off</span>
          )}
        </span>
      ),
    },
    {
      label: 'S3 Storage',
      href: '/storage',
      icon: <HardDrive className="w-3.5 h-3.5 text-[#00E5FF]" />,
      activeClass: 'bg-[#00E5FF]/10 text-[#00E5FF] ring-1 ring-[#00E5FF]/25 font-medium',
      badge: 'S3',
      badgeClass: 'text-[#00E5FF] bg-[#00E5FF]/10 px-1.5 py-0.2 rounded',
    },
    {
      label: 'Projetos Hub',
      href: '/projects',
      icon: <FolderKanban className="w-3.5 h-3.5 text-[#5B8CFF]" />,
      activeClass: 'bg-[#5B8CFF]/10 text-[#5B8CFF] ring-1 ring-[#5B8CFF]/25 font-medium',
      badge: 'Multi',
      badgeClass: 'text-[#5B8CFF] bg-[#5B8CFF]/10 px-1.5 py-0.2 rounded',
    },
    {
      label: 'Clientes & Auth',
      href: '/clients',
      icon: <Users className="w-3.5 h-3.5 text-[#5B8CFF]" />,
      activeClass: 'bg-[#5B8CFF]/10 text-[#5B8CFF] ring-1 ring-[#5B8CFF]/25 font-medium',
      badge: 'JWT',
      badgeClass: 'text-[#5B8CFF] bg-[#5B8CFF]/10 px-1.5 py-0.2 rounded',
    },
    {
      label: 'Roles & grants',
      href: '/roles',
      icon: <Shield className="w-3.5 h-3.5 text-[#8A8A93]" />,
      activeClass: 'bg-[#4BFF8F]/10 text-[#4BFF8F] ring-1 ring-[#4BFF8F]/25 font-medium',
      badge: String(roles.length).padStart(2, '0'),
      badgeClass: 'text-[#5A5A63]',
    },
    {
      label: 'Activity',
      href: '/activity',
      icon: <ActivityIcon className="w-3.5 h-3.5 text-[#8A8A93]" />,
      activeClass: 'bg-[#4BFF8F]/10 text-[#4BFF8F] ring-1 ring-[#4BFF8F]/25 font-medium',
      customBadge: <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#FFB020]"></span>,
    },
    {
      label: 'Node',
      href: '/node',
      icon: <Server className="w-3.5 h-3.5 text-[#8A8A93]" />,
      activeClass: 'bg-[#4BFF8F]/10 text-[#4BFF8F] ring-1 ring-[#4BFF8F]/25 font-medium',
    },
    {
      label: 'Backups',
      href: '/backups',
      icon: <Archive className="w-3.5 h-3.5 text-[#4BFF8F]" />,
      activeClass: 'bg-[#4BFF8F]/10 text-[#4BFF8F] ring-1 ring-[#4BFF8F]/25 font-medium',
      badge: '7d',
      badgeClass: 'text-[#4BFF8F] bg-[#4BFF8F]/10 border border-[#4BFF8F]/20 px-1.5 py-0.2 rounded',
    },
  ];

  return (
    <aside className="w-[236px] flex-shrink-0 border-r border-white/[0.07] p-5 flex flex-col gap-6 sticky top-0 h-screen overflow-y-auto">
      {/* Brand & Node Header */}
      <div className="flex flex-col gap-3 px-1.5">
        <Link href="/databases" className="flex items-center gap-2.5">
          <div className="w-[22px] h-[22px] rounded-md bg-[#4BFF8F] shadow-[0_0_18px_-2px_rgba(75,255,143,0.65)] flex items-center justify-center font-mono text-[11px] font-bold text-[#04140B]">V</div>
          <span className="font-mono text-[14px] font-bold tracking-wider">VPSQL</span>
          <span className="ml-auto font-mono text-[10px] text-[#5A5A63]">v0.4.2</span>
        </Link>
        
        <div className="flex items-center gap-2 p-2 border border-white/[0.07] rounded-lg bg-white/[0.025]">
          <span className={`w-1.5 h-1.5 rounded-full ${apiConnected ? 'bg-[#4BFF8F] shadow-[0_0_8px_#4BFF8F] animate-pulse' : 'bg-[#FF5C5C]'}`}></span>
          <div className="flex flex-col min-w-0">
            <span className="font-mono text-[11px] text-[#EDEDED] truncate">{nodeMetrics?.node_host || currentHost}</span>
            <span className="text-[10px] text-[#5A5A63]">single-node · {nodeMetrics?.postgres_version || 'pg16'}</span>
          </div>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex flex-col gap-0.5">
        <div className="text-[10px] uppercase tracking-widest text-[#4E4E57] px-2 pb-2">Control plane</div>
        
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href === '/databases' && (pathname === '/' || pathname.startsWith('/databases')));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left text-[13px] transition ${
                isActive
                  ? item.activeClass
                  : 'text-[#8A8A93] hover:text-[#EDEDED] hover:bg-white/[0.04]'
              }`}
            >
              <span className="flex items-center gap-1.5">
                {item.icon}
                <span>{item.label}</span>
              </span>
              {item.customBadge ? (
                item.customBadge
              ) : item.badge ? (
                <span className={`ml-auto font-mono text-[11px] ${item.badgeClass || 'text-[#5A5A63]'}`}>
                  {item.badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      {/* Dynamic Projects Section */}
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center justify-between px-2 pb-2">
          <span className="text-[10px] uppercase tracking-widest text-[#4E4E57]">Projects</span>
          <div className="flex items-center gap-1.5">
            <Link
              href="/projects"
              className="text-[10px] font-mono text-[#5B8CFF] hover:underline"
            >
              Hub
            </Link>
            <button
              onClick={() => setCreateProjectModalOpen(true)}
              className="text-[#8A8A93] hover:text-[#EDEDED] p-0.5 rounded hover:bg-white/[0.08] transition"
              title="Criar novo projeto"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
        </div>

        {displayProjects.length === 0 && (
          <div className="px-2 py-1 text-[11px] text-[#5A5A63]">Nenhum projeto</div>
        )}

        {displayProjects.map(p => {
          const isCurrentProject = pathname.startsWith('/projects');
          return (
            <Link
              key={p.name}
              href={`/projects?name=${encodeURIComponent(p.name)}`}
              className={`flex items-center gap-2.5 w-full px-2 py-1.5 text-left text-[13px] rounded-lg transition ${
                isCurrentProject
                  ? 'text-[#EDEDED] hover:bg-white/[0.04]'
                  : 'text-[#8A8A93] hover:text-[#EDEDED] hover:bg-white/[0.04]'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-sm" style={{ backgroundColor: p.color }}></span>
              <span className="truncate">{p.name}</span>
              <span className="ml-auto font-mono text-[11px] text-[#4E4E57]">{p.count}</span>
            </Link>
          );
        })}
      </div>

      {/* User Session Footer */}
      <div className="mt-auto flex items-center gap-2.5 pt-3 border-t border-white/[0.06]">
        <span className="w-5 h-5 rounded bg-[#4BFF8F]/15 border border-[#4BFF8F]/30 flex items-center justify-center font-mono text-[10px] text-[#4BFF8F]">
          {loginEmail[0]?.toUpperCase() || 'A'}
        </span>
        <span className="font-mono text-[11px] text-[#8A8A93] truncate">{loginEmail}</span>
        <button
          onClick={handleSignOut}
          className="ml-auto text-[#4E4E57] hover:text-[#FF5C5C] text-[11px] transition p-1"
          title="Encerrar sessão"
        >
          Sair
        </button>
      </div>

      {/* Command Palette Trigger */}
      <button
        onClick={() => setPaletteOpen(true)}
        className="flex items-center gap-2 p-2 border border-dashed border-white/10 rounded-lg text-[#5A5A63] hover:text-[#4BFF8F] hover:border-[#4BFF8F]/35 text-[12px] transition cursor-pointer"
      >
        Command palette
        <kbd className="ml-auto font-mono text-[10px] border border-white/10 rounded px-1 text-[#8A8A93]">⌘K</kbd>
      </button>
    </aside>
  );
}
