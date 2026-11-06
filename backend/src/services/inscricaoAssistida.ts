// services/inscricaoAssistida.ts
//
// Inscrição ASSISTIDA (03/11/2026): o atendente abre o PRÓPRIO portal do
// candidato pelo painel e faz a inscrição/matrícula com ele — as mesmas etapas,
// regras e travas do portal, sem uma segunda versão no painel.
//
// Como funciona:
//   1. O painel gera um token de atendimento (lib/candidateAuth › signAtendimento)
//      e abre /portal/<slug>?t=<token>&atendimento=1.
//   2. O portal guarda o token na aba e o manda no cabeçalho X-Attrae-Atendente
//      em todo pedido.
//   3. Este módulo, num preHandler global:
//        - recusa token vencido/adulterado (401) — nunca cai em "candidato";
//        - barra o que só o candidato pode fazer (redação, contrato, aceite do
//          parecer, senha/login, cartão de crédito) com mensagem de passar o link;
//        - marca a requisição com o atendente (req.atendente).
//   4. Num onResponse global, grava o histórico da inscrição (quem fez o quê),
//      seja o atendente ou o próprio candidato.
//
// Nada aqui envia mensagem a ninguém: "passar para o candidato" só gera o link,
// e o atendente decide como mandar.

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { verifyAtendimento, verifyCandidateToken } from '../lib/candidateAuth.js'

export const CABECALHO_ATENDENTE = 'x-attrae-atendente'

export interface Atendente {
  userId: number
  nome: string
  portalSlug: string
  leadId: number | null
  /** Matrícula interna: sem a ordem das etapas, prazo do edital ou pausa do portal. */
  interno: boolean
}

export type AtorDoEvento = 'candidato' | 'atendente' | 'sistema'

/** O atendente desta requisição (já validado pelo preHandler), ou null. */
export function atendenteDe(req: FastifyRequest): Atendente | null {
  return ((req as any).atendente as Atendente | undefined) ?? null
}

/**
 * Para o cupom "só a equipe" (services/portalCupom): null = não é atendimento
 * (o código não existe para o público); `pode` = o agente tem a permissão
 * "Desconto da equipe".
 */
export async function equipeDoCupom(req: FastifyRequest): Promise<{ pode: boolean; userId: number } | null> {
  const at = atendenteDe(req)
  if (!at) return null
  const u = await prisma.user.findUnique({ where: { id: at.userId }, select: { role: true } }).catch(() => null)
  if (!u) return { pode: false, userId: at.userId }
  if (u.role === 'SUPERADMIN') return { pode: true, userId: at.userId }
  const { resolvePermissions } = await import('../lib/permissions.js')
  const perms = await resolvePermissions(at.userId, u.role).catch(() => ({} as any))
  return { pode: !!perms.edu_desconto_equipe?.canEdit, userId: at.userId }
}

/** A requisição veio de uma sessão de atendimento (mesmo antes de validar)? */
export function veioDeAtendimento(req: FastifyRequest): boolean {
  return !!req.headers[CABECALHO_ATENDENTE]
}

// ── O que só o candidato faz ────────────────────────────────────────────────
// Por rota (padrão do Fastify), não por URL crua: o id/código no meio não muda.
const SO_O_CANDIDATO: Array<{ metodo: string; rota: string; motivo: string }> = [
  { metodo: 'POST', rota: '/api/candidate/essay/start', motivo: 'A redação precisa ser feita pelo próprio candidato.' },
  { metodo: 'PUT', rota: '/api/candidate/essay/:id/draft', motivo: 'A redação precisa ser feita pelo próprio candidato.' },
  { metodo: 'POST', rota: '/api/candidate/essay/:id/submit', motivo: 'A redação precisa ser feita pelo próprio candidato.' },
  { metodo: 'POST', rota: '/api/public/registrations/:code/contrato/iniciar', motivo: 'O contrato precisa ser assinado pelo próprio candidato (se ele assinou a via impressa, registre em "Contrato assinado no papel", na página da inscrição).' },
  { metodo: 'POST', rota: '/api/public/registrations/:code/contrato/assinar', motivo: 'O contrato precisa ser assinado pelo próprio candidato (se ele assinou a via impressa, registre em "Contrato assinado no papel", na página da inscrição).' },
  { metodo: 'POST', rota: '/api/public/aca/aluno/contrato/assinar', motivo: 'O contrato precisa ser assinado pelo próprio candidato (se ele assinou a via impressa, registre em "Contrato assinado no papel", na página da inscrição).' },
  { metodo: 'POST', rota: '/api/public/registrations/:code/analise/decisao', motivo: 'Aceitar ou recusar o parecer é decisão do próprio candidato.' },
  { metodo: 'POST', rota: '/api/public/portal/senha-inicial', motivo: 'A senha de acesso é criada pelo próprio candidato.' },
  { metodo: 'POST', rota: '/api/public/portal/senha', motivo: 'A senha de acesso é criada pelo próprio candidato.' },
  { metodo: 'POST', rota: '/api/public/portal/login', motivo: 'Durante o atendimento não se entra na conta do candidato.' },
  { metodo: 'POST', rota: '/api/public/portal/entrar-codigo', motivo: 'Durante o atendimento não se entra na conta do candidato.' },
  { metodo: 'POST', rota: '/api/public/portal/recuperar', motivo: 'Durante o atendimento não se entra na conta do candidato.' },
]
const PASSE_O_LINK = 'Use "Passar para o candidato" no topo da página e envie o link a ele.'

/** Rotas cujo sucesso vira linha no histórico da inscrição. */
const REGISTRA: Array<{ metodo: string; rota: string; etapa: string; acao: string }> = [
  { metodo: 'POST', rota: '/api/public/registrations/:code/dados', etapa: 'cadastro', acao: 'dados_salvos' },
  { metodo: 'POST', rota: '/api/candidate/documents', etapa: 'documentos', acao: 'documento_enviado' },
  { metodo: 'DELETE', rota: '/api/candidate/documents/:id', etapa: 'documentos', acao: 'documento_removido' },
  { metodo: 'POST', rota: '/api/public/registrations/:code/payment-init', etapa: 'pagamento', acao: 'cobranca_gerada' },
  { metodo: 'POST', rota: '/api/public/registrations/:code/contrato/assinar', etapa: 'contrato', acao: 'contrato_assinado' },
  { metodo: 'POST', rota: '/api/public/registrations/:code/analise/decisao', etapa: 'analise', acao: 'parecer_respondido' },
  { metodo: 'POST', rota: '/api/candidate/essay/:id/submit', etapa: 'prova', acao: 'redacao_enviada' },
]

const rotaDe = (req: FastifyRequest): string => (req as any).routeOptions?.url || (req as any).routerPath || ''

// Usuário ainda ativo? Cache curto: o portal faz vários pedidos por tela.
const ativos = new Map<number, { ok: boolean; nome: string; ts: number }>()
async function usuarioAtivo(userId: number): Promise<{ ok: boolean; nome: string }> {
  const c = ativos.get(userId)
  if (c && Date.now() - c.ts < 60_000) return c
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { active: true, name: true } }).catch(() => null)
  const r = { ok: !!u?.active, nome: u?.name || '', ts: Date.now() }
  ativos.set(userId, r)
  return r
}

/** Grava uma linha no histórico da inscrição. Nunca derruba quem chamou. */
export async function registrarEventoDaInscricao(p: {
  registrationId: number
  etapa: string
  acao: string
  ator: AtorDoEvento
  userId?: number | null
  userName?: string | null
  req?: FastifyRequest | null
  dados?: Record<string, unknown> | null
}): Promise<void> {
  try {
    const ip = p.req ? ((p.req.headers['x-forwarded-for'] as string || '').split(',')[0].trim() || p.req.ip || null) : null
    await prisma.enrollmentRegistrationEvent.create({
      data: {
        registrationId: p.registrationId,
        etapa: p.etapa.slice(0, 30),
        acao: p.acao.slice(0, 60),
        ator: p.ator,
        userId: p.userId ?? null,
        userName: p.userName ? p.userName.slice(0, 191) : null,
        ip: ip ? ip.slice(0, 45) : null,
        userAgent: p.req ? String(p.req.headers['user-agent'] || '').slice(0, 500) || null : null,
        dados: (p.dados ?? undefined) as any,
      },
    })
  } catch (e: any) {
    console.warn('[inscricaoAssistida] histórico não gravado:', e?.message)
  }
}

/** A inscrição de uma rota de etapa: pelo código na URL ou pela sessão do candidato. */
async function inscricaoDaRequisicao(req: FastifyRequest): Promise<number | null> {
  const params = (req.params as any) || {}
  if (params.code) {
    const r = await prisma.enrollmentRegistration.findUnique({ where: { candidateCode: String(params.code) }, select: { id: true } })
    return r?.id ?? null
  }
  const tok = verifyCandidateToken(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''))
  if (tok?.enrollmentId) return tok.enrollmentId
  if (veioDeAtendimento(req)) return null
  const { contaDaRequisicao } = await import('../lib/portalSession.js')
  const conta = await contaDaRequisicao(req).catch(() => null)
  if (!conta) return null
  const r = await prisma.enrollmentRegistration.findFirst({
    where: { leadId: conta.leadId, status: { not: 'merged' } }, orderBy: { id: 'desc' }, select: { id: true },
  })
  return r?.id ?? null
}

export function instalarInscricaoAssistida(app: FastifyInstance): void {
  app.addHook('preHandler', async (req, reply) => {
    const bruto = req.headers[CABECALHO_ATENDENTE]
    if (!bruto) return
    const url = req.url.split('?')[0]
    // Só o portal público fala com este cabeçalho; no resto ele é ignorado.
    if (!url.startsWith('/api/public/') && !url.startsWith('/api/candidate/')) return
    const tok = verifyAtendimento(String(bruto))
    const u = tok ? await usuarioAtivo(tok.userId) : null
    if (!tok || !u?.ok) {
      return reply.code(401).send({
        error: 'A sessão de atendimento terminou. Abra a inscrição de novo pelo painel (Portal › Nova inscrição).',
        atendimentoExpirado: true,
      })
    }
    // Um atendimento vale para um portal; as rotas por slug conferem.
    const slug = (req.params as any)?.slug
    if (slug && slug !== tok.portalSlug) {
      return reply.code(403).send({ error: 'Esta sessão de atendimento é de outro portal. Abra a inscrição pelo painel neste portal.' })
    }
    const rota = rotaDe(req)
    const proibida = SO_O_CANDIDATO.find((b) => b.metodo === req.method && b.rota === rota)
    if (proibida) return reply.code(403).send({ error: `${proibida.motivo} ${PASSE_O_LINK}`, soOCandidato: true })
    if (req.method === 'POST' && rota === '/api/public/registrations/:code/payment-init' && (req.body as any)?.method === 'credit_card') {
      return reply.code(403).send({
        error: `O atendente não digita dados de cartão do candidato (regra de segurança dos cartões). Gere Pix ou boleto, ou ${PASSE_O_LINK.charAt(0).toLowerCase()}${PASSE_O_LINK.slice(1)}`,
        soOCandidato: true,
      })
    }
    ;(req as any).atendente = { userId: tok.userId, nome: u.nome || tok.nome, portalSlug: tok.portalSlug, leadId: tok.leadId, interno: !!tok.interno } satisfies Atendente
  })

  app.addHook('onResponse', async (req, reply) => {
    if (reply.statusCode >= 400) return
    const rota = rotaDe(req)
    const r = REGISTRA.find((x) => x.metodo === req.method && x.rota === rota)
    if (!r) return
    const at = atendenteDe(req)
    const registrationId = await inscricaoDaRequisicao(req).catch(() => null)
    if (!registrationId) return
    // Matrícula interna: agir pelas abas conta como conduzir a inscrição.
    if (at?.interno) await prisma.enrollmentRegistration.update({ where: { id: registrationId }, data: { atendidoPorUserId: at.userId } }).catch(() => {})
    const dados: Record<string, unknown> = {}
    if (r.acao === 'cobranca_gerada') {
      dados.meio = (req.body as any)?.method ?? null
      const cupom = String((req.body as any)?.cupom || '').trim()
      if (cupom) dados.cupom = cupom.toUpperCase()
    }
    if (r.acao === 'documento_removido') dados.documentoId = Number((req.params as any)?.id) || null
    if (r.acao === 'dados_salvos') dados.etapa = (req.query as any)?.etapa ?? null
    await registrarEventoDaInscricao({
      registrationId, etapa: r.etapa, acao: r.acao,
      ator: at ? 'atendente' : 'candidato',
      userId: at?.userId ?? null, userName: at?.nome ?? null,
      req, dados: Object.keys(dados).length ? dados : null,
    })
  })
}

/** Rótulo legível de cada ação do histórico (painel). */
export const ROTULO_ACAO: Record<string, string> = {
  inscricao_criada: 'Inscrição enviada',
  inscricao_retomada: 'Inscrição reenviada (mesma pessoa)',
  inscricao_administrativa: 'Cadastro administrativo da inscrição',
  atendimento_aberto: 'Atendimento assistido aberto',
  link_para_candidato: 'Link gerado para o candidato continuar',
  dados_salvos: 'Dados do cadastro salvos',
  documento_enviado: 'Documento enviado',
  documento_removido: 'Documento removido',
  cobranca_gerada: 'Cobrança gerada',
  contrato_assinado: 'Contrato assinado',
  parecer_respondido: 'Parecer respondido',
  redacao_enviada: 'Redação enviada',
  pagamento_manual: 'Pagamento manual registrado',
  dados_corrigidos: 'Dados do cadastro corrigidos',
  contrato_presencial: 'Contrato assinado no papel registrado',
  valor_personalizado: 'Valor personalizado definido',
  valor_personalizado_removido: 'Valor personalizado removido (voltou à tabela)',
  link_contrato: 'Link do contrato gerado para o aluno',
  assinatura_iniciada: 'Assinatura eletrônica iniciada pela equipe',
  etapa_dispensada: 'Etapa dispensada',
  etapa_dispensa_removida: 'Dispensa da etapa removida',
  documento_dispensado: 'Documento dispensado',
  documento_dispensa_removida: 'Dispensa do documento removida',
  curso_alterado: 'Curso, forma de ingresso ou polo alterado',
}
