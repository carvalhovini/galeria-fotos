import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

interface Props {
  title: string;
  confirmLabel: string;
  confirmDisabled?: boolean;
  busy?: boolean;
  busyLabel?: string;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  children: ComponentChildren;
}

export default function ConfirmDialog({
  title,
  confirmLabel,
  confirmDisabled,
  busy,
  busyLabel = 'Excluindo…',
  error,
  onConfirm,
  onCancel,
  children,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      class="confirm"
      aria-labelledby="confirm-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (!confirmDisabled && !busy) onConfirm();
        }}
      >
        <h2 id="confirm-title">{title}</h2>
        <div class="confirm-body">{children}</div>
        {error && (
          <p class="form-error" role="alert">
            {error}
          </p>
        )}
        <div class="confirm-actions">
          <button type="button" class="btn-outline" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" class="btn-danger" disabled={confirmDisabled || busy}>
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
