'use client';

import React, { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useVPSQL } from '@/context/VPSQLContext';
import ProjectsView from '@/components/ProjectsView';
import { RefreshCw } from 'lucide-react';

function ProjectsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialProject = searchParams.get('name') || undefined;

  const { 
    flash, 
    groupedProjects,
    refreshGroupedProjects, 
    setCreateDbModalOpen, 
    setSelectedProjectForNewDb 
  } = useVPSQL();

  return (
    <ProjectsView
      onNotify={flash}
      externalProjects={groupedProjects}
      onNavigateToDb={(dbName) => {
        router.push(`/databases?selected=${encodeURIComponent(dbName)}`);
      }}
      onNavigateToRedis={(redisName) => {
        router.push(`/redis?selected=${encodeURIComponent(redisName)}`);
      }}
      onNavigateToStorage={(bucketName) => {
        router.push(`/storage?bucket=${encodeURIComponent(bucketName)}`);
      }}
      onNavigateToAI={() => {
        router.push('/ai');
      }}
      onOpenCreateDb={(projectName) => {
        setSelectedProjectForNewDb(projectName);
        setCreateDbModalOpen(true);
      }}
      onProjectsChanged={() => {
        refreshGroupedProjects();
      }}
      initialProject={initialProject}
    />
  );
}

export default function ProjectsPage() {
  return (
    <Suspense fallback={
      <div className="p-12 text-center text-[#5A5A63] font-mono text-[12px] flex items-center justify-center gap-2">
        <RefreshCw className="w-4 h-4 animate-spin text-[#5B8CFF]" />
        Carregando Projetos Hub...
      </div>
    }>
      <ProjectsContent />
    </Suspense>
  );
}
