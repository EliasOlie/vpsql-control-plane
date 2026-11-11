'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useVPSQL } from '@/context/VPSQLContext';
import StorageView from '@/components/StorageView';
import { RefreshCw } from 'lucide-react';

function StorageContent() {
  const searchParams = useSearchParams();
  const initialProject = searchParams.get('project') || undefined;
  const { flash } = useVPSQL();

  return (
    <StorageView
      onNotify={flash}
      initialProject={initialProject}
    />
  );
}

export default function StoragePage() {
  return (
    <Suspense fallback={
      <div className="p-12 text-center text-[#5A5A63] font-mono text-[12px] flex items-center justify-center gap-2">
        <RefreshCw className="w-4 h-4 animate-spin text-[#00E5FF]" />
        Carregando Storage S3...
      </div>
    }>
      <StorageContent />
    </Suspense>
  );
}
