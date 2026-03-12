import AppModal from './AppModal';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmTone?: 'danger' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

export default function ConfirmModal({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmTone = 'danger',
  onConfirm,
  onCancel,
  busy = false,
}: ConfirmModalProps) {
  return (
    <AppModal
      isOpen={isOpen}
      onClose={onCancel}
      title={title}
      maxWidthClassName="max-w-md"
      footer={(
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-xl border border-dock-border px-4 py-2 text-sm font-semibold text-dock-muted transition hover:text-white disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={[
              'rounded-xl px-4 py-2 text-sm font-bold transition disabled:opacity-50',
              confirmTone === 'danger'
                ? 'bg-dock-red text-dock-bg hover:bg-red-400'
                : 'bg-dock-accent text-dock-bg hover:bg-dock-accent/90',
            ].join(' ')}
          >
            {busy ? 'Please wait...' : confirmLabel}
          </button>
        </div>
      )}
    >
      <p className="text-sm text-dock-text">{message}</p>
    </AppModal>
  );
}
