'use client';

import React from 'react';
import { useVPSQL } from '@/context/VPSQLContext';
import BackupsView from '@/components/BackupsView';

export default function BackupsPage() {
  const { flash, databases } = useVPSQL();

  return (
    <BackupsView
      flash={flash}
      databases={databases}
    />
  );
}
