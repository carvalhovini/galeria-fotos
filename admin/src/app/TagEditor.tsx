import { useEffect, useState } from 'preact/hooks';
import { TAGS_MAX, TAG_MAX_LENGTH, TAG_RE, normalizeTag } from '../shared/types';

interface Props {
  tags: string[];
  suggestions: string[];
  busy: boolean;
  onSave: (tags: string[]) => Promise<void>;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Algo deu errado. Tente de novo.');
const MAX_SUGGESTIONS = 12;

export default function TagEditor({ tags, suggestions, busy, onSave }: Props) {
  const [draft, setDraft] = useState<string[]>(tags);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const changed = draft.join('\n') !== tags.join('\n');
  const full = draft.length >= TAGS_MAX;
  const available = suggestions.filter((t) => !draft.includes(t)).slice(0, MAX_SUGGESTIONS);

  useEffect(() => {
    setDraft(tags);
  }, [tags.join('\n')]);

  // Adiciona as tags na ordem; para na primeira inválida e deixa o texto dela no campo.
  const add = (raws: string[], rest = '') => {
    const next = [...draft];
    let problem: string | null = null;
    let left = rest;
    for (const [i, raw] of raws.entries()) {
      const tag = normalizeTag(raw);
      if (!tag || next.includes(tag)) continue;
      if (raw.includes('—')) problem = 'Não use travessão (—) nas tags.';
      else if (next.length >= TAGS_MAX) problem = `Use no máximo ${TAGS_MAX} tags por álbum.`;
      else if (tag.length > TAG_MAX_LENGTH) problem = `Cada tag pode ter no máximo ${TAG_MAX_LENGTH} caracteres.`;
      else if (!TAG_RE.test(tag)) problem = 'Use só letras, números, espaço e hífen.';
      if (problem) {
        left = [raws.slice(i).join(','), rest].filter(Boolean).join(',');
        break;
      }
      next.push(tag);
    }
    setDraft(next);
    setText(left);
    setError(problem);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const disabled = busy || saving;

  return (
    <section class="tags-box" aria-labelledby="tags-title">
      <div class="tags-head">
        <h2 id="tags-title">Tags</h2>
        <span class="muted small">
          {draft.length} de {TAGS_MAX}
        </span>
      </div>

      {draft.length > 0 ? (
        <ul class="tag-list">
          {draft.map((tag) => (
            <li key={tag}>
              <button
                type="button"
                class="tag is-removable"
                aria-label={`Remover a tag ${tag}`}
                disabled={disabled}
                onClick={() => {
                  setDraft(draft.filter((t) => t !== tag));
                  setError(null);
                }}
              >
                {tag}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p class="muted small tags-empty">Sem tags. O álbum aparece só no filtro por data.</p>
      )}

      <form
        class="tag-form"
        onSubmit={(e) => {
          e.preventDefault();
          add([text]);
        }}
      >
        <label for="tag-input" class="visually-hidden">
          Nova tag
        </label>
        <input
          id="tag-input"
          type="text"
          value={text}
          maxLength={TAG_MAX_LENGTH + 10}
          placeholder={full ? 'Limite de tags atingido' : 'Nova tag, ex: por do sol'}
          autoComplete="off"
          autoCapitalize="off"
          enterKeyHint="done"
          disabled={disabled || full}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'tag-error' : undefined}
          onInput={(e) => {
            const value = e.currentTarget.value;
            if (value.includes(',')) {
              const parts = value.split(',');
              add(parts.slice(0, -1), parts.at(-1));
              return;
            }
            setText(value);
            setError(null);
          }}
        />
        <button type="submit" class="btn-outline" disabled={disabled || full || !normalizeTag(text)}>
          Adicionar
        </button>
      </form>

      {available.length > 0 && !full && (
        <div class="tag-suggest">
          <p class="muted small">Já usadas em outros álbuns:</p>
          <ul class="tag-list">
            {available.map((tag) => (
              <li key={tag}>
                <button type="button" class="tag is-suggestion" aria-label={`Adicionar a tag ${tag}`} disabled={disabled} onClick={() => add([tag])}>
                  + {tag}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p id="tag-error" class="form-error" role="alert">
          {error}
        </p>
      )}

      {changed && (
        <div class="rename-actions">
          <button type="button" class="btn-primary" disabled={disabled} onClick={save}>
            {saving ? 'Salvando…' : 'Salvar tags'}
          </button>
          <button
            type="button"
            class="btn-outline"
            disabled={disabled}
            onClick={() => {
              setDraft(tags);
              setText('');
              setError(null);
            }}
          >
            Descartar
          </button>
        </div>
      )}
    </section>
  );
}
