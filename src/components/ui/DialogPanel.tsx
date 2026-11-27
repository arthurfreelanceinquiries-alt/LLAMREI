import { useLayoutEffect, useRef, type ReactNode } from 'react';

export function DialogPanel({ label, className, onClose, children }: {
  label: string;
  className: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    const panel = dialog.current;
    if (!panel) return;
    const trigger = document.activeElement;
    panel.showModal();
    return () => {
      panel.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-label={label}
      className={`ds-dialog ${className}`}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); }}
    >
      {children}
    </dialog>
  );
}
