export interface Notice {
  id: number;
  kind: 'success' | 'warning' | 'error';
  text: string;
  retryUrls?: string[];
}

interface Props {
  notices: Notice[];
  retrying: number | null;
  onDismiss: (id: number) => void;
  onRetry: (notice: Notice) => void;
}

export default function Notices({ notices, retrying, onDismiss, onRetry }: Props) {
  return (
    <div class="notices">
      {notices.map((n) => (
        <div key={n.id} class={`notice notice-${n.kind}`} role={n.kind === 'success' ? 'status' : 'alert'}>
          <p>{n.text}</p>
          <div class="notice-actions">
            {n.retryUrls && n.retryUrls.length > 0 && (
              <button type="button" class="btn-outline" disabled={retrying !== null} onClick={() => onRetry(n)}>
                {retrying === n.id ? 'Limpando…' : 'Tentar limpar de novo'}
              </button>
            )}
            <button type="button" class="notice-close" aria-label="Fechar aviso" onClick={() => onDismiss(n.id)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
