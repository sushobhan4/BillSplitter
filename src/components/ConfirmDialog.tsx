import React from 'react';
import { useMorphPresence } from '../hooks/useMorphPresence';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmText = 'Delete',
  cancelText = 'Cancel',
  isDestructive = true,
  onConfirm,
  onCancel,
}) => {
  const { shouldRender, isClosing } = useMorphPresence(isOpen, 180);

  if (!shouldRender) return null;

  return (
    <div
      className={`fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm overflow-y-auto ${
        isClosing ? 'animate-backdrop-out' : 'animate-backdrop-in'
      }`}
      style={{
        height: 'var(--app-height, 100dvh)',
        maxHeight: 'var(--app-height, 100dvh)',
      }}
      onClick={onCancel}
    >
      <div
        className={`w-full max-w-sm rounded-2xl bg-surface p-5 sm:p-6 shadow-2xl border border-cardStroke m-auto ${
          isClosing ? 'animate-dialog-morph-exit' : 'animate-dialog-morph-enter'
        }`}
        style={{
          maxHeight: 'calc(var(--app-height, 100dvh) - 24px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-textPrimary tracking-tight">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-textSecondary">{message}</p>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="h-[44px] px-4 rounded-xl text-sm font-bold text-textPrimary bg-surfaceAlt hover:bg-surfaceHigh border border-cardStroke transition-colors"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`h-[44px] px-5 rounded-xl text-sm font-bold transition-all shadow-sm ${
              isDestructive
                ? 'bg-giveText text-white hover:opacity-90'
                : 'bg-btnPrimaryBg text-btnPrimaryText hover:opacity-90'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
