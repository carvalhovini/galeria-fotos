import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { TITLE_MAX, type Album } from '../shared/types';
import ConfirmDialog from './ConfirmDialog';
import { coverId, formatDate, normalizeTitle, plural, thumbUrl } from './format';
import TagEditor from './TagEditor';

interface Props {
  album: Album;
  base: string;
  busy: boolean;
  lockMessage: string | null;
  tagSuggestions: string[];
  onBack: () => void;
  onAddPhotos: () => void;
  onRename: (title: string) => Promise<void>;
  onSetCover: (photoId: string) => Promise<void>;
  onSaveTags: (tags: string[]) => Promise<void>;
  onDeletePhotos: (ids: string[]) => Promise<void>;
  onDeleteAlbum: (confirmTitle: string) => Promise<void>;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Algo deu errado. Tente de novo.');

export default function AlbumView({
  album,
  base,
  busy,
  lockMessage,
  tagSuggestions,
  onBack,
  onAddPhotos,
  onRename,
  onSetCover,
  onSaveTags,
  onDeletePhotos,
  onDeleteAlbum,
}: Props) {
  const locked = lockMessage !== null;
  const cover = coverId(album);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(album.title);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<'photos' | 'album' | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Descarta da seleção fotos que sumiram do álbum (excluídas aqui ou em outra aba).
  const photoIds = useMemo(() => new Set(album.photos.map((p) => p.id)), [album]);
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => photoIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [photoIds]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const allSelected = album.photos.length > 0 && selected.size === album.photos.length;
  const count = selected.size;

  const submitRename = async () => {
    const title = normalizeTitle(draft);
    if (!title) return setRenameError('Digite um título.');
    if (title === album.title) return setEditing(false);
    setSaving(true);
    setRenameError(null);
    try {
      await onRename(title);
      setEditing(false);
    } catch (err) {
      setRenameError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    setDialogError(null);
    try {
      if (dialog === 'photos') {
        await onDeletePhotos([...selected]);
        setSelected(new Set());
      } else {
        await onDeleteAlbum(confirmText);
      }
      setDialog(null);
    } catch (err) {
      setDialogError(errorText(err));
    }
  };

  const openDialog = (kind: 'photos' | 'album') => {
    setDialogError(null);
    setConfirmText('');
    setDialog(kind);
  };

  const removesWholeAlbum = count === album.photos.length;
  const onlySelected = count === 1 ? [...selected][0] : null;

  const setCover = async () => {
    if (!onlySelected) return;
    try {
      await onSetCover(onlySelected);
      setSelected(new Set());
    } catch {
      // o aviso de erro aparece no topo
    }
  };

  return (
    <section aria-labelledby="album-date" class={count > 0 ? 'has-bar' : undefined}>
      <a
        class="back"
        href="./"
        onClick={(e) => {
          e.preventDefault();
          onBack();
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M15 5l-7 7 7 7" />
        </svg>
        Todos os álbuns
      </a>

      <h1 id="album-date" class="page-title">
        {formatDate(album.date)}
      </h1>

      {editing ? (
        <form
          class="rename"
          onSubmit={(e) => {
            e.preventDefault();
            submitRename();
          }}
        >
          <label for="album-title-input">Título do álbum</label>
          <input
            id="album-title-input"
            ref={inputRef}
            type="text"
            value={draft}
            maxLength={TITLE_MAX}
            autoComplete="off"
            onInput={(e) => setDraft(e.currentTarget.value)}
            aria-invalid={renameError ? true : undefined}
            aria-describedby={renameError ? 'rename-error' : undefined}
          />
          {renameError && (
            <p id="rename-error" class="form-error" role="alert">
              {renameError}
            </p>
          )}
          <div class="rename-actions">
            <button type="submit" class="btn-primary" disabled={saving}>
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
            <button
              type="button"
              class="btn-outline"
              disabled={saving}
              onClick={() => {
                setEditing(false);
                setRenameError(null);
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <div class="title-row">
          <p class="album-title">{album.title}</p>
          <button
            type="button"
            class="btn-outline"
            disabled={busy}
            onClick={() => {
              setDraft(album.title);
              setEditing(true);
            }}
          >
            Renomear
          </button>
          <button type="button" class="btn-outline" disabled={busy || locked} onClick={onAddPhotos}>
            Adicionar fotos
          </button>
        </div>
      )}

      <TagEditor tags={album.tags ?? []} suggestions={tagSuggestions} busy={busy} onSave={onSaveTags} />

      {locked && (
        <p class="lock-note" role="status">
          {lockMessage} Exclusões e novos envios ficam bloqueados até ela terminar.
        </p>
      )}

      <div class="toolbar">
        <p>
          {plural(album.photos.length, 'foto', 'fotos')}
          <span class="muted"> · toque para selecionar ou trocar a capa</span>
        </p>
        <button type="button" class="btn-outline" disabled={busy} onClick={() => setSelected(allSelected ? new Set() : new Set(photoIds))}>
          {allSelected ? 'Desmarcar todas' : 'Selecionar todas'}
        </button>
      </div>

      <ul class="admin-grid">
        {album.photos.map((photo, i) => {
          const on = selected.has(photo.id);
          const isCover = photo.id === cover;
          return (
            <li key={photo.id}>
              <button
                type="button"
                class={`atile${on ? ' is-selected' : ''}`}
                aria-pressed={on}
                aria-label={`Foto ${i + 1}: ${photo.id}${isCover ? ', capa do álbum' : ''}`}
                disabled={busy}
                onClick={() => toggle(photo.id)}
              >
                <img src={thumbUrl(base, album.id, photo.id)} alt="" loading="lazy" width={300} height={300} />
                <span class="tile-check" aria-hidden="true">
                  {on && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  )}
                </span>
                {isCover && (
                  <span class="atile-cover" aria-hidden="true">
                    Capa
                  </span>
                )}
                <span class="atile-id">{photo.id}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <section class="danger-zone" aria-labelledby="danger-title">
        <h2 id="danger-title">Excluir álbum</h2>
        <p>Remove o álbum do site e apaga todas as fotos dele do bucket, em todas as resoluções. Não dá para desfazer.</p>
        <button type="button" class="btn-danger" disabled={busy || locked} onClick={() => openDialog('album')}>
          Excluir álbum inteiro
        </button>
      </section>

      {count > 0 && (
        <div class="action-bar" role="region" aria-label="Fotos selecionadas">
          <div class="action-summary">
            <span class="action-count">{plural(count, 'foto selecionada', 'fotos selecionadas')}</span>
            <button type="button" class="link-btn" disabled={busy} onClick={() => setSelected(new Set())}>
              Limpar seleção
            </button>
          </div>
          <div class="action-buttons">
            {onlySelected && onlySelected !== cover && (
              <button type="button" class="btn-outline" disabled={busy} onClick={setCover}>
                Definir como capa
              </button>
            )}
            <button type="button" class="btn-danger" disabled={busy || locked} onClick={() => openDialog('photos')}>
              Excluir {count === 1 ? 'foto' : `${count} fotos`}
            </button>
          </div>
        </div>
      )}

      {dialog === 'photos' && (
        <ConfirmDialog
          title={`Excluir ${plural(count, 'foto', 'fotos')}?`}
          confirmLabel="Excluir"
          busy={busy}
          error={dialogError}
          onConfirm={confirmDelete}
          onCancel={() => setDialog(null)}
        >
          <p>As 6 versões de cada foto (miniatura, prévia e downloads) serão apagadas do bucket. Não dá para desfazer.</p>
          {removesWholeAlbum && <p class="warn-text">Todas as fotos estão selecionadas: o álbum também sai do site.</p>}
        </ConfirmDialog>
      )}

      {dialog === 'album' && (
        <ConfirmDialog
          title="Excluir o álbum inteiro?"
          confirmLabel="Excluir álbum"
          confirmDisabled={normalizeTitle(confirmText) !== normalizeTitle(album.title)}
          busy={busy}
          error={dialogError}
          onConfirm={confirmDelete}
          onCancel={() => setDialog(null)}
        >
          <p>
            {plural(album.photos.length, 'foto será apagada', 'fotos serão apagadas')} do bucket, em todas as resoluções, e o álbum sai do
            site.
          </p>
          <label for="confirm-title-input">
            Para confirmar, digite o título: <strong>{album.title}</strong>
          </label>
          <input
            id="confirm-title-input"
            type="text"
            value={confirmText}
            autoComplete="off"
            autoCapitalize="off"
            spellcheck={false}
            onInput={(e) => setConfirmText(e.currentTarget.value)}
          />
        </ConfirmDialog>
      )}
    </section>
  );
}
