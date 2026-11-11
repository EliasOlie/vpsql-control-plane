'use client';

import React from 'react';
import { useVPSQL } from '@/context/VPSQLContext';
import { useDialog } from '@/components/ModalDialog';
import AIGatewayView from '@/components/AIGatewayView';

export default function AIPage() {
  const { confirm: showConfirm } = useDialog();
  const { aiWorkerStatus, refreshAiStatus, flash } = useVPSQL();

  return (
    <AIGatewayView
      workerStatus={aiWorkerStatus}
      loadingStatus={false}
      onRefreshStatus={refreshAiStatus}
      flash={flash}
      showConfirm={showConfirm}
    />
  );
}
