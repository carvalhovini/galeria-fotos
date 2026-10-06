import { useEffect, useMemo, useState } from 'preact/hooks';
import PhotoTile from './PhotoTile';
import type { PhotoRef } from './types';

const MOBILE_QUERY = '(max-width: 560px)';
const TABLET_QUERY = '(max-width: 900px)';

function currentColumns() {
  if (typeof window === 'undefined') return 4;
  if (window.matchMedia(MOBILE_QUERY).matches) return 2;
  if (window.matchMedia(TABLET_QUERY).matches) return 3;
  return 4;
}

export function useColumns() {
  const [columns, setColumns] = useState(currentColumns);
  useEffect(() => {
    const queries = [MOBILE_QUERY, TABLET_QUERY].map((q) => window.matchMedia(q));
    const update = () => setColumns(currentColumns());
    queries.forEach((q) => q.addEventListener('change', update));
    update();
    return () => queries.forEach((q) => q.removeEventListener('change', update));
  }, []);
  return columns;
}

// Coluna de cada foto: sempre a mais curta, pela proporção do manifest. A escolha da foto i só
// depende das anteriores, então revelar mais fotos nunca muda a posição das que já aparecem.
function assignColumns(items: PhotoRef[], columns: number): number[] {
  const heights = new Array(columns).fill(0);
  return items.map((item) => {
    let target = 0;
    for (let c = 1; c < columns; c++) if (heights[c] < heights[target] - 0.001) target = c;
    heights[target] += item.photo.h / item.photo.w + 0.06;
    return target;
  });
}

interface Props {
  items: PhotoRef[];
  visible: number;
  columns: number;
  isSelected: (key: string) => boolean;
  onToggle: (key: string) => void;
  onZoom: (key: string) => void;
}

export default function Masonry({ items, visible, columns, isSelected, onToggle, onZoom }: Props) {
  const layout = useMemo(() => assignColumns(items, columns), [items, columns]);
  const cols: { item: PhotoRef; index: number }[][] = Array.from({ length: columns }, () => []);
  const count = Math.min(visible, items.length);
  for (let i = 0; i < count; i++) cols[layout[i]].push({ item: items[i], index: i });
  // Fotos da primeira dobra: baixam antes das outras, que ficam em lazy.
  const priorityCount = columns * 2;

  return (
    <div class="masonry">
      {cols.map((col, i) => (
        <div class="masonry-col" key={i}>
          {col.map(({ item, index }) => (
            <PhotoTile
              key={item.key}
              item={item}
              selected={isSelected(item.key)}
              onToggle={onToggle}
              onZoom={onZoom}
              priority={index < priorityCount}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
