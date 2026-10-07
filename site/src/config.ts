// Textos e dados editáveis do site. Nos textos, não usar travessão.

const INSTAGRAM_USER = 'carvalho_.vini';

export const SITE = {
  name: 'carvalho_.vini',
  url: 'https://carvalhovini.com',
  title: 'carvalho_.vini | Fotos',
  description: 'Fotos que eu tiro por aí. Hobby de fotógrafo amador.',

  hero: {
    title: 'Fotos que eu tiro por aí',
    subtitle: 'É um hobby. Tiro de tudo um pouco e deixei aqui pra quem quiser baixar.',
  },

  support: {
    title: 'Gostou de alguma?',
    intro: 'Pode baixar de graça. Se postar, me marca no Instagram que eu vou gostar de ver.',
    instagramLabel: 'Me marca',
    instagramText: 'Se postar alguma foto, marca o @carvalho_.vini.',
  },

  footer: "Fotos por @carvalho_.vini. Saem com marca d'água.",

  instagram: {
    user: INSTAGRAM_USER,
    handle: `@${INSTAGRAM_USER}`,
    url: `https://www.instagram.com/${INSTAGRAM_USER}/`,
    // Abre a conversa direta (app do Instagram no celular).
    dm: `https://ig.me/m/${INSTAGRAM_USER}`,
  },

  // Pedido de remoção: {id} e {titulo} são trocados pela foto e pelo álbum.
  removal: {
    link: 'Pedir para remover esta foto',
    message: 'Olá! Quero pedir a remoção da foto {id} do álbum {titulo}.',
    copied: 'Texto copiado. É só colar na conversa do Instagram.',
    copiedOpen: 'Texto copiado. Toque em "Abrir o Instagram" e cole na conversa.',
    failed: 'Não deu para copiar sozinho. Copie o texto abaixo e cole na conversa do Instagram:',
    copy: 'Copiar',
    open: 'Abrir o Instagram',
  },

  // Enquanto `key` for o placeholder, o cartão do Pix não aparece no site.
  pix: {
    key: '[SUA-CHAVE-PIX]',
    keyType: 'CPF',
  },
};

const PIX_PLACEHOLDER = '[SUA-CHAVE-PIX]';
export const HAS_PIX = SITE.pix.key.trim() !== '' && SITE.pix.key !== PIX_PLACEHOLDER;

export const R2_BASE_URL = (import.meta.env.PUBLIC_R2_BASE_URL || 'https://fotos.carvalhovini.com').replace(/\/+$/, '');

// Limite de um download (zip montado na memória do navegador), pelo tamanho estimado.
export const DOWNLOAD_LIMIT_MB = 150;

// `mb`: tamanho médio estimado de uma foto nessa resolução.
// `format`: recorte para o Instagram; só aparece nos álbuns que têm esses arquivos (`formats`).
export const RESOLUTIONS = [
  { id: '4k', label: '4K', detail: '3840 px', mb: 1, format: false },
  { id: '2k', label: '2K', detail: '2560 px', mb: 0.5, format: false },
  { id: 'fhd', label: 'Full HD', detail: '1920 px', mb: 0.3, format: false },
  { id: 'hd', label: 'HD', detail: '1280 px', mb: 0.15, format: false },
  { id: 'ig45', label: 'Instagram 4:5', detail: '1080×1350', mb: 0.2, format: true },
  { id: 'ig916', label: 'Instagram Stories 9:16', detail: '1080×1920', mb: 0.25, format: true },
] as const;

export type ResolutionId = (typeof RESOLUTIONS)[number]['id'];
export type Resolution = (typeof RESOLUTIONS)[number];
export const FORMAT_IDS: readonly ResolutionId[] = RESOLUTIONS.filter((r) => r.format).map((r) => r.id);

export const PHOTOS_PER_BATCH = 36;

export function resolution(id: ResolutionId): Resolution {
  return RESOLUTIONS.find((r) => r.id === id)!;
}

export function maxPhotosFor(id: ResolutionId): number {
  return Math.floor(DOWNLOAD_LIMIT_MB / resolution(id).mb + 1e-9);
}

// Maior resolução em que `count` fotos cabem num download, ou null se nenhuma. Num formato do
// Instagram não sugere trocar: as outras opções não têm o recorte.
export function bestFittingResolution(count: number, current: ResolutionId): Resolution | null {
  if (resolution(current).format) return null;
  return RESOLUTIONS.find((r) => !r.format && count <= maxPhotosFor(r.id)) ?? null;
}

// Opções de download de um álbum: as resoluções de sempre e os formatos que ele tem.
export function resolutionsFor(formats: readonly ResolutionId[] = []): Resolution[] {
  return RESOLUTIONS.filter((r) => !r.format || formats.includes(r.id));
}

export const FILE_PREFIX = 'carvalho_.vini';
