// Textos e dados editáveis do site. Nos textos, não usar travessão.

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
    handle: '@carvalho_.vini',
    url: 'https://www.instagram.com/carvalho_.vini/',
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
export const RESOLUTIONS = [
  { id: '4k', label: '4K', px: 3840, mb: 1 },
  { id: '2k', label: '2K', px: 2560, mb: 0.5 },
  { id: 'fhd', label: 'Full HD', px: 1920, mb: 0.3 },
  { id: 'hd', label: 'HD', px: 1280, mb: 0.15 },
] as const;

export type ResolutionId = (typeof RESOLUTIONS)[number]['id'];
export type Resolution = (typeof RESOLUTIONS)[number];

export const PHOTOS_PER_BATCH = 36;

export function resolution(id: ResolutionId): Resolution {
  return RESOLUTIONS.find((r) => r.id === id)!;
}

export function maxPhotosFor(id: ResolutionId): number {
  return Math.floor(DOWNLOAD_LIMIT_MB / resolution(id).mb + 1e-9);
}

// Maior resolução em que `count` fotos cabem num download, ou null se nenhuma.
export function bestFittingResolution(count: number): Resolution | null {
  return RESOLUTIONS.find((r) => count <= maxPhotosFor(r.id)) ?? null;
}

export const FILE_PREFIX = 'carvalho_.vini';
