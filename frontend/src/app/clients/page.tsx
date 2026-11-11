'use client';

import React from 'react';
import { useVPSQL } from '@/context/VPSQLContext';
import { useDialog } from '@/components/ModalDialog';
import ClientsAuthView from '@/components/ClientsAuthView';

export default function ClientsPage() {
  const { confirm: showConfirm } = useDialog();
  const { flash } = useVPSQL();

  return (
    <ClientsAuthView
      flash={flash}
      showConfirm={showConfirm}
    />
  );
}
