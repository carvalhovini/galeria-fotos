import { useEffect, useRef, useState } from 'preact/hooks';
import { SITE } from '../config';
import { formatDateLong } from '../lib/manifest';
import type { PhotoRef } from './types';

interface Props {
  item: PhotoRef;
}

// copied: o link abriu a conversa; copiedOpen: copiou depois do toque, falta abrir;
// failed: não copiou, o texto aparece na tela.
type State = 'idle' | 'copied' | 'copiedOpen' | 'failed';

const NOTE_MS = 6000;

export function removalMessage(item: PhotoRef): string {
  const title = item.album.title || formatDateLong(item.album.date);
  return SITE.removal.message.replace('{id}', item.photo.id).replace('{titulo}', title);
}

// Cópia síncrona, ainda dentro do toque: o Safari do iPhone bloqueia abrir aba depois de
// esperar uma Promise. A área de texto fica dentro de `host` porque, com o visualizador
// aberto (dialog modal), o resto da página não aceita seleção.
function copySync(text: string, host: HTMLElement): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.setAttribute('aria-hidden', 'true');
  area.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;';
  host.appendChild(area);
  area.select();
  area.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

export default function RemovalLink({ item }: Props) {
  const [state, setState] = useState<State>('idle');
  const linkRef = useRef<HTMLAnchorElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  const message = removalMessage(item);

  useEffect(() => setState('idle'), [item.key]);

  useEffect(() => {
    if (state !== 'copied') return;
    const timer = setTimeout(() => setState('idle'), NOTE_MS);
    return () => clearTimeout(timer);
  }, [state]);

  const onClick = (e: MouseEvent) => {
    const host = linkRef.current?.parentElement ?? document.body;
    if (copySync(message, host)) {
      linkRef.current?.focus();
      setState('copied');
      return;
    }
    e.preventDefault();
    if (!navigator.clipboard?.writeText) return setState('failed');
    navigator.clipboard.writeText(message).then(
      () => setState('copiedOpen'),
      () => setState('failed'),
    );
  };

  const copyAgain = () => {
    navigator.clipboard?.writeText(message).then(
      () => setState('copiedOpen'),
      () => {
        const range = document.createRange();
        if (textRef.current) range.selectNodeContents(textRef.current);
        getSelection()?.removeAllRanges();
        getSelection()?.addRange(range);
      },
    );
  };

  return (
    <div class="removal">
      <a ref={linkRef} class="removal-link" href={SITE.instagram.dm} target="_blank" rel="noopener" onClick={onClick}>
        {SITE.removal.link}
      </a>
      <div class="removal-live" role="status">
        {state === 'copied' && <p class="removal-note">{SITE.removal.copied}</p>}
        {(state === 'copiedOpen' || state === 'failed') && (
          <div class="removal-box">
            <p class="removal-note">{state === 'failed' ? SITE.removal.failed : SITE.removal.copiedOpen}</p>
            <p ref={textRef} class="removal-text">
              {message}
            </p>
            <div class="removal-actions">
              {state === 'failed' && (
                <button type="button" class="btn-outline removal-btn" onClick={copyAgain}>
                  {SITE.removal.copy}
                </button>
              )}
              <a class="btn-outline removal-btn" href={SITE.instagram.dm} target="_blank" rel="noopener" onClick={() => setState('idle')}>
                {SITE.removal.open}
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
