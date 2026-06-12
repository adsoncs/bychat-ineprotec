import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { adminOnly, type JwtPayload } from '../lib/auth.js'

// Chaves de aparência que injetam código/script executável (head, body, CTA tracking).
// Editar qualquer uma equivale a executar JS arbitrário no painel/LP → só SUPERADMIN.
const APPEARANCE_CODE_KEYS = new Set([
  'appearance.custom_head_code',
  'appearance.custom_body_code',
  'appearance.lp_custom_head_code',
  'appearance.lp_custom_body_code',
  'appearance.lp_event_btn_form',
  'appearance.lp_event_btn_chat',
])
import { isPrimaryInstall } from '../lib/install.js'
import { invalidateBrandingCache } from '../lib/branding.js'
import { join, dirname, extname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync, mkdirSync } from 'fs'
import { writeFile } from 'fs/promises'
import { bufferMultipart, validateUploadContent, UploadValidationError, UploadTooLargeError } from '../lib/uploadSafety.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const UPLOADS_DIR = join(__dirname, '../../../uploads')

// Chaves de aparência com valores padrão
const APPEARANCE_DEFAULTS: Record<string, string> = {
  // Admin
  'appearance.admin_logo_mode': 'text',       // text | image
  'appearance.admin_logo_url': '',
  'appearance.admin_brand_name': 'BeyondHub',
  'appearance.admin_brand_accent': 'Hub',
  'appearance.favicon_url': '',
  'appearance.primary_color': '#1a73e8',
  'appearance.primary_hover': '#1557b0',
  'appearance.secondary_color': '#5f6368',
  'appearance.success_color': '#34a853',
  'appearance.error_color': '#ea4335',
  'appearance.warning_color': '#fbbc04',
  'appearance.sidebar_bg': '#fff',
  'appearance.sidebar_text': '#5f6368',
  'appearance.sidebar_active_bg': '#e8f0fe',
  'appearance.sidebar_active_text': '#1a73e8',
  'appearance.topbar_bg': '#fff',
  'appearance.topbar_text': '#202124',
  'appearance.body_bg': '#f8f9fa',
  'appearance.card_bg': '#fff',
  'appearance.card_border': '#e0e0e0',
  'appearance.text_primary': '#202124',
  'appearance.text_secondary': '#5f6368',
  'appearance.font_family': 'Google Sans, Poppins, sans-serif',
  'appearance.border_radius': '8',
  // Landing Page
  'appearance.lp_logo_mode': 'text',          // text | image
  'appearance.lp_logo_url': '',
  'appearance.lp_brand_name': 'BeyondHub',
  'appearance.lp_brand_accent': 'Hub',
  'appearance.landing_bg': '#0a0a0a',
  'appearance.landing_gold': '#d1ae60',
  'appearance.landing_gold_light': '#e8cc8a',
  'appearance.landing_gold_dark': '#a88a3d',
  'appearance.landing_text': '#ffffff',
  'appearance.landing_text_light': '#000000',
  'appearance.landing_font': 'Montserrat, sans-serif',
  // Tamanho do logotipo
  'appearance.admin_logo_size': '16',
  'appearance.lp_logo_size': '18',
  // Conteúdo da Landing Page
  'appearance.lp_title': 'Descubra o que está <br><span class="gold">travando o crescimento</span><br><span class="dim">da sua empresa.</span>',
  'appearance.lp_description': 'Preencha o diagnóstico em 5 minutos e receba uma análise estratégica completa gerada por IA — identificando seus gargalos, oportunidades e próximos passos com clareza.',
  // SEO Admin
  'appearance.admin_page_title': 'BeyondHub — Painel Admin',
  'appearance.admin_page_description': 'Painel administrativo do sistema BeyondHub',
  'appearance.admin_robots_index': 'noindex',
  // SEO Landing
  'appearance.lp_page_title': 'BeyondHub — Diagnóstico Estratégico',
  'appearance.lp_page_description': 'Diagnóstico estratégico gratuito com IA para sua empresa',
  'appearance.lp_robots_index': 'index',
  // Códigos externos Admin
  'appearance.custom_head_code': '',
  'appearance.custom_body_code': '',
  // Códigos externos LP
  'appearance.lp_custom_head_code': '',
  'appearance.lp_custom_body_code': '',
  // Eventos dos botões LP (GTM/Ads)
  'appearance.lp_event_btn_form': '',
  'appearance.lp_event_btn_chat': '',
  // Tela de login (Admin)
  'appearance.login_image_url': '',
  'appearance.login_image_position': 'left',          // left | right
  'appearance.login_image_focus': 'center',           // center | top | bottom | left | right | top left | top right | bottom left | bottom right
  'appearance.login_overlay_dim': '40',               // 0-80 (% de escurecimento sobre a imagem)
  'appearance.login_title': 'Bem-vindo de volta',
  'appearance.login_subtitle': 'Acesse sua conta para continuar',
  'appearance.login_overlay_title': 'Gestão completa do seu negócio',
  'appearance.login_overlay_subtitle': 'Atendimento, CRM e automações em uma única plataforma.',
  'appearance.login_footer_text': '',
  // Cores da tela de login (vazio = herda do tema)
  'appearance.login_form_bg': '',
  'appearance.login_button_bg': '',
  'appearance.login_button_text': '',
  'appearance.login_title_color': '',
  'appearance.login_subtitle_color': '',
  'appearance.login_overlay_text_color': '',
  'appearance.login_hero_from': '',
  'appearance.login_hero_to': '',
}

export async function appearanceRoutes(app: FastifyInstance) {

  // GET /api/appearance — Público (para aplicar tema no frontend)
  app.get('/api/appearance', async () => {
    const rows = await prisma.setting.findMany({
      where: { grp: 'appearance' }
    })
    const config: Record<string, string> = { ...APPEARANCE_DEFAULTS }
    rows.forEach(r => {
      const val = typeof r.value === 'string' ? r.value : String(r.value)
      // Remove aspas extras do JSON
      config[r.key] = val.replace(/^"|"$/g, '')
    })
    return { appearance: config, landingAdmin: isPrimaryInstall() }
  })

  // GET /api/admin/appearance — Admin (com metadados)
  app.get('/api/admin/appearance', { preHandler: adminOnly }, async () => {
    const rows = await prisma.setting.findMany({
      where: { grp: 'appearance' }
    })
    const config: Record<string, string> = { ...APPEARANCE_DEFAULTS }
    rows.forEach(r => {
      const val = typeof r.value === 'string' ? r.value : String(r.value)
      config[r.key] = val.replace(/^"|"$/g, '')
    })
    return { appearance: config, defaults: APPEARANCE_DEFAULTS, landingAdmin: isPrimaryInstall() }
  })

  // PUT /api/admin/appearance — Salvar configurações de aparência
  app.put('/api/admin/appearance', { preHandler: adminOnly }, async (req, reply) => {
    const updates = req.body as Record<string, string>

    // Códigos personalizados (scripts head/body/CTA) só por SUPERADMIN — são
    // injetados executáveis para todos os usuários (inclusive pré-login).
    const user = (req as any).user as JwtPayload
    if (user.role !== 'SUPERADMIN' && Object.keys(updates).some(k => APPEARANCE_CODE_KEYS.has(k))) {
      return reply.code(403).send({ error: 'Apenas SUPERADMIN pode alterar códigos personalizados (head/body/scripts).' })
    }

    for (const [key, value] of Object.entries(updates)) {
      if (!key.startsWith('appearance.')) continue
      const label = key.replace('appearance.', '').replace(/_/g, ' ')

      const exists = await prisma.setting.findUnique({ where: { key } })
      if (exists) {
        await prisma.setting.update({
          where: { key },
          data: { value: JSON.stringify(value) }
        })
      } else {
        await prisma.setting.create({
          data: {
            key,
            value: JSON.stringify(value),
            label: label.charAt(0).toUpperCase() + label.slice(1),
            grp: 'appearance',
            fieldType: 'color'
          }
        })
      }
    }
    invalidateBrandingCache()
    return { ok: true }
  })

  // POST /api/admin/appearance/logo — Upload de logotipo
  app.post('/api/admin/appearance/logo', { preHandler: adminOnly }, async (req, reply) => {
    const data = await req.file({ limits: { fileSize: 5 * 1024 * 1024 } })
    if (!data) {
      return reply.code(400).send({ error: 'Nenhum arquivo enviado' })
    }

    const ext = extname(data.filename).toLowerCase()
    const allowed = ['.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif', '.ico']
    if (!allowed.includes(ext)) {
      return reply.code(400).send({ error: 'Formato não suportado. Use: PNG, JPG, SVG, WebP, GIF ou ICO' })
    }

    // Valida magic bytes e sanitiza SVG antes de gravar (A8/M6).
    let buf: Buffer
    try {
      const raw = await bufferMultipart(data.file, 5 * 1024 * 1024)
      buf = validateUploadContent(raw, ext.slice(1), { allowSvg: ext === '.svg' })
    } catch (err: any) {
      if (err instanceof UploadTooLargeError) return reply.code(413).send({ error: 'Arquivo muito grande (máx 5MB)' })
      if (err instanceof UploadValidationError) return reply.code(400).send({ error: err.message })
      return reply.code(500).send({ error: 'Falha ao processar arquivo' })
    }

    // Garante que o diretório existe
    const brandDir = join(UPLOADS_DIR, 'brand')
    if (!existsSync(brandDir)) {
      mkdirSync(brandDir, { recursive: true })
    }

    const fieldName = data.fieldname || 'logo' // admin_logo, lp_logo ou favicon
    const fileName = `${fieldName}${ext}`
    const filePath = join(brandDir, fileName)

    await writeFile(filePath, buf)

    const url = `/uploads/brand/${fileName}`

    // Mapeia fieldName para chave no banco
    const keyMap: Record<string, string> = {
      'admin_logo': 'appearance.admin_logo_url',
      'lp_logo': 'appearance.lp_logo_url',
      'favicon': 'appearance.favicon_url',
      'login_image': 'appearance.login_image_url',
      'logo': 'appearance.admin_logo_url', // fallback
    }
    const settingKey = keyMap[fieldName] || 'appearance.admin_logo_url'
    const exists = await prisma.setting.findUnique({ where: { key: settingKey } })
    if (exists) {
      await prisma.setting.update({ where: { key: settingKey }, data: { value: JSON.stringify(url) } })
    } else {
      await prisma.setting.create({
        data: {
          key: settingKey,
          value: JSON.stringify(url),
          label: fieldName === 'favicon' ? 'Favicon URL' : 'Logo URL',
          grp: 'appearance',
          fieldType: 'file'
        }
      })
    }

    return { ok: true, url }
  })

  // DELETE /api/admin/appearance/logo — Remover logotipo
  app.delete('/api/admin/appearance/logo', { preHandler: adminOnly }, async (req) => {
    const { type } = req.query as { type?: string }
    const keyMap: Record<string, string> = {
      'admin_logo': 'appearance.admin_logo_url',
      'lp_logo': 'appearance.lp_logo_url',
      'favicon': 'appearance.favicon_url',
      'login_image': 'appearance.login_image_url',
    }
    const settingKey = keyMap[type || ''] || 'appearance.admin_logo_url'
    const exists = await prisma.setting.findUnique({ where: { key: settingKey } })
    if (exists) {
      await prisma.setting.update({ where: { key: settingKey }, data: { value: JSON.stringify('') } })
    }
    return { ok: true }
  })

}
