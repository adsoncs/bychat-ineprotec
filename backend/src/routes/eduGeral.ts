// src/routes/eduGeral.ts
//
// Educacional › Configurações Gerais (admin). Ver lib/eduGeral.ts.
//
//   GET  /api/admin/edu/geral                 — valores salvos + padrões
//   PUT  /api/admin/edu/geral                 — grava as seções enviadas
//   GET  /api/admin/edu/geral/importar/:id    — valores de um portal, no formato
//                                               das Gerais (só lê; quem salva é a tela)
//   POST /api/admin/edu/geral/upload?kind=    — logo | favicon | painel
//   DELETE /api/admin/edu/geral/upload?kind=

import { FastifyInstance } from 'fastify'
import { join, dirname, extname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync, mkdirSync } from 'fs'
import fsp, { unlink } from 'fs/promises'
import { prisma } from '../lib/prisma.js'
import { adminOnly } from '../lib/auth.js'
import { bufferMultipart, validateUploadContent, sniffKind, UploadValidationError, UploadTooLargeError } from '../lib/uploadSafety.js'
import { lerEduGeral, salvarEduGeral, salvarHeranca, PADROES_LOGIN } from '../lib/eduGeral.js'
import { CATALOGO_TEXTOS } from '../lib/eduTextos.js'
import { LINK_TTL_HORAS } from '../services/portalAccount.js'
import { logUserAudit, auditActor } from '../services/userAudit.js'

const PASTA = (() => join(dirname(fileURLToPath(import.meta.url)), '../../../uploads', 'edu-geral'))()

const ARQUIVOS: Record<string, { secao: 'identidade' | 'login' | 'seo'; campo: string; exts: string[]; mimes: string[]; max: number }> = {
  logo: { secao: 'identidade', campo: 'logoUrl', exts: ['.png', '.jpg', '.jpeg', '.webp', '.svg'], mimes: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'], max: 1024 * 1024 },
  favicon: { secao: 'identidade', campo: 'faviconUrl', exts: ['.png', '.ico', '.svg'], mimes: ['image/png', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/svg+xml'], max: 200 * 1024 },
  og: { secao: 'seo', campo: 'ogImageUrl', exts: ['.png', '.jpg', '.jpeg', '.webp'], mimes: ['image/png', 'image/jpeg', 'image/webp'], max: 4 * 1024 * 1024 },
  painel: { secao: 'login', campo: 'painelImagemUrl', exts: ['.png', '.jpg', '.jpeg', '.webp'], mimes: ['image/png', 'image/jpeg', 'image/webp'], max: 4 * 1024 * 1024 },
}

export async function eduGeralRoutes(app: FastifyInstance) {
  app.get('/api/admin/edu/geral', { preHandler: adminOnly }, async () => {
    const [geral, portais] = await Promise.all([
      lerEduGeral(),
      prisma.enrollmentPortal.findMany({ orderBy: { id: 'asc' }, select: { id: true, nome: true, slug: true, active: true } }),
    ])
    return { geral, padroes: { login: PADROES_LOGIN, textos: CATALOGO_TEXTOS }, linkHoras: LINK_TTL_HORAS, portais }
  })

  app.put('/api/admin/edu/geral', { preHandler: adminOnly }, async (req) => {
    const b = (req.body as any) || {}
    // A herança (o que cada portal segue) tem rota própria: não vai neste salvar.
    const geral = await salvarEduGeral({ identidade: b.identidade, aparencia: b.aparencia, login: b.login, textos: b.textos, seo: b.seo })
    void logUserAudit({
      action: 'edu.geral.updated',
      targetType: 'settings',
      targetLabel: `Configurações Gerais (${['identidade', 'aparencia', 'login', 'textos', 'seo'].filter((s) => b[s] !== undefined).join(', ')})`,
      ...auditActor(req),
    })
    return { geral }
  })

  // O que um portal segue das Gerais (Branding do portal ou aba Portais).
  app.put('/api/admin/edu/geral/heranca/:id', { preHandler: adminOnly }, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    const p = await prisma.enrollmentPortal.findUnique({ where: { id }, select: { id: true, nome: true } })
    if (!p) return reply.code(404).send({ error: 'Portal não encontrado' })
    const b = (req.body as any) || {}
    const so = (v: unknown) => (typeof v === 'boolean' ? v : undefined)
    const heranca = await salvarHeranca(id, { marca: so(b.marca), textos: so(b.textos), seo: so(b.seo) })
    void logUserAudit({
      action: 'edu.geral.heranca',
      targetType: 'portal',
      targetLabel: `${p.nome}: marca ${heranca.marca ? 'segue' : 'própria'}, textos ${heranca.textos ? 'segue' : 'próprios'}, SEO ${heranca.seo ? 'segue' : 'próprio'}`,
      ...auditActor(req),
    })
    return { heranca }
  })

  // Ponto de partida: a marca que um portal já usa, no formato das Gerais.
  app.get('/api/admin/edu/geral/importar/:id', { preHandler: adminOnly }, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    const p = await prisma.enrollmentPortal.findUnique({
      where: { id },
      select: {
        nome: true, seoTelas: true, unit: { select: { nome: true } },
        brandLogoUrl: true, brandFaviconUrl: true, brandLogoLink: true, brandFooterText: true,
        brandPrimaryColor: true, brandSecondaryColor: true, brandFontFamily: true, brandRadiusScale: true,
        brandButtonShape: true, brandButtonUppercase: true, brandTypeScale: true, brandContentWidth: true,
        brandHeroUrl: true, brandLabels: true,
      },
    })
    if (!p) return reply.code(404).send({ error: 'Portal não encontrado' })
    const marcaSeo = (p.seoTelas as any)?.marca
    return {
      identidade: {
        nome: marcaSeo || p.unit?.nome || p.nome, logoUrl: p.brandLogoUrl, faviconUrl: p.brandFaviconUrl,
        logoLink: p.brandLogoLink, rodape: p.brandFooterText,
      },
      aparencia: {
        corPrincipal: p.brandPrimaryColor, corApoio: p.brandSecondaryColor, fonte: p.brandFontFamily, raio: p.brandRadiusScale,
        botao: p.brandButtonShape, caixaAlta: p.brandButtonUppercase, escala: p.brandTypeScale, largura: p.brandContentWidth,
      },
      login: { painelImagemUrl: p.brandHeroUrl },
      // Textos do formulário que o portal personalizou (Branding › Textos).
      textos: Object.fromEntries(Object.entries((p.brandLabels as Record<string, unknown>) || {})
        .filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [`form.${k}`, v as string])),
    }
  })

  app.post('/api/admin/edu/geral/upload', { preHandler: adminOnly }, async (req, reply) => {
    const kind = String((req.query as any)?.kind || '').toLowerCase()
    const spec = ARQUIVOS[kind]
    if (!spec) return reply.code(400).send({ error: 'kind deve ser logo, favicon, og ou painel' })
    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'Nenhum arquivo enviado' })
    const ext = extname(data.filename || '').toLowerCase()
    if (!spec.exts.includes(ext)) return reply.code(400).send({ error: `Formato não suportado: use ${spec.exts.join(', ')}` })
    if (data.mimetype && !spec.mimes.includes(data.mimetype)) return reply.code(400).send({ error: `Tipo de arquivo não permitido: ${data.mimetype}` })

    if (!existsSync(PASTA)) mkdirSync(PASTA, { recursive: true })
    const destino = join(PASTA, `${kind}${ext}`)
    try {
      const bruto = await bufferMultipart(data.file, spec.max)
      // Todos os formatos aceitos aqui são reconhecíveis: conteúdo que não é
      // imagem conhecida é recusado (a validação comum tolera "desconhecido").
      if (sniffKind(bruto) === 'unknown') throw new UploadValidationError('O arquivo não é uma imagem válida.')
      const seguro = validateUploadContent(bruto, ext.slice(1), { allowSvg: ext === '.svg' })
      // Só apaga a versão anterior depois que a nova passou na validação.
      for (const e of spec.exts) {
        const velho = join(PASTA, `${kind}${e}`)
        if (e !== ext && existsSync(velho)) await unlink(velho).catch(() => {})
      }
      await fsp.writeFile(destino, seguro)
    } catch (err: any) {
      if (err instanceof UploadTooLargeError) return reply.code(413).send({ error: `Arquivo muito grande (máximo ${(spec.max / 1024 / 1024).toFixed(1)}MB)` })
      if (err instanceof UploadValidationError) return reply.code(400).send({ error: err.message })
      return reply.code(500).send({ error: 'Falha ao salvar arquivo' })
    }
    const url = `/uploads/edu-geral/${kind}${ext}?v=${Date.now()}`
    // Grava na hora (como no Branding do portal): o arquivo já está no ar.
    const atual = await lerEduGeral()
    await salvarEduGeral({ [spec.secao]: { ...atual[spec.secao], [spec.campo]: url } })
    return { ok: true, url, kind }
  })

  app.delete('/api/admin/edu/geral/upload', { preHandler: adminOnly }, async (req, reply) => {
    const kind = String((req.query as any)?.kind || '').toLowerCase()
    const spec = ARQUIVOS[kind]
    if (!spec) return reply.code(400).send({ error: 'kind inválido' })
    for (const e of spec.exts) {
      const f = join(PASTA, `${kind}${e}`)
      if (existsSync(f)) await unlink(f).catch(() => {})
    }
    const atual = await lerEduGeral()
    await salvarEduGeral({ [spec.secao]: { ...atual[spec.secao], [spec.campo]: null } })
    return { ok: true }
  })
}
