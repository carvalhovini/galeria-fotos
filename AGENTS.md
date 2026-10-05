# Galeria de fotos (carvalhovini.com)

Site de galeria de fotos esportivas (foco em basquete) de um fotógrafo amador.
Instagram do autor: @carvalho_.vini (https://www.instagram.com/carvalho_.vini/).

## Objetivo do produto

- Visitante acessa sem login, filtra as fotos por data e vê uma galeria.
- Seleciona uma ou várias fotos e baixa em 4K, 2K, Full HD ou HD.
- Toda foto baixada sai com marca d'água de texto: `@carvalho_.vini`.
- Download é grátis. Existe um bloco opcional de ajuda de custo via Pix e um pedido
  para marcar @carvalho_.vini no Instagram. Nada disso é obrigatório.
- Prioridade total para celular: a maioria dos acessos virá do WhatsApp e do Instagram.

## Arquitetura

- **Armazenamento:** Cloudflare R2, bucket `galeria-fotos`.
- **URL pública das fotos:** `https://fotos.carvalhovini.com` (domínio customizado do bucket).
- **Site:** Astro (estático), com ilhas interativas leves. Hospedagem no Cloudflare Pages.
- **Domínio do site:** `https://carvalhovini.com`.
- **Lista de fotos:** `manifest.json` na raiz do bucket. O site lê esse arquivo em tempo de
  execução, então publicar um jogo novo NÃO exige novo deploy.
- **Download em lote:** feito no navegador (fetch dos arquivos + zip com `fflate`), sem servidor.
  Foto única baixa direto. Limite sugerido de seleção: 40 fotos por download.
- **Processamento e upload:** scripts Node.js (ESM) rodando localmente, com `sharp`.

## Estrutura do repositório

```
galeria-fotos/
  AGENTS.md
  README.md
  .env.example          # só nomes de variáveis, nunca valores
  .gitignore
  originals/            # GITIGNORED: fotos originais, uma pasta por jogo
  output/               # GITIGNORED: arquivos gerados pelo script
  assets/fonts/         # fonte TTF usada na marca d'água (licença livre, ex: DM Sans Bold)
  scripts/              # processamento e upload
  site/                 # projeto Astro
  admin/                # gerenciador (Worker + interface Preact), projeto separado
  design/               # referências visuais (HTML do design desktop e celular)
```

## Convenções de pastas dos originais

`originals/AAAA-MM-DD_nome-do-jogo/IMG_0001.jpg`

A data e o nome do álbum vêm do nome da pasta. A data EXIF serve só para ordenar fotos
dentro do álbum.

## Processamento de imagem (scripts/)

Para cada foto original, gerar:

| Arquivo | Lado maior | Marca d'água |
|---|---|---|
| thumb | 900 px | não |
| preview | 1600 px | não |
| dl/4k | 3840 px | sim |
| dl/2k | 2560 px | sim |
| dl/fhd | 1920 px | sim |
| dl/hd | 1280 px | sim |

Regras:
- JPEG, qualidade ~85, `mozjpeg: true`. Nunca ampliar (`withoutEnlargement: true`).
- Aplicar `.rotate()` para respeitar a orientação EXIF.
- **Remover todos os metadados** dos arquivos públicos (inclui GPS). Não usar `withMetadata`.
- Marca d'água: texto `@carvalho_.vini`, branco com sombra suave, opacidade ~75%,
  canto inferior direito, margem ~2,5% do lado maior, largura ~16% do lado maior.
  Deve ser legível mas discreta.
- Renderizar o texto de forma determinística: converter o texto em caminhos SVG usando a fonte
  TTF do repositório (por exemplo com `opentype.js`), e NÃO depender de fontes do sistema.
- O script deve ser idempotente: pular arquivos já processados/enviados.

## Estrutura no R2

```
albums/{albumId}/thumb/{photoId}.jpg
albums/{albumId}/preview/{photoId}.jpg
albums/{albumId}/dl/4k/{photoId}.jpg
albums/{albumId}/dl/2k/{photoId}.jpg
albums/{albumId}/dl/fhd/{photoId}.jpg
albums/{albumId}/dl/hd/{photoId}.jpg
manifest.json
manifest-backups/manifest-{data-hora}-{etag}.json   # cópia gravada pelo gerenciador antes de cada alteração
```

### Formato do manifest.json

```json
{
  "updatedAt": "2026-10-05T12:00:00Z",
  "albums": [
    {
      "id": "2026-09-27_nome-do-jogo",
      "date": "2026-09-27",
      "title": "Nome do jogo",
      "photos": [
        { "id": "IMG_0001", "w": 4928, "h": 3264 }
      ]
    }
  ]
}
```

As URLs são derivadas por convenção a partir de `albumId` e `photoId`, então o manifest
não precisa repetir caminhos.

## Upload

- Usar `@aws-sdk/client-s3` apontando para o endpoint S3 do R2.
- Variáveis de ambiente (apenas nomes, valores ficam no `.env` local):
  `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`.
- Definir `Content-Type` correto e `Cache-Control: public, max-age=31536000, immutable`
  nos arquivos de foto. O `manifest.json` usa cache curto (`max-age=60`).
- Título do álbum: `titulo.txt` tem prioridade; sem ele, mantém o título que já está no
  manifest (pode ter sido renomeado no gerenciador); álbum novo usa o nome da pasta.
- O `manifest.json` é gravado com escrita condicional (`If-Match` com o ETag lido, ou
  `If-None-Match: *` se não existir). Em conflito (412), ler de novo e refazer a mesclagem.

## Gerenciador (admin/)

- Worker em TypeScript com assets estáticos (interface Preact, mesmo visual do site, celular
  primeiro). Projeto separado com `admin/wrangler.jsonc`: nome `galeria-admin`, domínio
  `admin.carvalhovini.com`, `workers_dev` e `preview_urls` desligados.
- O Worker roda antes dos assets só em `/api/*`. Bucket via binding R2 `BUCKET`.
- Segurança:
  - O domínio fica atrás do Cloudflare Access. Toda rota `/api` valida o JWT do cabeçalho
    `Cf-Access-Jwt-Assertion` (assinatura RS256 contra `{ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`
    escolhendo a chave pelo `kid`, `iss`, `aud` = `ACCESS_AUD` e `exp`). Sem JWT válido: 401.
    Sem `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` configurados: 500, nunca liberar.
  - Requisições que alteram dados (PATCH, POST, DELETE) exigem `X-Galeria-Admin: 1` e
    recusam `Sec-Fetch-Site` diferente de `same-origin` (403).
  - Nunca registrar token, JWT ou secrets nos logs; só rota, status e códigos de erro.
  - Nada de modo de contorno da autenticação no código. Testes locais usam `admin/dev/`
    (chaves de teste e proxy que injeta o JWT), que nunca vai para produção.
- Configuração: vars `PUBLIC_R2_BASE_URL`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `PURGE_ORIGINS`;
  secrets `CF_API_TOKEN` (permissão só Zone > Cache Purge na zona) e `CF_ZONE_ID`.
- API: `GET /api/albums`, `PATCH /api/albums/:id` (título), `POST /api/albums/:id/delete-photos`,
  `DELETE /api/albums/:id` (exige `confirmTitle` igual ao título), `POST /api/purge`
  (só URLs de `albums/` ou o `manifest.json` do domínio público).
- Toda alteração do manifest: ler com ETag, aplicar numa cópia, gravar o anterior em
  `manifest-backups/`, gravar com `onlyIf: { etagMatches }` e repetir do zero em conflito
  (até 5 vezes). Só depois apagar os arquivos, para o site nunca listar foto já apagada.
- Excluir foto remove as 6 versões. Álbum sem fotos sai do manifest e tudo em
  `albums/{id}/` é apagado.
- Purge depois de excluir: por URL, no máximo 100 itens por chamada (limite atual dos planos
  Free/Pro/Business). A resposta das fotos varia com `Origin` (CORS), então cada URL vai
  também com o cabeçalho `Origin` de cada domínio em `PURGE_ORIGINS`, no mesmo lote, junto
  com o `manifest.json`. O Worker faz até 20 chamadas por requisição (plano Free: 50
  subrequisições) e devolve o resto como pendente; a interface continua via `/api/purge`.
  Falha de purge aparece na tela com botão para tentar de novo.

## Site (site/)

- Referência visual: `design/design-desktop.dc.html` e `design/design-mobile.dc.html`.
  São o design aprovado. Reproduzir fielmente o layout, as cores e a tipografia.
- Tokens do design: fundo `#121110`, superfície `#1B1A18`, texto `#F4F1EA`,
  texto secundário `#A8A194`/`#B9B2A5`, destaque laranja `#FF6A2B` (texto sobre ele `#121110`),
  bordas `#2E2A25`/`#3A352F`. Fontes: Big Shoulders Display (títulos) e DM Sans (corpo).
- Funcionalidades: chips de filtro por data, grade de miniaturas (4 colunas desktop,
  3 tablet, 2 celular), seleção múltipla com "Selecionar todas" por álbum, barra fixa de
  download com escolha de resolução (4K, 2K, Full HD, HD), seção de apoio com Pix e Instagram.
- Os textos do hero (título e subtítulo) ainda não estão definidos: usar placeholders e
  deixar fácil de trocar num único lugar.
- Chave Pix: ler de uma constante de configuração, nunca espalhar pelo código.
- Acessibilidade: usar `<button>` e `<a>` reais, `aria-pressed` nos itens selecionáveis,
  alvos de toque com no mínimo 44 px, contraste adequado.
- Imagens da grade com `loading="lazy"` e dimensões reservadas para evitar salto de layout.

## Regras gerais

- Nunca commitar `.env`, chaves, originais ou a pasta `output/`.
- Idioma da interface: português do Brasil. Nos textos, não usar travessão (—).
- Antes de implementar uma fase grande, propor o plano e esperar confirmação.
- Mudanças pequenas e commits frequentes.
- Escrever um README curto explicando como rodar o processamento, o upload e o site.
