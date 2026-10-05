// Textos e dados editáveis do site. Nos textos, não usar travessão.

export const SITE = {
  name: 'carvalho_.vini',
  url: 'https://carvalhovini.com',
  title: 'carvalho_.vini | Fotos de basquete',
  description: 'Galeria de fotos de basquete. Escolha o jogo, selecione as fotos e baixe grátis.',

  hero: {
    eyebrow: 'Fotos de basquete',
    title: 'O jogo pelas minhas lentes',
    subtitle: 'Sou fotógrafo amador e faço isso porque gosto.',
  },

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

export const MAX_PER_DOWNLOAD = 40;

export const RESOLUTIONS = [
  { id: '4k', label: '4K', px: 3840 },
  { id: '2k', label: '2K', px: 2560 },
  { id: 'fhd', label: 'Full HD', px: 1920 },
  { id: 'hd', label: 'HD', px: 1280 },
] as const;

export type ResolutionId = (typeof RESOLUTIONS)[number]['id'];

export const FILE_PREFIX = 'carvalho_.vini';
