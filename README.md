# Galeria de fotos (carvalhovini.com)

Galeria de fotos esportivas com download grátis em 4K, 2K, Full HD e HD, com marca d'água `@carvalho_.vini`.
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
  Uma cópia do manifest anterior fica em `output/manifest-backups/`.
- Publicar um jogo novo não exige novo deploy do site.

## Site

Ainda não implementado.

## Fonte

A marca d'água usa DM Sans Bold (`assets/fonts/`), sob a licença SIL Open Font License
(`assets/fonts/OFL.txt`).
