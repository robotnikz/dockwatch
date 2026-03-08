import type { ReactNode } from 'react';

interface AppModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  maxWidthClassName?: string;
  closeOnBackdrop?: boolean;
}

export default function AppModal({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  maxWidthClassName = 'max-w-2xl',
  closeOnBackdrop = true,
}: AppModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md"
      onClick={closeOnBackdrop ? onClose : undefined}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`w-full overflow-hidden rounded-[28px] border border-dock-border/70 bg-dock-card shadow-dock ${maxWidthClassName}`}
        onClick={(event) => event.stopPropagation()}
      >
        {title || subtitle ? (
          <div className="border-b border-dock-border/70 px-5 py-4">
            {subtitle ? <p className="text-[11px] uppercase tracking-[0.22em] text-dock-muted">{subtitle}</p> : null}
            {title ? <h3 className="mt-1 text-xl font-bold text-white">{title}</h3> : null}
          </div>
        ) : null}

        <div className="max-h-[78vh] overflow-auto p-5">{children}</div>

        {footer ? <div className="border-t border-dock-border/70 px-5 py-4">{footer}</div> : null}
      </div>
    </div>
  );
}
