# Galeria de fotos (carvalhovini.com)

Site de galeria de fotos de um fotógrafo amador, feito por hobby: fotos de tudo um pouco.
Instagram do autor: @carvalho_.vini (https://www.instagram.com/carvalho_.vini/).

## Objetivo do produto

- Visitante acessa sem login, filtra as fotos por data e vê uma galeria.
- Seleciona uma ou várias fotos e baixa em 4K, 2K, Full HD ou HD, ou nos recortes para o
  Instagram (4:5 e Stories 9:16) quando o álbum tem essas versões.
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
  Foto única baixa direto. Limite por download: 150 MB estimados pela resolução
  (4K ≈ 1 MB, 2K ≈ 0,5 MB, Full HD ≈ 0,3 MB, HD ≈ 0,15 MB, Instagram 4:5 ≈ 0,2 MB,
  Stories 9:16 ≈ 0,25 MB por foto). O zip é montado em
  fluxo, na ordem da galeria.
- **Processamento e upload:** scripts Node.js (ESM) rodando localmente, com `sharp`.
- **Envio pelo celular:** o gerenciador grava as fotos originais no bucket privado
  `galeria-entrada`; o workflow `.github/workflows/publish.yml` (GitHub Actions) roda os mesmos
  scripts e publica.

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
  .github/workflows/    # publish.yml: publicação disparada pelo gerenciador
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
| dl/ig45 | 1080×1350 (recorte 4:5) | sim |
| dl/ig916 | 1080×1920 (recorte 9:16) | sim |

Regras:
- JPEG, qualidade ~85, `mozjpeg: true`. Nunca ampliar (`withoutEnlargement: true`).
- Aplicar `.rotate()` para respeitar a orientação EXIF.
- **Remover todos os metadados** dos arquivos públicos (inclui GPS). Não usar `withMetadata`.
- Marca d'água: texto `@carvalho_.vini`, branco com sombra suave, opacidade ~75%,
  canto inferior direito, margem ~2,5% do lado maior, largura ~16% do lado maior.
  Deve ser legível mas discreta.
- Renderizar o texto de forma determinística: converter o texto em caminhos SVG usando a fonte
  TTF do repositório (por exemplo com `opentype.js`), e NÃO depender de fontes do sistema.
- O script deve ser idempotente: pular arquivos já processados/enviados. Cada versão tem um
  hash da sua configuração em `.process-state.json`; mudar uma versão (ou criar uma nova)
  regera só ela, sem tocar nas outras.
- Recortes do Instagram (`ig45`, `ig916`): girar, recortar com `sharp.strategy.attention`
  (região de maior interesse) no maior retângulo da proporção que cabe na foto, limitado a
  1080 de largura, e só depois aplicar a marca. Foto pequena sai menor, na mesma proporção, sem
  ampliar. A marca segue a mesma regra (proporcional ao lado maior); no 9:16 ela fica a 14% da
  altura acima da borda de baixo, fora da barra de resposta dos Stories. O recorte automático
  pode errar em fotos escuras ou com o assunto na borda (paisagem em 9:16 perde até 60% da largura).
- Custo medido (M4, originais de 3264×4928): as 6 versões levam ~1,4 s por foto e os dois
  recortes mais ~0,36 s; em espaço, ~2,3 MB por foto mais ~0,3 MB dos recortes.

## Estrutura no R2

```
albums/{albumId}/thumb/{photoId}.jpg
albums/{albumId}/preview/{photoId}.jpg
albums/{albumId}/dl/4k/{photoId}.jpg
albums/{albumId}/dl/2k/{photoId}.jpg
albums/{albumId}/dl/fhd/{photoId}.jpg
albums/{albumId}/dl/hd/{photoId}.jpg
albums/{albumId}/dl/ig45/{photoId}.jpg    # opcional: álbuns processados antes não têm
albums/{albumId}/dl/ig916/{photoId}.jpg   # opcional
manifest.json
manifest-backups/manifest-{data-hora}-{etag}.json   # cópia gravada pelo gerenciador antes de cada alteração
```

Bucket privado de entrada (`galeria-entrada`, sem domínio público):

```
{albumId}/{photoId}.jpg     # original enviado pelo celular, sem alteração
{albumId}/_album.json       # { title, date }; título também em customMetadata (URI-encoded)
_publishing.json            # marcador gravado ao disparar a publicação
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
      "cover": "IMG_0001",
      "tags": ["parque", "por do sol"],
      "formats": ["ig45", "ig916"],
      "photos": [
        { "id": "IMG_0001", "w": 4928, "h": 3264, "t": "2026-09-27T15:04:05.120" }
      ]
    }
  ]
}
```

As URLs são derivadas por convenção a partir de `albumId` e `photoId`, então o manifest
não precisa repetir caminhos.

Campos novos são sempre opcionais, para não quebrar manifests antigos. `cover` (opcional) é o
`photoId` da capa do álbum; sem ele, ou se a foto não existir mais, a capa é a primeira foto.
O upload mantém o `cover` ao reenviar o álbum, e o gerenciador o remove quando a foto da capa
é excluída. `tags` (opcional) é uma lista de até 5 textos curtos (até 24 caracteres), em
minúsculas, sem acento, só letras, números, espaço e hífen (ex: `por do sol`); sem tags, o
campo não existe. O upload mantém as tags ao reenviar. `formats` (opcional) lista os recortes
do Instagram que TODAS as fotos do álbum têm no bucket; o site só oferece esses formatos.
O upload calcula: um formato entra se as fotos enviadas agora o têm e as já publicadas que não
foram reenviadas também tinham (o álbum já anunciava o formato). Assim, um álbum antigo que
recebe fotos novas pelo celular não anuncia o formato até ser reprocessado inteiro. `t` (opcional) é o horário EXIF da foto
como texto local sem fuso (`AAAA-MM-DDTHH:mm:ss.SSS`), igual em qualquer máquina; serve só
para ordenar.

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
- O álbum é unido ao publicado por id de foto: fotos existentes ficam com a entrada antiga
  (só ganham `t` se não tinham), novas entram; título, capa e tags são preservados. `--overwrite`
  substitui as entradas repetidas. Se todas as fotos têm `t`, ordenar por `t`; senão as novas
  vão para o fim. Assim o workflow publica só as fotos novas sem apagar as antigas.
- Recortes do Instagram são opcionais no upload: faltando em alguma foto, o upload avisa,
  envia o resto e o álbum não anuncia o formato em `formats`. Arquivos já publicados com o
  mesmo tamanho são pulados, então reprocessar e reenviar um álbum antigo só sobe os recortes.
- `scripts/inbox.js pull {albumId}` baixa a entrada para `originals/{albumId}/` e cria o
  `titulo.txt` só para álbum novo; `clean` apaga da entrada só as chaves que o `pull` baixou
  (lista em `output/inbox/`). Usa `R2_INBOX_BUCKET`.

## Gerenciador (admin/)

- Worker em TypeScript com assets estáticos (interface Preact, mesmo visual do site, celular
  primeiro). Projeto separado com `admin/wrangler.jsonc`: nome `galeria-admin`, domínio
  `admin.carvalhovini.com`, `workers_dev` e `preview_urls` desligados.
- O Worker roda antes dos assets só em `/api/*`. Buckets via bindings R2 `BUCKET`
  (`galeria-fotos`) e `INBOX` (`galeria-entrada`).
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
- Configuração: vars `PUBLIC_R2_BASE_URL`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `PURGE_ORIGINS`,
  `GITHUB_REPO`, `GITHUB_WORKFLOW`, `GITHUB_REF`; secrets `CF_API_TOKEN` (permissão só
  Zone > Cache Purge na zona), `CF_ZONE_ID` e `GITHUB_TOKEN` (fine-grained, só este repositório,
  Actions: Read and write).
- API: `GET /api/albums`, `PATCH /api/albums/:id` (`title`, `cover` e `tags`, sozinhos ou
  juntos; `cover: null` volta para a primeira foto; tags normalizadas no servidor, mais de 5 ou
  caractere inválido: 400), `POST /api/albums/:id/delete-photos`,
  `DELETE /api/albums/:id` (exige `confirmTitle` igual ao título), `POST /api/purge`
  (só URLs de `albums/` ou o `manifest.json` do domínio público), `GET /api/inbox`,
  `GET|DELETE /api/upload/:id` (listar para retomar / descartar), `PUT /api/upload/:id/_album.json`
  (título), `PUT /api/upload/:id/:arquivo` (foto), `GET /api/publish` (andamento) e
  `POST /api/publish/:id`.
- Toda alteração do manifest: ler com ETag, aplicar numa cópia, gravar o anterior em
  `manifest-backups/`, gravar com `onlyIf: { etagMatches }` e repetir do zero em conflito
  (até 5 vezes). Só depois apagar os arquivos, para o site nunca listar foto já apagada.
- Excluir foto remove as 8 versões (as 6 de sempre e os 2 recortes do Instagram, existindo ou
  não), e o purge inclui as 8 URLs. Álbum sem fotos sai do manifest e tudo em
  `albums/{id}/` é apagado.
- Capa e tags: na tela do álbum, com exatamente 1 foto selecionada, a barra mostra
  "Definir como capa"; a capa atual tem o selo "Capa". O bloco "Tags" edita as tags com
  sugestão das já usadas em outros álbuns. Título, capa e tags continuam editáveis durante
  a publicação (a mesclagem do upload preserva esses campos).
- QR code: botão "QR code" na tela do álbum abre um diálogo com o QR de
  `https://carvalhovini.com/?album={id}`, o título e a data. Gerado no navegador com `uqr`
  (sem serviço externo), correção de erro M e margem de 4 módulos. "Baixar PNG" monta um
  PNG de 1200×1560 (título, data, QR, endereço e @carvalho_.vini) em `qr-{albumId}.png`;
  "Imprimir" usa uma folha A4 só de impressão (CSS `@media print`) com QR de 12 cm.
- Purge depois de excluir: por URL, no máximo 100 itens por chamada (limite atual dos planos
  Free/Pro/Business). A resposta das fotos varia com `Origin` (CORS), então cada URL vai
  também com o cabeçalho `Origin` de cada domínio em `PURGE_ORIGINS`, no mesmo lote, junto
  com o `manifest.json`. O Worker faz até 20 chamadas por requisição (plano Free: 50
  subrequisições) e devolve o resto como pendente; a interface continua via `/api/purge`.
  Falha de purge aparece na tela com botão para tentar de novo.
- Envio de fotos: `PUT` com o corpo da foto gravado em fluxo no `INBOX` (exige Content-Length,
  máximo 50 MB). Só `.jpg`/`.jpeg`, nome sanitizado como no `process`, e os primeiros bytes
  conferidos (`FF D8 FF`) depois de gravar. 409 se o álbum não tem `_album.json` ou se a foto
  já está publicada. O `albumId` é `AAAA-MM-DD_slug`, gerado pela data e pelo título.
- Interface de envio: até 3 envios simultâneos, progresso por foto e geral, novas tentativas
  automáticas, "Reenviar as que falharam", retomada pela listagem do servidor (mesmo nome e
  tamanho são pulados), Wake Lock com aviso quando não há suporte, aviso de não sair da página
  e um painel de diagnóstico (dimensões e EXIF de cada arquivo, para conferir o iOS).
- Publicar: `workflow_dispatch` com entrada `albumId` pela API do GitHub; o andamento vem da
  execução mais recente do workflow (passos do job). O workflow tem `concurrency` para nunca
  rodar duas publicações juntas e apaga da entrada só o que baixou, ao terminar com sucesso.
- Bloqueio: enquanto houver execução na fila ou rodando (ou nos 3 minutos depois de disparar,
  pelo marcador), envio, criação de álbum, descarte, exclusões e nova publicação respondem 409.
  Se o GitHub não responder, o bloqueio fica ligado. O token do GitHub nunca vai para logs.

## Site (site/)

- Referência visual: `design/design-desktop.dc.html` e `design/design-mobile.dc.html`.
  São o design aprovado. Reproduzir fielmente o layout, as cores e a tipografia.
- Tokens do design: fundo `#121110`, superfície `#1B1A18`, texto `#F4F1EA`,
  texto secundário `#A8A194`/`#B9B2A5`, destaque laranja `#FF6A2B` (texto sobre ele `#121110`),
  bordas `#2E2A25`/`#3A352F`. Fontes: Big Shoulders Display (títulos) e DM Sans (corpo).
- Tom genérico e de hobby, sem foco em esporte. Título da aba e meta tags (description,
  Open Graph e Twitter): "carvalho_.vini | Fotos", descrição "Fotos que eu tiro por aí. Hobby
  de fotógrafo amador." Ícone do cabeçalho e favicon: câmera simples em traço, laranja.
- Hero sem rótulo acima do título e sem desenho decorativo no fundo.
- Home: chips de filtro por data (`?data=AAAA-MM-DD`) e, se algum álbum tiver tags, chips de
  filtro por tag (`?tag=...`, uma por vez), combináveis entre si. As contagens de cada linha
  consideram o filtro da outra; escolher um chip que deixaria a combinação vazia limpa o outro
  filtro, e uma URL sem resultado mostra "Nenhum álbum com esses filtros" com "Limpar filtros".
  Cartões de álbum (capa 4:3, título,
  data por extenso, número de fotos), mais recentes primeiro. 3 colunas desktop, 2 tablet,
  1 celular.
- Página do álbum em `?album=ID`, com History API (voltar do navegador e link compartilhável
  funcionam; a rolagem da home é restaurada). O topo (hero) fica escondido nessa tela.
  Cabeçalho com Voltar, título, data, contagem e "Selecionar todas".
- Grade do álbum: mosaico (4 colunas desktop, 3 tablet, 2 celular) com cada foto na coluna mais
  curta pela proporção do manifest, calculado sobre o álbum inteiro, para carregar mais fotos
  nunca reembaralhar as que já aparecem. Lotes de 36 via IntersectionObserver, contador
  "Mostrando X de N" e botão "Carregar mais". Tiles com `content-visibility: auto`.
- Seleção guardada por álbum (trocar de álbum não perde). "Selecionar todas" respeita o
  limite da resolução escolhida e avisa quantas cabem. Barra fixa de download com escolha
  de resolução (4K, 2K, Full HD, HD) e aviso quando passa do limite. Se o álbum tem `formats`,
  aparecem também "Instagram 4:5" (1080×1350) e "Instagram Stories 9:16" (1080×1920), numa
  segunda linha no celular. A escolha fica guardada entre álbuns; num álbum sem o formato vale
  4K. Num formato do Instagram, o aviso de limite não sugere trocar de resolução.
- Visualizador: deslizar no celular, setas e Esc no teclado, pré-carrega as vizinhas, e tem
  botões de anterior, selecionar, baixar a foto atual e próxima.
- Pedido de remoção: link discreto "Pedir para remover esta foto" no visualizador e na barra
  de seleção (só com exatamente 1 foto selecionada). O toque copia "Olá! Quero pedir a remoção
  da foto {id} do álbum {título}." e abre `https://ig.me/m/carvalho_.vini`, com um aviso curto.
  A cópia é síncrona dentro do toque (exigência do iOS); se falhar, tenta a API de área de
  transferência e, sem ela, mostra o texto selecionável com "Copiar" e "Abrir o Instagram".
  Textos e usuário do Instagram em `site/src/config.ts` (`removal` e `instagram`).
- Seção de apoio com Pix e Instagram.
- Todos os textos do site (hero, seção de apoio, rodapé, pedido de remoção, título e descrição) ficam em
  `site/src/config.ts`, num único lugar.
- Chave Pix: ler de uma constante de configuração, nunca espalhar pelo código.
- Acessibilidade: usar `<button>` e `<a>` reais, `aria-pressed` nos itens selecionáveis,
  alvos de toque com no mínimo 44 px, contraste adequado.
- Imagens da grade com `loading="lazy"`, `decoding="async"` e dimensões reservadas para evitar
  salto de layout. Só a primeira dobra usa carregamento imediato com prioridade alta.

## Regras gerais

- Nunca commitar `.env`, chaves, originais ou a pasta `output/`.
- Idioma da interface: português do Brasil. Nos textos, não usar travessão (—).
- Antes de implementar uma fase grande, propor o plano e esperar confirmação.
- Mudanças pequenas e commits frequentes.
- Escrever um README curto explicando como rodar o processamento, o upload e o site.
