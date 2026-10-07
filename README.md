# Galeria de fotos (carvalhovini.com)

Galeria de fotos de hobby com download grátis em 4K, 2K, Full HD e HD, com marca d'água `@carvalho_.vini`.
Detalhes do projeto e convenções em [AGENTS.md](AGENTS.md).

## Requisitos

- Node.js 20.12 ou mais recente
- `npm install` na raiz do repositório
- Para o upload: um arquivo `.env` na raiz com as variáveis listadas em `.env.example`
  (credenciais de uma chave de API do R2 com permissão de escrita no bucket)

## Processar um jogo

1. Copie as fotos originais para `originals/AAAA-MM-DD_nome-do-jogo/`
   (por exemplo `originals/2026-09-27_final-estadual/`). Aceita `.jpg`, `.jpeg` e `.png`,
   em maiúsculas ou minúsculas.
2. Rode:

   ```sh
   npm run process -- originals/2026-09-27_final-estadual
   ```

3. Os arquivos saem em `output/albums/{albumId}/`, na mesma estrutura do R2:
   `thumb/`, `preview/` e `dl/4k|2k|fhd|hd/` (as versões de download têm marca d'água),
   mais um `album.json` com título, data e dimensões das fotos.

O script pode ser rodado de novo sem custo: pula o que já foi gerado e refaz só o que
mudou (foto original editada ou configuração alterada em `scripts/lib/config.js`).
Para refazer tudo, use `--force`.

O id de cada foto vem do nome do arquivo, com só letras, números, `_` e `-`.
Se dois arquivos gerarem o mesmo id, o segundo é ignorado e o script avisa.

## Título do álbum

Por padrão o título vem do nome da pasta, sem acentos (`final-estadual` vira "Final estadual").
Para um título manual, crie `originals/{albumId}/titulo.txt` com o título na primeira linha
(acentos são permitidos). Ele é aplicado no upload.

Ao reenviar um álbum que já está publicado e não tem `titulo.txt`, o upload mantém o título
que está no site, inclusive se ele foi renomeado no gerenciador.

## Enviar para o R2

```sh
npm run upload -- 2026-09-27_final-estadual --dry-run   # mostra o que seria enviado e como ficaria o manifest
npm run upload -- 2026-09-27_final-estadual
```

- Envia as 6 versões de cada foto do `album.json` para `albums/{albumId}/` (cache de 1 ano, `immutable`).
- Pula arquivos que já existem no bucket com o mesmo tamanho. Arquivos que existem com tamanho
  diferente também são pulados, com aviso; para substituir, use `--overwrite` (quem já tem a foto
  antiga em cache pode continuar vendo a versão antiga).
- Só depois de todas as fotos do álbum subirem sem erro, atualiza o `manifest.json` do bucket.
  Uma cópia do manifest anterior fica em `output/manifest-backups/`. Se o gerenciador alterar
  o manifest no meio do upload, o script percebe (ETag), lê de novo e refaz a atualização.
- O álbum é **unido** ao que já está publicado, foto a foto pelo id: fotos novas entram, as
  que já estavam continuam (mesmo que não estejam em `originals/` agora), e título, capa e
  tags são mantidos. Com `--overwrite`, a entrada das fotos repetidas é substituída.
- Cada foto nova leva no manifest o horário EXIF (`t`). Quando todas as fotos do álbum têm `t`,
  o álbum fica em ordem de horário, então fotos enviadas depois são intercaladas. Álbuns
  publicados antes disso (sem `t`) recebem as fotos novas no fim.
- Publicar um jogo novo não exige novo deploy do site.

## Site

Projeto Astro em `site/`, com dependências próprias:

```sh
cd site
npm install
npm run dev      # http://localhost:4321
npm run build    # gera site/dist/
npm run check    # checagem de tipos
npm run preview:worker   # build + servidor local do Worker (http://localhost:8787)
```

O deploy é um Cloudflare Worker só com assets estáticos: `site/wrangler.jsonc` publica a
pasta `dist/` gerada pelo build.

O site lê `manifest.json` do bucket no navegador, então um jogo novo aparece assim que o
upload termina, sem novo build. Por padrão usa `https://fotos.carvalhovini.com`; para apontar
para outro lugar, crie `site/.env` com `PUBLIC_R2_BASE_URL` (veja `site/.env.example`).

Os textos do site (topo, seção de apoio, rodapé, título da aba e descrição), o link do
Instagram e a chave Pix ficam em `site/src/config.ts`. Enquanto a chave
for `[SUA-CHAVE-PIX]`, o cartão do Pix não aparece. No mesmo arquivo ficam o limite de um
download (`DOWNLOAD_LIMIT_MB`, hoje 150 MB), o tamanho estimado de cada resolução e o tamanho
do lote de fotos (36).

A home lista os álbuns em cartões; cada álbum abre em `?album={albumId}`, um link que pode ser
compartilhado. A capa e as tags de cada álbum são escolhidas no gerenciador; sem capa
escolhida, vale a primeira foto. Se algum álbum tiver tags, a home mostra também um filtro por
tag (`?tag=...`), que combina com o filtro por data (`?data=...`).

O bucket precisa de uma regra de CORS liberando GET para as origens do site (o domínio
final e `http://localhost:4321` em desenvolvimento), senão o manifest e os downloads falham.

## Gerenciador (admin.carvalhovini.com)

Projeto separado em `admin/`: um Worker com a API e uma interface leve para renomear álbuns,
escolher a capa (selecione 1 foto e toque em "Definir como capa"), editar as tags, excluir fotos, excluir álbuns inteiros e enviar fotos pelo celular. Cada alteração guarda uma
cópia do manifest anterior em `manifest-backups/` no bucket e, depois de excluir, limpa o
cache da Cloudflare das URLs removidas.

### Rodar localmente

Tudo roda contra um R2 simulado em `admin/.wrangler/`; o bucket real não é alterado.

```sh
cd admin
npm install
cp .dev.vars.example .dev.vars   # valores falsos, só para teste local
npm run seed:local    # copia o manifest público (só leitura) e o álbum de teste de output/
npm run dev           # build da interface + wrangler dev em http://127.0.0.1:8787
npm run dev:access    # em outro terminal: Access e purge falsos
```

Abra **http://127.0.0.1:8790**: é um proxy que injeta um JWT de teste, como o Access faz em
produção. O endereço 8787 direto responde 401, de propósito. O `dev:access` também simula a
API do GitHub (disparo e andamento do workflow), então dá para testar envio e publicação.
Com os dois rodando, `npm run test:local` testa a API (autenticação, exclusões, conflitos,
purge, envio, publicação e bloqueios). Ele altera o R2 simulado: rode o `seed:local` de novo
(com o `wrangler dev` parado) antes de repetir.

### Configurar o Cloudflare Access (antes do primeiro deploy)

1. No painel, abra **Zero Trust > Access > Applications > Add an application > Self-hosted**.
2. Domínio: `admin.carvalhovini.com`. Crie uma política **Allow** incluindo só o seu e-mail
   (login por código no e-mail ou Google).
3. Copie o **Application Audience (AUD) Tag** da aplicação para `ACCESS_AUD` em
   `admin/wrangler.jsonc`.
4. Em **Zero Trust > Settings**, copie o **Team domain** (`{time}.cloudflareaccess.com`) para
   `ACCESS_TEAM_DOMAIN`.

Esses dois valores não são segredos. Enquanto estiverem com os placeholders, a API recusa
todas as requisições.

### Secrets do purge

1. Crie um token em **My Profile > API Tokens > Create Token > Custom token**, com a permissão
   **Zone > Cache Purge > Purge**, limitado a **Specific zone: carvalhovini.com**.
2. Copie o **Zone ID** da página de visão geral da zona `carvalhovini.com`.
3. Grave os dois como secrets. O Wrangler pede o valor no terminal; não salve em arquivo e não
   cole em chat:

```sh
cd admin
npx wrangler secret put CF_API_TOKEN
npx wrangler secret put CF_ZONE_ID
```

Sem esses secrets o gerenciador funciona, mas avisa na tela que o cache não foi limpo.

`PURGE_ORIGINS` (em `wrangler.jsonc`) lista os domínios que abrem o site. O cache das fotos
guarda uma cópia por origem, então cada uma precisa ser limpa. Quando desligar o endereço
`workers.dev` do site, tire-o da lista.

### Conferir o purge depois de excluir uma foto

```sh
curl -sI -H "Origin: https://carvalhovini.com" "https://fotos.carvalhovini.com/albums/ALBUM/thumb/FOTO.jpg" | head -3
curl -sI -H "Origin: https://www.carvalhovini.com" "https://fotos.carvalhovini.com/albums/ALBUM/thumb/FOTO.jpg" | head -3
```

Os dois devem responder 404.

### Envio pelo celular e publicação

No gerenciador, **Novo álbum** pede a data e o título (com acentos) e abre a escolha de fotos;
dentro de um álbum publicado, **Adicionar fotos** faz o mesmo para juntar fotos a ele. As fotos
vão, sem alteração, para o bucket privado `galeria-entrada`. **Publicar** dispara o workflow
`.github/workflows/publish.yml`, que baixa as fotos da entrada, roda `process` e `upload`
(com a união descrita acima) e, se tudo der certo, apaga da entrada só o que baixou.

- Só `.jpg` e `.jpeg`, até 50 MB cada. O nome é limpo como no `process` (`IMG 0001.JPG` vira
  `IMG-0001.jpg`); nomes repetidos ganham `-2`, `-3`.
- Até 3 envios ao mesmo tempo, com nova tentativa automática e o botão **Reenviar as que
  falharam**.
- Para retomar depois de sair da página, abra **Continuar envio** e escolha as mesmas fotos:
  as que já estão na entrada (mesmo nome e tamanho) são puladas.
- A tela fica acesa durante o envio onde o navegador permite (Wake Lock: Safari 16.4 ou mais
  novo, Chrome no Android). Sem suporte, aparece um aviso.
- Enquanto uma publicação estiver na fila ou rodando, novos envios e exclusões ficam
  bloqueados. Se o GitHub não responder, o bloqueio continua por segurança.

#### Configurar (uma vez)

1. Crie o bucket de entrada (privado, sem domínio público):

   ```sh
   npx wrangler r2 bucket create galeria-entrada
   ```

2. No GitHub, crie um token **fine-grained** em **Settings > Developer settings > Personal
   access tokens > Fine-grained tokens**, limitado ao repositório `galeria-fotos`, com a
   permissão **Actions: Read and write** (o resto fica sem acesso). Grave no gerenciador:

   ```sh
   cd admin
   npx wrangler secret put GITHUB_TOKEN
   ```

   Repositório, workflow e branch ficam nas vars `GITHUB_REPO`, `GITHUB_WORKFLOW` e
   `GITHUB_REF` de `admin/wrangler.jsonc`.
3. Crie uma chave de API do R2 com **Object Read & Write** nos dois buckets (`galeria-fotos` e
   `galeria-entrada`). No repositório do GitHub, em **Settings > Secrets and variables >
   Actions**, cadastre:
   - **Secrets:** `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
   - **Variables:** `R2_BUCKET` (`galeria-fotos`), `R2_INBOX_BUCKET` (`galeria-entrada`),
     `R2_PUBLIC_BASE_URL` (`https://fotos.carvalhovini.com`)
4. O workflow só existe para o GitHub depois que o arquivo estiver no branch `main` do
   repositório remoto (push).

Para publicar pelo computador o que está na entrada, sem o GitHub:

```sh
npm run inbox -- pull 2026-09-27_final-estadual    # baixa para originals/ e cria o titulo.txt se o álbum for novo
npm run process -- originals/2026-09-27_final-estadual
npm run upload -- 2026-09-27_final-estadual
npm run inbox -- clean 2026-09-27_final-estadual   # apaga da entrada só o que o pull baixou
```

Isso exige `R2_INBOX_BUCKET` no `.env` e uma chave com acesso aos dois buckets.

#### iPhone: as fotos chegam originais?

Pelo código do WebKit (Safari e todos os navegadores do iOS), o seletor de fotos se comporta
assim com este campo, que aceita só JPEG:

- **Fotos da galeria em JPEG** (câmeras, fotos recebidas): chegam como estão, no tamanho
  original e com EXIF.
- **Fotos da galeria em HEIC** (câmera do iPhone no formato padrão "Alta eficiência"): o iOS
  converte para JPEG antes de entregar. A resolução se mantém, mas a imagem é recomprimida.
- **"Tirar foto" direto do seletor:** vira `image.jpg`, recomprimida e **sem EXIF** (sem data).
  Prefira escolher da galeria.
- O tamanho original não é reduzido pelo navegador. Ao escolher pelo app Arquivos, o arquivo vai
  sem nenhuma alteração.

Isso ainda precisa ser confirmado num iPhone de verdade. Para conferir: envie algumas fotos e
abra **Conferir se o celular mandou as fotos originais**, no fim da tela de envio. A tabela
mostra tamanho, dimensões e data EXIF de cada arquivo como o navegador entregou; compare com
as informações da foto no app Fotos (deslize para cima na foto).

### Deploy

```sh
cd admin
npm run build
npx wrangler deploy
```

## Fonte

A marca d'água usa DM Sans Bold (`assets/fonts/`), sob a licença SIL Open Font License
(`assets/fonts/OFL.txt`).
