# Galeria de fotos (carvalhovini.com)

Galeria de fotos esportivas com download grátis em 4K, 2K, Full HD e HD, com marca d'água `@carvalho_.vini`.
Detalhes do projeto e convenções em [AGENTS.md](AGENTS.md).

## Requisitos

- Node.js 20 ou mais recente
- `npm install` na raiz do repositório

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

## Upload e site

Ainda não implementados.

## Fonte

A marca d'água usa DM Sans Bold (`assets/fonts/`), sob a licença SIL Open Font License
(`assets/fonts/OFL.txt`).
