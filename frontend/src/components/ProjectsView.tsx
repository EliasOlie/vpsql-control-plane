'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  api, 
  GroupedProjectData, 
  ProjectData, 
  RedisInstanceData, 
  StorageBucketData, 
  AIKeyData 
} from '@/lib/api';
import { 
  FolderKanban, Database, Layers, HardDrive, Sparkles, Plus, 
  RefreshCw, Copy, Check, ExternalLink, ArrowRight, Search,
  Trash2, Link as LinkIcon, Unlink, X, CheckCircle2, AlertCircle,
  FolderPlus
} from 'lucide-react';

interface ProjectsViewProps {
  onNotify: (msg: string) => void;
  onNavigateToDb: (dbName: string) => void;
  onNavigateToRedis: (redisName: string) => void;
  onNavigateToStorage: (bucketName: string) => void;
  onNavigateToAI: () => void;
  onOpenCreateDb: (projectName: string) => void;
  onOpenCreateRedis?: (projectName: string) => void;
  onOpenCreateStorage?: (projectName: string) => void;
  onProjectsChanged?: () => void;
  initialProject?: string;
  externalProjects?: GroupedProjectData[];
}

const PRESET_COLORS = [
  '#5B8CFF', '#4BFF8F', '#FF5C5C', '#00E5FF', '#C77DFF', '#FFB020'
];

export default function ProjectsView({
  onNotify,
  onNavigateToDb,
  onNavigateToRedis,
  onNavigateToStorage,
  onNavigateToAI,
  onOpenCreateDb,
  onOpenCreateRedis,
  onOpenCreateStorage,
  onProjectsChanged,
  initialProject,
  externalProjects
}: ProjectsViewProps) {
  const [projects, setProjects] = useState<GroupedProjectData[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // 1. Create Project Modal State
  const [createProjectModalOpen, setCreateProjectModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [newProjectColor, setNewProjectColor] = useState('#5B8CFF');
  const [creatingProject, setCreatingProject] = useState(false);

  // 2. Attach Existing Resource Modal State
  const [attachModalOpen, setAttachModalOpen] = useState(false);
  const [attachTargetProject, setAttachTargetProject] = useState('');
  const [attachResourceType, setAttachResourceType] = useState<'database' | 'redis' | 'storage' | 'ai'>('database');
  const [attaching, setAttaching] = useState(false);

  // 3. Quick Create Resource Modal State
  const [newResModalOpen, setNewResModalOpen] = useState(false);
  const [newResTargetProject, setNewResTargetProject] = useState('');
  const [newResType, setNewResType] = useState<'database' | 'redis' | 'storage' | 'ai'>('redis');
  const [newResName, setNewResName] = useState('');
  const [newResPublic, setNewResPublic] = useState(true);
  const [creatingResource, setCreatingResource] = useState(false);

  const loadProjects = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.getGroupedProjects();
      setProjects(res.projects || []);
    } catch (err: any) {
      onNotify('Erro ao carregar projetos: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (externalProjects && externalProjects.length > 0) {
      setProjects(externalProjects);
      setLoading(false);
    }
  }, [externalProjects]);

  useEffect(() => {
    if (initialProject) {
      setSearch(initialProject);
    }
  }, [initialProject]);

  // Aggregate all resources across projects for attaching
  const allDatabases = useMemo(() => {
    const list: (ProjectData & { project_group?: string })[] = [];
    projects.forEach(p => {
      p.databases.forEach(db => {
        list.push({ ...db, project_group: p.name });
      });
    });
    return list;
  }, [projects]);

  const allRedis = useMemo(() => {
    const list: (RedisInstanceData & { project_group?: string })[] = [];
    projects.forEach(p => {
      p.redis.forEach(r => {
        list.push({ ...r, project_group: p.name });
      });
    });
    return list;
  }, [projects]);

  const allBuckets = useMemo(() => {
    const list: (StorageBucketData & { project_group?: string })[] = [];
    projects.forEach(p => {
      p.buckets.forEach(b => {
        list.push({ ...b, project_group: p.name });
      });
    });
    return list;
  }, [projects]);

  const allAIKeys = useMemo(() => {
    const list: (AIKeyData & { project_group?: string })[] = [];
    projects.forEach(p => {
      p.ai_keys.forEach(k => {
        list.push({ ...k, project_group: p.name });
      });
    });
    return list;
  }, [projects]);

  // Handle explicit project creation
  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newProjectName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (!cleanName) {
      onNotify('Informe o nome do projeto');
      return;
    }

    setCreatingProject(true);
    try {
      await api.createProjectGroup(cleanName, newProjectDesc.trim(), newProjectColor);
      onNotify(`✓ Projeto "${cleanName}" criado com sucesso!`);
      setCreateProjectModalOpen(false);
      setNewProjectName('');
      setNewProjectDesc('');
      await loadProjects();
      onProjectsChanged?.();
    } catch (err: any) {
      onNotify('Falha ao criar projeto: ' + err.message);
    } finally {
      setCreatingProject(false);
    }
  };

  // Handle project deletion
  const handleDeleteProject = async (name: string) => {
    if (name === 'default') {
      onNotify('O projeto default não pode ser excluído.');
      return;
    }
    if (!window.confirm(`Tem certeza que deseja excluir o projeto "${name}"?\nTodos os recursos vinculados serão mantidos e reatribuídos para o workspace 'default'.`)) {
      return;
    }

    try {
      await api.deleteProjectGroup(name);
      onNotify(`✓ Projeto "${name}" excluído. Recursos movidos para 'default'.`);
      await loadProjects();
      onProjectsChanged?.();
    } catch (err: any) {
      onNotify('Falha ao excluir projeto: ' + err.message);
    }
  };

  // Handle attaching an existing resource to a project
  const handleAttachResource = async (resourceId: string) => {
    if (!attachTargetProject) return;
    setAttaching(true);
    try {
      await api.attachResourceToProject(attachTargetProject, attachResourceType, resourceId);
      onNotify(`✓ Recurso "${resourceId}" vinculado ao projeto "${attachTargetProject}"!`);
      setAttachModalOpen(false);
      await loadProjects();
      onProjectsChanged?.();
    } catch (err: any) {
      onNotify('Falha ao vincular recurso: ' + err.message);
    } finally {
      setAttaching(false);
    }
  };

  // Handle detaching a resource from a project (reassigns to 'default')
  const handleDetachResource = async (projectName: string, resourceType: string, resourceId: string) => {
    if (projectName === 'default') return;
    if (!window.confirm(`Desvincular "${resourceId}" do projeto "${projectName}"?\nO recurso será movido para o workspace 'default'.`)) {
      return;
    }

    try {
      await api.detachResourceFromProject(projectName, resourceType, resourceId);
      onNotify(`✓ Recurso desvinculado e movido para 'default'.`);
      await loadProjects();
      onProjectsChanged?.();
    } catch (err: any) {
      onNotify('Falha ao desvincular recurso: ' + err.message);
    }
  };

  // Handle quick creation of a new resource within a project
  const handleQuickCreateResource = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newResName.trim();
    if (!name) {
      onNotify('Informe o nome do recurso');
      return;
    }

    setCreatingResource(true);
    try {
      if (newResType === 'database') {
        setNewResModalOpen(false);
        onOpenCreateDb(newResTargetProject);
        return;
      } else if (newResType === 'redis') {
        await api.createRedis(name, newResTargetProject);
        onNotify(`✓ Cache Redis "${name}" provisionado no projeto "${newResTargetProject}"!`);
      } else if (newResType === 'storage') {
        await api.createBucket(name, newResTargetProject, newResPublic);
        onNotify(`✓ Bucket S3 "${name}" criado no projeto "${newResTargetProject}"!`);
      } else if (newResType === 'ai') {
        await api.createAIKey(name, newResTargetProject, ['*'], ['*'], 60, newResTargetProject);
        onNotify(`✓ Chave de IA "${name}" criada no projeto "${newResTargetProject}"!`);
      }
      setNewResModalOpen(false);
      setNewResName('');
      await loadProjects();
      onProjectsChanged?.();
    } catch (err: any) {
      onNotify('Falha ao provisionar recurso: ' + err.message);
    } finally {
      setCreatingResource(false);
    }
  };

  const openAttachModal = (projectName: string, type: 'database' | 'redis' | 'storage' | 'ai' = 'database') => {
    setAttachTargetProject(projectName);
    setAttachResourceType(type);
    setAttachModalOpen(true);
  };

  const openNewResModal = (projectName: string, type: 'database' | 'redis' | 'storage' | 'ai') => {
    if (type === 'database') {
      onOpenCreateDb(projectName);
      return;
    }
    setNewResTargetProject(projectName);
    setNewResType(type);
    setNewResName('');
    setNewResPublic(true);
    setNewResModalOpen(true);
  };

  const filteredProjects = projects.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.description && p.description.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-[#09090B] text-[#EDEDED] p-6 gap-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="p-1.5 rounded-lg bg-[#5B8CFF]/10 text-[#5B8CFF] border border-[#5B8CFF]/20">
              <FolderKanban className="w-5 h-5" />
            </span>
            <h1 className="text-xl font-medium tracking-tight text-[#EDEDED]">Projetos &amp; Recursos Agrupados</h1>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-[#5B8CFF]/10 text-[#5B8CFF] border border-[#5B8CFF]/20">
              Workspaces Hub
            </span>
          </div>
          <p className="text-[13px] text-[#8A8A93] mt-1">
            Organize bancos PostgreSQL, caches Redis, armazenamento S3 e chaves de IA em workspaces isolados com controle total.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={loadProjects}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] text-[12px] text-[#8A8A93] hover:text-[#EDEDED] transition cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>

          <button
            onClick={() => {
              setNewProjectName('');
              setNewProjectDesc('');
              setNewProjectColor('#5B8CFF');
              setCreateProjectModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#5B8CFF] text-white text-[12.5px] font-semibold hover:bg-[#4a7ae8] shadow-[0_0_18px_-4px_rgba(91,140,255,0.65)] transition cursor-pointer"
          >
            <FolderPlus className="w-4 h-4" />
            Novo Projeto
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative max-w-md">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#5A5A63]" />
        <input
          type="text"
          placeholder="Buscar projetos por nome ou descrição..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-white/[0.03] border border-white/[0.08] rounded-lg pl-8 pr-3 py-1.5 text-[12px] text-[#EDEDED] placeholder-[#5A5A63] focus:outline-none focus:border-[#5B8CFF]/40"
        />
      </div>

      {/* Projects Grid */}
      {loading ? (
        <div className="p-12 text-center text-[#5A5A63] font-mono text-[12px] flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin text-[#5B8CFF]" />
          Carregando workspaces e recursos...
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="p-12 rounded-2xl border border-dashed border-white/10 text-center flex flex-col items-center justify-center gap-3 text-[#5A5A63]">
          <FolderKanban className="w-10 h-10 text-[#5B8CFF]/60" />
          <div>
            <p className="text-[14px] text-[#EDEDED] font-medium">Nenhum projeto encontrado</p>
            <p className="text-[12px] text-[#5A5A63] mt-1">Crie o seu primeiro workspace para agrupar bancos, caches e storage.</p>
          </div>
          <button
            onClick={() => setCreateProjectModalOpen(true)}
            className="mt-2 flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#5B8CFF] text-white text-[12px] font-semibold hover:bg-[#4a7ae8] transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Criar Projeto
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {filteredProjects.map(proj => {
            const hasAny = proj.total_resources > 0;
            const projectColor = proj.color || '#5B8CFF';

            return (
              <div 
                key={proj.name}
                className="p-5 rounded-2xl border border-white/[0.08] bg-white/[0.015] flex flex-col gap-4 shadow-sm hover:border-white/[0.12] transition"
              >
                {/* Project Header */}
                <div className="flex items-center justify-between flex-wrap gap-3 pb-3 border-b border-white/[0.06]">
                  <div className="flex items-center gap-3">
                    <span 
                      className="w-3 h-3 rounded-full shadow-[0_0_8px_var(--proj-col)]" 
                      style={{ backgroundColor: projectColor, ['--proj-col' as any]: projectColor }} 
                    />
                    <div>
                      <div className="flex items-center gap-2.5">
                        <h2 className="text-base font-mono font-medium text-[#EDEDED] capitalize">{proj.name}</h2>
                        <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-white/[0.06] text-[#8A8A93] border border-white/10">
                          {proj.total_resources} recurso(s)
                        </span>
                        {proj.name === 'default' && (
                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-white/[0.08] text-[#8A8A93]">
                            Workspace Padrão
                          </span>
                        )}
                      </div>
                      {proj.description && (
                        <p className="text-[12px] text-[#8A8A93] mt-0.5">{proj.description}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Attach Existing Resource */}
                    <button
                      onClick={() => openAttachModal(proj.name)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/[0.1] bg-white/[0.03] hover:bg-white/[0.08] text-[11.5px] text-[#EDEDED] font-mono transition cursor-pointer"
                      title="Vincular recursos existentes (DB, Redis, S3, AI) a este projeto"
                    >
                      <LinkIcon className="w-3 h-3 text-[#5B8CFF]" />
                      <span>+ Vincular Existente</span>
                    </button>

                    {/* Quick Create Buttons */}
                    <div className="flex items-center gap-1.5 pl-2 border-l border-white/[0.08]">
                      <button
                        onClick={() => onOpenCreateDb(proj.name)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[#4BFF8F]/10 text-[#4BFF8F] border border-[#4BFF8F]/20 text-[11px] font-mono hover:bg-[#4BFF8F]/20 transition cursor-pointer"
                        title="Criar novo banco PostgreSQL neste projeto"
                      >
                        <Plus className="w-3 h-3" />
                        DB
                      </button>
                      <button
                        onClick={() => openNewResModal(proj.name, 'redis')}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[#FF5C5C]/10 text-[#FF5C5C] border border-[#FF5C5C]/20 text-[11px] font-mono hover:bg-[#FF5C5C]/20 transition cursor-pointer"
                        title="Criar novo cache Redis neste projeto"
                      >
                        <Plus className="w-3 h-3" />
                        Redis
                      </button>
                      <button
                        onClick={() => openNewResModal(proj.name, 'storage')}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[#00E5FF]/10 text-[#00E5FF] border border-[#00E5FF]/20 text-[11px] font-mono hover:bg-[#00E5FF]/20 transition cursor-pointer"
                        title="Criar novo bucket S3 neste projeto"
                      >
                        <Plus className="w-3 h-3" />
                        S3
                      </button>
                      <button
                        onClick={() => openNewResModal(proj.name, 'ai')}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[#C77DFF]/10 text-[#C77DFF] border border-[#C77DFF]/20 text-[11px] font-mono hover:bg-[#C77DFF]/20 transition cursor-pointer"
                        title="Criar nova chave de IA neste projeto"
                      >
                        <Plus className="w-3 h-3" />
                        AI
                      </button>
                    </div>

                    {/* Delete Project Group */}
                    {proj.name !== 'default' && (
                      <button
                        onClick={() => handleDeleteProject(proj.name)}
                        className="p-1.5 rounded-lg border border-transparent hover:border-[#FF5C5C]/30 hover:bg-[#FF5C5C]/10 text-[#5A5A63] hover:text-[#FF5C5C] transition cursor-pointer ml-1"
                        title="Excluir projeto (recursos serão movidos para default)"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {!hasAny ? (
                  <div className="p-6 rounded-xl border border-dashed border-white/10 text-center flex flex-col items-center justify-center gap-2 text-[#5A5A63] text-[12.5px]">
                    <span>Nenhum recurso provisionado neste projeto ainda.</span>
                    <div className="flex items-center gap-2 mt-1">
                      <button
                        onClick={() => openAttachModal(proj.name)}
                        className="text-[#5B8CFF] hover:underline font-mono text-[11.5px]"
                      >
                        Vincular recurso existente
                      </button>
                      <span>·</span>
                      <button
                        onClick={() => onOpenCreateDb(proj.name)}
                        className="text-[#4BFF8F] hover:underline font-mono text-[11.5px]"
                      >
                        + Criar Novo Banco
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                    {/* 1. Databases */}
                    <div className="flex flex-col gap-2 p-3.5 rounded-xl border border-white/[0.06] bg-white/[0.015]">
                      <div className="flex items-center justify-between text-[11px] font-mono text-[#4BFF8F]">
                        <span className="flex items-center gap-1.5 font-medium">
                          <Database className="w-3.5 h-3.5" />
                          PostgreSQL ({proj.databases.length})
                        </span>
                        <button
                          onClick={() => onOpenCreateDb(proj.name)}
                          className="hover:text-white p-0.5 rounded transition"
                          title="Adicionar banco"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>

                      {proj.databases.length === 0 ? (
                        <span className="text-[11px] text-[#5A5A63] italic py-2">Nenhum banco</span>
                      ) : (
                        proj.databases.map(db => (
                          <div 
                            key={db.id || db.name}
                            onClick={() => onNavigateToDb(db.name)}
                            className="p-2.5 rounded-lg border border-white/[0.06] bg-black/40 hover:border-[#4BFF8F]/30 hover:bg-[#4BFF8F]/5 transition cursor-pointer flex flex-col gap-1.5 group relative"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-[12px] text-[#EDEDED] font-medium truncate">{db.name}</span>
                              <div className="flex items-center gap-1">
                                {proj.name !== 'default' && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDetachResource(proj.name, 'database', db.id || db.name);
                                    }}
                                    className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-[#FF5C5C] text-[#5A5A63] transition rounded"
                                    title="Desvincular (mover para default)"
                                  >
                                    <Unlink className="w-3 h-3" />
                                  </button>
                                )}
                                <span className="w-1.5 h-1.5 rounded-full bg-[#4BFF8F]" />
                              </div>
                            </div>
                            <div className="flex items-center justify-between text-[10px] text-[#8A8A93] font-mono">
                              <span>{db.size || '—'}</span>
                              <span>{db.conns || '0/100'}</span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    {/* 2. Redis Caches */}
                    <div className="flex flex-col gap-2 p-3.5 rounded-xl border border-white/[0.06] bg-white/[0.015]">
                      <div className="flex items-center justify-between text-[11px] font-mono text-[#FF5C5C]">
                        <span className="flex items-center gap-1.5 font-medium">
                          <Layers className="w-3.5 h-3.5" />
                          Redis Cache ({proj.redis.length})
                        </span>
                        <button
                          onClick={() => openNewResModal(proj.name, 'redis')}
                          className="hover:text-white p-0.5 rounded transition"
                          title="Adicionar cache"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>

                      {proj.redis.length === 0 ? (
                        <span className="text-[11px] text-[#5A5A63] italic py-2">Nenhum cache</span>
                      ) : (
                        proj.redis.map(r => (
                          <div 
                            key={r.id || r.name}
                            onClick={() => onNavigateToRedis(r.name)}
                            className="p-2.5 rounded-lg border border-white/[0.06] bg-black/40 hover:border-[#FF5C5C]/30 hover:bg-[#FF5C5C]/5 transition cursor-pointer flex flex-col gap-1.5 group relative"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-[12px] text-[#EDEDED] font-medium truncate">{r.name}</span>
                              <div className="flex items-center gap-1">
                                {proj.name !== 'default' && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDetachResource(proj.name, 'redis', r.id || r.name);
                                    }}
                                    className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-[#FF5C5C] text-[#5A5A63] transition rounded"
                                    title="Desvincular (mover para default)"
                                  >
                                    <Unlink className="w-3 h-3" />
                                  </button>
                                )}
                                <span className="w-1.5 h-1.5 rounded-full bg-[#FF5C5C]" />
                              </div>
                            </div>
                            <div className="flex items-center justify-between text-[10px] text-[#8A8A93] font-mono">
                              <span>{r.key_prefix}</span>
                              <span>{r.key_count} keys</span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    {/* 3. Storage Buckets (S3) */}
                    <div className="flex flex-col gap-2 p-3.5 rounded-xl border border-white/[0.06] bg-white/[0.015]">
                      <div className="flex items-center justify-between text-[11px] font-mono text-[#00E5FF]">
                        <span className="flex items-center gap-1.5 font-medium">
                          <HardDrive className="w-3.5 h-3.5" />
                          S3 Storage ({proj.buckets.length})
                        </span>
                        <button
                          onClick={() => openNewResModal(proj.name, 'storage')}
                          className="hover:text-white p-0.5 rounded transition"
                          title="Adicionar bucket"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>

                      {proj.buckets.length === 0 ? (
                        <span className="text-[11px] text-[#5A5A63] italic py-2">Nenhum bucket</span>
                      ) : (
                        proj.buckets.map(b => (
                          <div 
                            key={b.id || b.name}
                            onClick={() => onNavigateToStorage(b.name)}
                            className="p-2.5 rounded-lg border border-white/[0.06] bg-black/40 hover:border-[#00E5FF]/30 hover:bg-[#00E5FF]/5 transition cursor-pointer flex flex-col gap-1.5 group relative"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-[12px] text-[#EDEDED] font-medium truncate">{b.name}</span>
                              <div className="flex items-center gap-1">
                                {proj.name !== 'default' && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDetachResource(proj.name, 'storage', b.id || b.name);
                                    }}
                                    className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-[#FF5C5C] text-[#5A5A63] transition rounded"
                                    title="Desvincular (mover para default)"
                                  >
                                    <Unlink className="w-3 h-3" />
                                  </button>
                                )}
                                <span className={`text-[9px] font-mono px-1 rounded ${b.is_public ? 'text-[#4BFF8F] bg-[#4BFF8F]/10' : 'text-[#8A8A93] bg-white/10'}`}>
                                  {b.is_public ? 'Public' : 'Private'}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center justify-between text-[10px] text-[#8A8A93] font-mono">
                              <span>{b.object_count} objs</span>
                              <span>{b.size_formatted}</span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    {/* 4. AI Gateway Keys */}
                    <div className="flex flex-col gap-2 p-3.5 rounded-xl border border-white/[0.06] bg-white/[0.015]">
                      <div className="flex items-center justify-between text-[11px] font-mono text-[#C77DFF]">
                        <span className="flex items-center gap-1.5 font-medium">
                          <Sparkles className="w-3.5 h-3.5" />
                          AI Keys ({proj.ai_keys.length})
                        </span>
                        <button
                          onClick={() => openNewResModal(proj.name, 'ai')}
                          className="hover:text-white p-0.5 rounded transition"
                          title="Adicionar chave de IA"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>

                      {proj.ai_keys.length === 0 ? (
                        <span className="text-[11px] text-[#5A5A63] italic py-2">Nenhuma chave</span>
                      ) : (
                        proj.ai_keys.map(k => (
                          <div 
                            key={k.id || k.name}
                            onClick={onNavigateToAI}
                            className="p-2.5 rounded-lg border border-white/[0.06] bg-black/40 hover:border-[#C77DFF]/30 hover:bg-[#C77DFF]/5 transition cursor-pointer flex flex-col gap-1.5 group relative"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-[12px] text-[#EDEDED] font-medium truncate">{k.name}</span>
                              <div className="flex items-center gap-1">
                                {proj.name !== 'default' && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDetachResource(proj.name, 'ai', k.id || k.name);
                                    }}
                                    className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-[#FF5C5C] text-[#5A5A63] transition rounded"
                                    title="Desvincular (mover para default)"
                                  >
                                    <Unlink className="w-3 h-3" />
                                  </button>
                                )}
                                <span className="w-1.5 h-1.5 rounded-full bg-[#C77DFF]" />
                              </div>
                            </div>
                            <div className="flex items-center justify-between text-[10px] text-[#8A8A93] font-mono">
                              <span className="truncate">{k.key_prefix}</span>
                              <span>{k.rate_limit_rpm} rpm</span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL 1: CRIAR NOVO PROJETO */}
      {createProjectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-vpsql-fade">
          <div className="w-full max-w-md bg-[#0C0C0F] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
            <div className="p-5 border-b border-white/[0.08] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="p-1.5 rounded-lg bg-[#5B8CFF]/15 text-[#5B8CFF]">
                  <FolderPlus className="w-4 h-4" />
                </span>
                <div>
                  <h3 className="font-medium text-[15px] text-[#EDEDED]">Novo Workspace de Projeto</h3>
                  <p className="text-[11.5px] text-[#5A5A63]">Agrupe recursos isolados sob um mesmo domínio</p>
                </div>
              </div>
              <button 
                onClick={() => setCreateProjectModalOpen(false)}
                className="text-[#5A5A63] hover:text-[#EDEDED] p-1 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateProject} className="p-5 flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] uppercase tracking-wider text-[#5A5A63] font-mono">Nome do Projeto *</span>
                <input
                  type="text"
                  placeholder="ex: billing-system, mobile-app, analytics"
                  value={newProjectName}
                  onChange={e => setNewProjectName(e.target.value)}
                  autoFocus
                  required
                  className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-[13px] text-[#EDEDED] placeholder-[#5A5A63] font-mono focus:outline-none focus:border-[#5B8CFF]"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] uppercase tracking-wider text-[#5A5A63] font-mono">Descrição (opcional)</span>
                <input
                  type="text"
                  placeholder="ex: Microsserviço de checkout e cartões de crédito"
                  value={newProjectDesc}
                  onChange={e => setNewProjectDesc(e.target.value)}
                  className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-[13px] text-[#EDEDED] placeholder-[#5A5A63] focus:outline-none focus:border-[#5B8CFF]"
                />
              </label>

              <div className="flex flex-col gap-2">
                <span className="text-[11px] uppercase tracking-wider text-[#5A5A63] font-mono">Cor de Identificação</span>
                <div className="flex items-center gap-2.5">
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewProjectColor(c)}
                      className={`w-7 h-7 rounded-full transition flex items-center justify-center ${
                        newProjectColor === c ? 'ring-2 ring-white scale-110' : 'opacity-70 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: c }}
                    >
                      {newProjectColor === c && <Check className="w-3.5 h-3.5 text-black" />}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-white/[0.08] mt-2">
                <button
                  type="button"
                  onClick={() => setCreateProjectModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-lg border border-white/10 text-[12px] text-[#8A8A93] hover:text-[#EDEDED] hover:bg-white/[0.04] transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creatingProject}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#5B8CFF] text-white text-[12.5px] font-medium hover:bg-[#4a7ae8] transition disabled:opacity-50"
                >
                  {creatingProject ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FolderPlus className="w-3.5 h-3.5" />}
                  <span>Criar Projeto</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: VINCULAR RECURSO EXISTENTE */}
      {attachModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-vpsql-fade">
          <div className="w-full max-w-lg bg-[#0C0C0F] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="p-5 border-b border-white/[0.08] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="p-1.5 rounded-lg bg-[#5B8CFF]/15 text-[#5B8CFF]">
                  <LinkIcon className="w-4 h-4" />
                </span>
                <div>
                  <h3 className="font-medium text-[15px] text-[#EDEDED]">
                    Vincular Recurso a <span className="text-[#5B8CFF] font-mono">"{attachTargetProject}"</span>
                  </h3>
                  <p className="text-[11.5px] text-[#5A5A63]">Selecione um recurso existente para associar a este projeto</p>
                </div>
              </div>
              <button 
                onClick={() => setAttachModalOpen(false)}
                className="text-[#5A5A63] hover:text-[#EDEDED] p-1 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Type Tabs */}
            <div className="flex border-b border-white/[0.08] bg-white/[0.015] px-4 pt-2">
              <button
                onClick={() => setAttachResourceType('database')}
                className={`flex items-center gap-1.5 px-3 py-2 text-[12px] font-mono border-b-2 transition ${
                  attachResourceType === 'database'
                    ? 'border-[#4BFF8F] text-[#4BFF8F] font-semibold'
                    : 'border-transparent text-[#8A8A93] hover:text-[#EDEDED]'
                }`}
              >
                <Database className="w-3 h-3" />
                Databases ({allDatabases.length})
              </button>
              <button
                onClick={() => setAttachResourceType('redis')}
                className={`flex items-center gap-1.5 px-3 py-2 text-[12px] font-mono border-b-2 transition ${
                  attachResourceType === 'redis'
                    ? 'border-[#FF5C5C] text-[#FF5C5C] font-semibold'
                    : 'border-transparent text-[#8A8A93] hover:text-[#EDEDED]'
                }`}
              >
                <Layers className="w-3 h-3" />
                Redis ({allRedis.length})
              </button>
              <button
                onClick={() => setAttachResourceType('storage')}
                className={`flex items-center gap-1.5 px-3 py-2 text-[12px] font-mono border-b-2 transition ${
                  attachResourceType === 'storage'
                    ? 'border-[#00E5FF] text-[#00E5FF] font-semibold'
                    : 'border-transparent text-[#8A8A93] hover:text-[#EDEDED]'
                }`}
              >
                <HardDrive className="w-3 h-3" />
                Storage ({allBuckets.length})
              </button>
              <button
                onClick={() => setAttachResourceType('ai')}
                className={`flex items-center gap-1.5 px-3 py-2 text-[12px] font-mono border-b-2 transition ${
                  attachResourceType === 'ai'
                    ? 'border-[#C77DFF] text-[#C77DFF] font-semibold'
                    : 'border-transparent text-[#8A8A93] hover:text-[#EDEDED]'
                }`}
              >
                <Sparkles className="w-3 h-3" />
                AI Keys ({allAIKeys.length})
              </button>
            </div>

            {/* List of items for selected type */}
            <div className="p-4 flex-1 overflow-y-auto flex flex-col gap-2">
              {attachResourceType === 'database' && (
                allDatabases.length === 0 ? (
                  <div className="p-8 text-center text-[#5A5A63] text-[12px]">Nenhum banco de dados cadastrado</div>
                ) : (
                  allDatabases.map(db => {
                    const isCurrent = db.project_group === attachTargetProject;
                    return (
                      <div
                        key={db.id || db.name}
                        className={`p-3 rounded-xl border flex items-center justify-between transition ${
                          isCurrent 
                            ? 'border-white/[0.04] bg-white/[0.01] opacity-60' 
                            : 'border-white/[0.08] bg-white/[0.02] hover:border-[#4BFF8F]/40'
                        }`}
                      >
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[13px] font-medium text-[#EDEDED] truncate">{db.name}</span>
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded border border-white/10 text-[#8A8A93]">
                              {db.project_group || 'default'}
                            </span>
                          </div>
                          <span className="text-[11px] text-[#5A5A63] font-mono mt-0.5">
                            {db.size || '0 kB'} · {db.conns || '0'} conns
                          </span>
                        </div>
                        {isCurrent ? (
                          <span className="text-[11px] font-mono text-[#5A5A63]">Já vinculado</span>
                        ) : (
                          <button
                            onClick={() => handleAttachResource(db.id || db.name)}
                            disabled={attaching}
                            className="px-3 py-1 rounded-lg bg-[#4BFF8F]/15 border border-[#4BFF8F]/30 text-[#4BFF8F] hover:bg-[#4BFF8F]/25 text-[11.5px] font-mono transition"
                          >
                            Vincular
                          </button>
                        )}
                      </div>
                    );
                  })
                )
              )}

              {attachResourceType === 'redis' && (
                allRedis.length === 0 ? (
                  <div className="p-8 text-center text-[#5A5A63] text-[12px]">Nenhum cache Redis cadastrado</div>
                ) : (
                  allRedis.map(r => {
                    const isCurrent = r.project_group === attachTargetProject;
                    return (
                      <div
                        key={r.id || r.name}
                        className={`p-3 rounded-xl border flex items-center justify-between transition ${
                          isCurrent 
                            ? 'border-white/[0.04] bg-white/[0.01] opacity-60' 
                            : 'border-white/[0.08] bg-white/[0.02] hover:border-[#FF5C5C]/40'
                        }`}
                      >
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[13px] font-medium text-[#EDEDED] truncate">{r.name}</span>
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded border border-white/10 text-[#8A8A93]">
                              {r.project_group || 'default'}
                            </span>
                          </div>
                          <span className="text-[11px] text-[#5A5A63] font-mono mt-0.5">
                            prefix: {r.key_prefix} · {r.key_count} chaves
                          </span>
                        </div>
                        {isCurrent ? (
                          <span className="text-[11px] font-mono text-[#5A5A63]">Já vinculado</span>
                        ) : (
                          <button
                            onClick={() => handleAttachResource(r.id || r.name)}
                            disabled={attaching}
                            className="px-3 py-1 rounded-lg bg-[#FF5C5C]/15 border border-[#FF5C5C]/30 text-[#FF5C5C] hover:bg-[#FF5C5C]/25 text-[11.5px] font-mono transition"
                          >
                            Vincular
                          </button>
                        )}
                      </div>
                    );
                  })
                )
              )}

              {attachResourceType === 'storage' && (
                allBuckets.length === 0 ? (
                  <div className="p-8 text-center text-[#5A5A63] text-[12px]">Nenhum bucket S3 cadastrado</div>
                ) : (
                  allBuckets.map(b => {
                    const isCurrent = b.project_group === attachTargetProject;
                    return (
                      <div
                        key={b.id || b.name}
                        className={`p-3 rounded-xl border flex items-center justify-between transition ${
                          isCurrent 
                            ? 'border-white/[0.04] bg-white/[0.01] opacity-60' 
                            : 'border-white/[0.08] bg-white/[0.02] hover:border-[#00E5FF]/40'
                        }`}
                      >
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[13px] font-medium text-[#EDEDED] truncate">{b.name}</span>
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded border border-white/10 text-[#8A8A93]">
                              {b.project_group || 'default'}
                            </span>
                          </div>
                          <span className="text-[11px] text-[#5A5A63] font-mono mt-0.5">
                            {b.object_count} objetos · {b.size_formatted}
                          </span>
                        </div>
                        {isCurrent ? (
                          <span className="text-[11px] font-mono text-[#5A5A63]">Já vinculado</span>
                        ) : (
                          <button
                            onClick={() => handleAttachResource(b.id || b.name)}
                            disabled={attaching}
                            className="px-3 py-1 rounded-lg bg-[#00E5FF]/15 border border-[#00E5FF]/30 text-[#00E5FF] hover:bg-[#00E5FF]/25 text-[11.5px] font-mono transition"
                          >
                            Vincular
                          </button>
                        )}
                      </div>
                    );
                  })
                )
              )}

              {attachResourceType === 'ai' && (
                allAIKeys.length === 0 ? (
                  <div className="p-8 text-center text-[#5A5A63] text-[12px]">Nenhuma chave de IA cadastrada</div>
                ) : (
                  allAIKeys.map(k => {
                    const isCurrent = k.project_group === attachTargetProject;
                    return (
                      <div
                        key={k.id || k.name}
                        className={`p-3 rounded-xl border flex items-center justify-between transition ${
                          isCurrent 
                            ? 'border-white/[0.04] bg-white/[0.01] opacity-60' 
                            : 'border-white/[0.08] bg-white/[0.02] hover:border-[#C77DFF]/40'
                        }`}
                      >
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[13px] font-medium text-[#EDEDED] truncate">{k.name}</span>
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded border border-white/10 text-[#8A8A93]">
                              {k.project_group || 'default'}
                            </span>
                          </div>
                          <span className="text-[11px] text-[#5A5A63] font-mono mt-0.5">
                            {k.key_prefix} · {k.rate_limit_rpm} rpm
                          </span>
                        </div>
                        {isCurrent ? (
                          <span className="text-[11px] font-mono text-[#5A5A63]">Já vinculado</span>
                        ) : (
                          <button
                            onClick={() => handleAttachResource(k.id || k.name)}
                            disabled={attaching}
                            className="px-3 py-1 rounded-lg bg-[#C77DFF]/15 border border-[#C77DFF]/30 text-[#C77DFF] hover:bg-[#C77DFF]/25 text-[11.5px] font-mono transition"
                          >
                            Vincular
                          </button>
                        )}
                      </div>
                    );
                  })
                )
              )}
            </div>

            <div className="p-4 border-t border-white/[0.08] bg-white/[0.015] flex items-center justify-end">
              <button
                type="button"
                onClick={() => setAttachModalOpen(false)}
                className="px-3.5 py-1.5 rounded-lg border border-white/10 text-[12px] text-[#8A8A93] hover:text-[#EDEDED] transition"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: CRIAR NOVO RECURSO NO PROJETO */}
      {newResModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-vpsql-fade">
          <div className="w-full max-w-md bg-[#0C0C0F] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
            <div className="p-5 border-b border-white/[0.08] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className={`p-1.5 rounded-lg ${
                  newResType === 'redis' ? 'bg-[#FF5C5C]/15 text-[#FF5C5C]' :
                  newResType === 'storage' ? 'bg-[#00E5FF]/15 text-[#00E5FF]' :
                  'bg-[#C77DFF]/15 text-[#C77DFF]'
                }`}>
                  <Plus className="w-4 h-4" />
                </span>
                <div>
                  <h3 className="font-medium text-[15px] text-[#EDEDED]">
                    Provisionar {newResType === 'redis' ? 'Redis Cache' : newResType === 'storage' ? 'Bucket S3' : 'Chave de IA'}
                  </h3>
                  <p className="text-[11.5px] text-[#5A5A63]">
                    No projeto <span className="text-[#5B8CFF] font-mono">"{newResTargetProject}"</span>
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setNewResModalOpen(false)}
                className="text-[#5A5A63] hover:text-[#EDEDED] p-1 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleQuickCreateResource} className="p-5 flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] uppercase tracking-wider text-[#5A5A63] font-mono">
                  {newResType === 'redis' ? 'Namespace Redis' : newResType === 'storage' ? 'Nome do Bucket' : 'Identificador da Chave'} *
                </span>
                <input
                  type="text"
                  placeholder={
                    newResType === 'redis' ? 'ex: cache_sessions' :
                    newResType === 'storage' ? 'ex: public-assets' :
                    'ex: Mobile App Key'
                  }
                  value={newResName}
                  onChange={e => setNewResName(e.target.value)}
                  autoFocus
                  required
                  className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-[13px] text-[#EDEDED] placeholder-[#5A5A63] font-mono focus:outline-none focus:border-[#5B8CFF]"
                />
              </label>

              {newResType === 'storage' && (
                <label className="flex items-center gap-2.5 cursor-pointer text-[12px] text-[#EDEDED] pt-1">
                  <input
                    type="checkbox"
                    checked={newResPublic}
                    onChange={e => setNewResPublic(e.target.checked)}
                    className="rounded bg-white/10 border-white/20 text-[#00E5FF] focus:ring-0"
                  />
                  <span>Permitir leitura pública via HTTP GET</span>
                </label>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-white/[0.08] mt-2">
                <button
                  type="button"
                  onClick={() => setNewResModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-lg border border-white/10 text-[12px] text-[#8A8A93] hover:text-[#EDEDED] hover:bg-white/[0.04] transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creatingResource}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#5B8CFF] text-white text-[12.5px] font-medium hover:bg-[#4a7ae8] transition disabled:opacity-50"
                >
                  {creatingResource ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  <span>Provisionar</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
