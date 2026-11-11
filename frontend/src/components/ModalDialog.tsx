'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { 
  AlertTriangle, 
  CheckCircle2, 
  Info, 
  XCircle, 
  Trash2, 
  AlertCircle,
  X 
} from 'lucide-react';

export type DialogVariant = 'danger' | 'warning' | 'primary' | 'info';
export type AlertType = 'success' | 'error' | 'warning' | 'info';

export interface ConfirmOptions {
  title: string;
  description: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: DialogVariant;
  requireMatch?: string; // If set, user must type this exact string to enable confirm
  matchPlaceholder?: string;
}

export interface AlertOptions {
  title: string;
  description: React.ReactNode;
  type?: AlertType;
  closeText?: string;
}

interface DialogContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  alert: (options: AlertOptions) => Promise<void>;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    throw new Error('useDialog must be used within a DialogProvider');
  }
  return ctx;
}

export function DialogProvider({ children }: { children: React.ReactNode }) {
  // Confirm state
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    options: ConfirmOptions;
    resolve: (val: boolean) => void;
  } | null>(null);

  // Alert state
  const [alertState, setAlertState] = useState<{
    open: boolean;
    options: AlertOptions;
    resolve: () => void;
  } | null>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise(resolve => {
      setConfirmState({
        open: true,
        options,
        resolve,
      });
    });
  }, []);

  const alert = useCallback((options: AlertOptions): Promise<void> => {
    return new Promise(resolve => {
      setAlertState({
        open: true,
        options,
        resolve,
      });
    });
  }, []);

  const closeConfirm = (confirmed: boolean) => {
    if (confirmState) {
      confirmState.resolve(confirmed);
      setConfirmState(null);
    }
  };

  const closeAlert = () => {
    if (alertState) {
      alertState.resolve();
      setAlertState(null);
    }
  };

  return (
    <DialogContext.Provider value={{ confirm, alert }}>
      {children}
      {confirmState && (
        <ConfirmDialogModal
          options={confirmState.options}
          onConfirm={() => closeConfirm(true)}
          onCancel={() => closeConfirm(false)}
        />
      )}
      {alertState && (
        <AlertDialogModal
          options={alertState.options}
          onClose={closeAlert}
        />
      )}
    </DialogContext.Provider>
  );
}

/* -------------------------------------------------------------------------- */
/* CONFIRM MODAL COMPONENT                                                    */
/* -------------------------------------------------------------------------- */

function ConfirmDialogModal({
  options,
  onConfirm,
  onCancel,
}: {
  options: ConfirmOptions;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    title,
    description,
    confirmText = 'Confirmar',
    cancelText = 'Cancelar',
    variant = 'danger',
    requireMatch,
    matchPlaceholder,
  } = options;

  const isMatchValid = !requireMatch || inputValue.trim() === requireMatch.trim();

  useEffect(() => {
    if (requireMatch) {
      inputRef.current?.focus();
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      } else if (e.key === 'Enter' && isMatchValid) {
        onConfirm();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [requireMatch, isMatchValid, onCancel, onConfirm]);

  const variantStyles = {
    danger: {
      glow: 'shadow-[0_0_60px_-15px_rgba(255,92,92,0.3)]',
      border: 'border-[#FF5C5C]/30',
      badgeBg: 'bg-[#FF5C5C]/10',
      badgeBorder: 'border-[#FF5C5C]/30',
      iconColor: 'text-[#FF5C5C]',
      buttonBg: 'bg-[#FF5C5C] hover:bg-[#FF7373] text-white shadow-[0_0_24px_-6px_rgba(255,92,92,0.7)]',
      icon: <Trash2 className="w-5 h-5 text-[#FF5C5C]" />,
    },
    warning: {
      glow: 'shadow-[0_0_60px_-15px_rgba(255,176,32,0.3)]',
      border: 'border-[#FFB020]/30',
      badgeBg: 'bg-[#FFB020]/10',
      badgeBorder: 'border-[#FFB020]/30',
      iconColor: 'text-[#FFB020]',
      buttonBg: 'bg-[#FFB020] hover:bg-[#FFC043] text-[#04140B] shadow-[0_0_24px_-6px_rgba(255,176,32,0.7)]',
      icon: <AlertTriangle className="w-5 h-5 text-[#FFB020]" />,
    },
    primary: {
      glow: 'shadow-[0_0_60px_-15px_rgba(75,255,143,0.3)]',
      border: 'border-[#4BFF8F]/30',
      badgeBg: 'bg-[#4BFF8F]/10',
      badgeBorder: 'border-[#4BFF8F]/30',
      iconColor: 'text-[#4BFF8F]',
      buttonBg: 'bg-[#4BFF8F] hover:bg-[#8DFFBD] text-[#04140B] shadow-[0_0_24px_-6px_rgba(75,255,143,0.7)]',
      icon: <AlertCircle className="w-5 h-5 text-[#4BFF8F]" />,
    },
    info: {
      glow: 'shadow-[0_0_60px_-15px_rgba(91,140,255,0.3)]',
      border: 'border-[#5B8CFF]/30',
      badgeBg: 'bg-[#5B8CFF]/10',
      badgeBorder: 'border-[#5B8CFF]/30',
      iconColor: 'text-[#5B8CFF]',
      buttonBg: 'bg-[#5B8CFF] hover:bg-[#7DA5FF] text-white shadow-[0_0_24px_-6px_rgba(91,140,255,0.7)]',
      icon: <Info className="w-5 h-5 text-[#5B8CFF]" />,
    },
  }[variant];

  return (
    <div 
      onClick={onCancel}
      className="fixed inset-0 z-50 bg-[#040406]/75 backdrop-blur-sm flex items-center justify-center p-5 animate-vpsql-fade"
    >
      <div 
        onClick={e => e.stopPropagation()}
        className={`w-full max-w-[460px] border ${variantStyles.border} rounded-2xl bg-[#121216]/95 backdrop-blur-2xl ${variantStyles.glow} overflow-hidden flex flex-col`}
      >
        {/* Header */}
        <div className="p-5 pb-3 flex items-start gap-3.5 border-b border-white/[0.07]">
          <div className={`p-2.5 rounded-xl ${variantStyles.badgeBg} border ${variantStyles.badgeBorder} flex items-center justify-center flex-shrink-0`}>
            {variantStyles.icon}
          </div>
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold tracking-tight text-[#EDEDED]">{title}</h2>
            <span className="font-mono text-[11px] text-[#5A5A63]">VPSQL confirmation prompt</span>
          </div>
          <button 
            onClick={onCancel}
            className="text-[#5A5A63] hover:text-[#EDEDED] p-1 rounded-lg transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 flex flex-col gap-4 text-[13px] text-[#8A8A93] leading-relaxed">
          <div>{description}</div>

          {requireMatch && (
            <div className="flex flex-col gap-2 p-3 border border-white/[0.08] rounded-xl bg-[#09090B]">
              <span className="text-[11px] text-[#5A5A63] uppercase tracking-wider">
                Digite <strong className="text-[#EDEDED] font-mono select-all">{requireMatch}</strong> para confirmar:
              </span>
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                placeholder={matchPlaceholder || requireMatch}
                className="p-2 border border-white/10 rounded-lg bg-[#121216] text-[#EDEDED] font-mono text-[12.5px] outline-none focus:border-[#FF5C5C]/60 focus:ring-1 focus:ring-[#FF5C5C]/20"
              />
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-5 py-3.5 border-t border-white/[0.07] bg-white/[0.015] flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 border border-white/10 rounded-lg text-[#8A8A93] hover:text-[#EDEDED] hover:bg-white/[0.04] text-[12.5px] transition"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!isMatchValid}
            className={`px-4 py-2 rounded-lg font-semibold text-[12.5px] transition disabled:opacity-40 disabled:pointer-events-none ${variantStyles.buttonBg}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* ALERT MODAL COMPONENT                                                      */
/* -------------------------------------------------------------------------- */

function AlertDialogModal({
  options,
  onClose,
}: {
  options: AlertOptions;
  onClose: () => void;
}) {
  const {
    title,
    description,
    type = 'info',
    closeText = 'Entendido',
  } = options;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const typeConfig = {
    success: {
      border: 'border-[#4BFF8F]/30',
      glow: 'shadow-[0_0_60px_-15px_rgba(75,255,143,0.3)]',
      badgeBg: 'bg-[#4BFF8F]/10',
      badgeBorder: 'border-[#4BFF8F]/30',
      buttonBg: 'bg-[#4BFF8F] hover:bg-[#8DFFBD] text-[#04140B] shadow-[0_0_24px_-6px_rgba(75,255,143,0.7)]',
      icon: <CheckCircle2 className="w-5 h-5 text-[#4BFF8F]" />,
    },
    error: {
      border: 'border-[#FF5C5C]/30',
      glow: 'shadow-[0_0_60px_-15px_rgba(255,92,92,0.3)]',
      badgeBg: 'bg-[#FF5C5C]/10',
      badgeBorder: 'border-[#FF5C5C]/30',
      buttonBg: 'bg-[#FF5C5C] hover:bg-[#FF7373] text-white shadow-[0_0_24px_-6px_rgba(255,92,92,0.7)]',
      icon: <XCircle className="w-5 h-5 text-[#FF5C5C]" />,
    },
    warning: {
      border: 'border-[#FFB020]/30',
      glow: 'shadow-[0_0_60px_-15px_rgba(255,176,32,0.3)]',
      badgeBg: 'bg-[#FFB020]/10',
      badgeBorder: 'border-[#FFB020]/30',
      buttonBg: 'bg-[#FFB020] hover:bg-[#FFC043] text-[#04140B] shadow-[0_0_24px_-6px_rgba(255,176,32,0.7)]',
      icon: <AlertTriangle className="w-5 h-5 text-[#FFB020]" />,
    },
    info: {
      border: 'border-[#5B8CFF]/30',
      glow: 'shadow-[0_0_60px_-15px_rgba(91,140,255,0.3)]',
      badgeBg: 'bg-[#5B8CFF]/10',
      badgeBorder: 'border-[#5B8CFF]/30',
      buttonBg: 'bg-[#5B8CFF] hover:bg-[#7DA5FF] text-white shadow-[0_0_24px_-6px_rgba(91,140,255,0.7)]',
      icon: <Info className="w-5 h-5 text-[#5B8CFF]" />,
    },
  }[type];

  return (
    <div 
      onClick={onClose}
      className="fixed inset-0 z-50 bg-[#040406]/75 backdrop-blur-sm flex items-center justify-center p-5 animate-vpsql-fade"
    >
      <div 
        onClick={e => e.stopPropagation()}
        className={`w-full max-w-[440px] border ${typeConfig.border} rounded-2xl bg-[#121216]/95 backdrop-blur-2xl ${typeConfig.glow} overflow-hidden flex flex-col`}
      >
        <div className="p-5 pb-3 flex items-start gap-3.5 border-b border-white/[0.07]">
          <div className={`p-2.5 rounded-xl ${typeConfig.badgeBg} border ${typeConfig.badgeBorder} flex items-center justify-center flex-shrink-0`}>
            {typeConfig.icon}
          </div>
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold tracking-tight text-[#EDEDED]">{title}</h2>
            <span className="font-mono text-[11px] text-[#5A5A63]">VPSQL system notification</span>
          </div>
          <button 
            onClick={onClose}
            className="text-[#5A5A63] hover:text-[#EDEDED] p-1 rounded-lg transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 text-[13px] text-[#8A8A93] leading-relaxed">
          {description}
        </div>

        <div className="px-5 py-3.5 border-t border-white/[0.07] bg-white/[0.015] flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className={`px-4 py-2 rounded-lg font-semibold text-[12.5px] transition ${typeConfig.buttonBg}`}
          >
            {closeText}
          </button>
        </div>
      </div>
    </div>
  );
}
