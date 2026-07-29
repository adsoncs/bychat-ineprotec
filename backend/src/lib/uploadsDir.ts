// src/lib/uploadsDir.ts
//
// Diretório físico servido em `/uploads`.
//
// Existe porque havia duas respostas diferentes para "onde ficam os uploads": o
// servidor estático resolve `join(__dirname, '../../uploads')` a partir de
// `src/`, ou seja **a raiz do projeto**; quem usava `process.cwd()` acabava
// gravando em `backend/uploads`, que ninguém serve. O arquivo era salvo, o
// registro apontava para `/uploads/...` e a URL devolvia a página do SPA.
//
// Resolver pelo caminho do próprio módulo (e não pelo diretório de trabalho)
// deixa o resultado igual rodando por `tsx`, por `pm2` ou por script solto.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const aqui = dirname(fileURLToPath(import.meta.url)) // …/backend/src/lib

/** Raiz física de `/uploads` — a mesma que o fastify-static publica. */
export const UPLOADS_DIR = join(aqui, '..', '..', '..', 'uploads')

/** Subpasta dentro de uploads, já resolvida. */
export const uploadsPath = (...partes: string[]) => join(UPLOADS_DIR, ...partes)
