import './globals.css';
import type { Metadata } from 'next';
import { DialogProvider } from '@/components/ModalDialog';
import { VPSQLProvider } from '@/context/VPSQLContext';
import AppShell from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'VPSQL — Control Plane',
  description: 'Single-node multi-tenant PostgreSQL control plane & provisioner',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-[#09090B] text-[#EDEDED] antialiased">
        <DialogProvider>
          <VPSQLProvider>
            <AppShell>
              {children}
            </AppShell>
          </VPSQLProvider>
        </DialogProvider>
      </body>
    </html>
  );
}
