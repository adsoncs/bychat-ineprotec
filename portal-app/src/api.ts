// Conversa com o backend do portal. Cada função devolve dado ou erro legível —
// nada de "Failed to fetch" chegando à tela.

import type { Campo } from './validacao'

export interface Oferta {
  id: number
  nome: string
  /** Forma de ingresso do processo seletivo — decide os campos condicionais. */
  selectionProcess?: {
    id: number
    nome: string
    /** Taxa de inscrição: é o valor que o resumo mostra antes do contrato. */
    taxaInscricao?: string | number | null
    entryMode?: { id: number; code: string; name: string } | null
  } | null
  turno?: string | null
  complemento?: string | null
  valorMensalidade?: string | number | null
  valorMatricula?: string | number | null
  courseId?: number
  levelId?: number | null
  modalityId?: number | null
  /** Nível e modalidade viram as etiquetas do resumo (ex.: TÉCNICO · EAD). */
  level?: { id: number; nome: string } | null
  modality?: { id: number; nome: string } | null
}

export interface Passo { id: string; name: string; fields: Campo[] }

/** Conclusão configurável no builder: mensagem própria ou redirecionamento. */
export interface Conclusao { behavior?: 'message' | 'redirect'; message?: string; target?: string }

export interface Portal {
  id: number
  slug: string
  nome: string
  formConfig: { steps: Passo[]; _informativeBlocks?: Record<string, { config?: unknown }> }
  formMode: string
  requirePayment: boolean
  metaTitle?: string | null
  metaDescription?: string | null
  brandLogoUrl?: string | null
  brandPrimaryColor?: string | null
  brandHeroEnabled?: boolean
  brandHeroTitle?: string | null
  brandHeroSubtitle?: string | null
  brandHeroUrl?: string | null
  brandFooterText?: string | null
  brandRadiusScale?: number | string | null
  brandFontFamily?: string | null
  brandLogoLink?: string | null
  brandHeroOverlayOpacity?: number | null
  /** 'classico' (uma coluna) ou 'duas-colunas' (formulário + resumo ao lado). */
  brandTemplate?: string | null
  /** Acabamento — aparência, não identidade. Ver o comentário em estilo.css. */
  brandHeaderStyle?: string | null
  brandStepStyle?: string | null
  brandBackdropFrom?: string | null
  brandBackdropTo?: string | null
  brandButtonShape?: string | null
  brandButtonUppercase?: boolean | null
  brandSecurityNote?: string | null
  brandSummaryAlways?: boolean | null
  brandSecondaryColor?: string | null
  brandTypeScale?: string | null
  brandContentWidth?: string | null
  /** Textos trocáveis da tela. Chave ausente = texto padrão do sistema. */
  brandLabels?: Record<string, string> | null
  ctaBehavior?: string | null
  ctaTarget?: string | null
  ctaMessage?: string | null
}

export interface DadosPortal { portal: Portal; offerings: Oferta[] }

/** Bloco de conclusão, quando o builder o configurou. */
export function conclusaoDoPortal(p: Portal): Conclusao | null {
  const meta = (p.formConfig as unknown as { _informativeBlocks?: Record<string, { config?: Conclusao }> })?._informativeBlocks
  return meta?.completion?.config ?? null
}

async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  let r: Response
  try {
    r = await fetch(url, { credentials: 'same-origin', ...init })
  } catch {
    throw new Error('Não conseguimos falar com o servidor. Verifique sua conexão e tente de novo.')
  }
  const texto = await r.text()
  let corpo: any = null
  try { corpo = texto ? JSON.parse(texto) : null } catch { /* resposta não-JSON */ }
  if (!r.ok) {
    const falha = new Error(corpo?.error || `Não foi possível concluir (erro ${r.status}).`)
    // Sinalizadores que a tela usa para decidir o que fazer com o erro — hoje
    // só `recusado`, do cartão negado pela operadora.
    if (corpo?.recusado) (falha as Error & { recusado?: boolean }).recusado = true
    throw falha
  }
  return corpo as T
}

export const carregarPortal = (slug: string) =>
  pedir<DadosPortal>(`/api/public/portals/${encodeURIComponent(slug)}`)

export interface RespostaInscricao {
  ok: boolean
  candidateCode: string
  enrollmentId: number
  status: string
  paymentUrl?: string | null
  paymentMode?: string
  candidateToken?: string
  /** Já existe conta com senha para esta pessoa — decide o botão do topo. */
  temSenha?: boolean
}

export const enviarInscricao = (slug: string, formData: Record<string, unknown>) =>
  pedir<RespostaInscricao>(`/api/public/portals/${encodeURIComponent(slug)}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ formData }),
  })

/** Rascunho no servidor: quem troca de aparelho no meio não recomeça. */
export const salvarRascunho = (slug: string, sessionId: string, formData: Record<string, unknown>, stepIndex: number) =>
  pedir<{ ok: boolean }>(`/api/public/portals/${encodeURIComponent(slug)}/draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, formData, stepIndex }),
  }).catch(() => ({ ok: false }))

export const lerRascunho = (slug: string, sessionId: string) =>
  pedir<{ draft?: { formData?: Record<string, unknown>; stepIndex?: number } | null }>(
    `/api/public/portals/${encodeURIComponent(slug)}/draft/${encodeURIComponent(sessionId)}`,
  ).catch(() => ({ draft: null }))

/** Cria a senha logo após a inscrição, usando o token que o /register devolveu. */
export const criarSenhaInicial = (candidateToken: string, senha: string) =>
  pedir<{ ok: boolean }>('/api/public/portal/senha-inicial', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ candidateToken, senha }),
  })

// ── Área do candidato: documentos ────────────────────────────────────────────

export interface Exigencia {
  required: boolean
  ordem: number
  helpText?: string | null
  documentType: { id: number; code: string; name: string; category?: string | null }
}

export interface DocumentoEnviado {
  id: number
  typeCode: string
  label: string
  fileName: string
  mimeType: string
  sizeBytes: number
  status: string
  reviewNote?: string | null
  uploadedAt: string
}

export interface Candidato {
  enrollment: { id: number; candidateCode: string; status: string }
  lead: { nome: string; email?: string | null; whatsapp?: string | null }
  portal: { nome: string; brandPrimaryColor?: string | null; brandLogoUrl?: string | null; brandFooterText?: string | null }
  processRegistration?: { effectiveDocumentRequirements?: Exigencia[] } | null
  documents: DocumentoEnviado[]
}

export const carregarCandidato = () => pedir<Candidato>('/api/candidate/me')

/** Envio do arquivo. Multipart porque o backend valida os bytes, não só o nome. */
export async function enviarDocumento(typeCode: string, label: string, arquivo: File): Promise<void> {
  const fd = new FormData()
  fd.append('file', arquivo, arquivo.name)
  fd.append('typeCode', typeCode)
  fd.append('label', label)
  const r = await fetch('/api/candidate/documents', { method: 'POST', body: fd, credentials: 'same-origin' })
  if (!r.ok) {
    const t = await r.text()
    let msg = `Não foi possível enviar (erro ${r.status}).`
    try { msg = JSON.parse(t).error || msg } catch { /* resposta não-JSON */ }
    throw new Error(msg)
  }
}

export async function removerDocumento(id: number): Promise<void> {
  const r = await fetch(`/api/candidate/documents/${id}`, { method: 'DELETE', credentials: 'same-origin' })
  if (!r.ok) throw new Error('Não foi possível remover o arquivo.')
}

// ── Retomada por magic link ──────────────────────────────────────────────────
// O link que a secretaria gera e manda pelo WhatsApp. Traz um token assinado com
// validade; quem já se inscreveu volta ao ponto onde parou, e quem só demonstrou
// interesse encontra o formulário preenchido com o que já informou.

export interface Retomada {
  ok: true
  lead: { id: number; nome: string; email: string | null; whatsapp: string | null }
  prefill: { nome: string; email: string | null; whatsapp: string | null; offeringId: number | null; cidade: string | null }
  /** Já existe conta com senha para esta pessoa — decide o botão do topo. */
  temSenha: boolean
  registration: {
    candidateCode: string
    status: string
    paymentStatus: string | null
    paymentUrl: string | null
    candidateToken: string
  } | null
}

export async function continuarPorToken(slug: string, token: string): Promise<Retomada> {
  const r = await fetch(`/api/public/portals/${encodeURIComponent(slug)}/continue?t=${encodeURIComponent(token)}`, {
    credentials: 'same-origin',
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d?.error || 'Link expirado ou inválido. Peça um novo à secretaria.')
  return d
}

// ── Área do aluno ────────────────────────────────────────────────────────────

export interface Passo {
  chave: string
  titulo: string
  detalhe: string
  situacao: 'feito' | 'pendente' | 'travado'
  acao?: { rotulo: string; href: string } | null
}

export interface Parcela {
  id: number
  numero: number
  tipo: string
  valorCentavos: number
  vencimento: string
  situacao: string
  pagoEm?: string | null
  linhaDigitavel?: string | null
  pix?: string | null
  temCobranca?: boolean
}

export interface PainelAluno {
  aluno: { id: number; nome: string; ra: string | null; email?: string | null; whatsapp?: string | null }
  matricula: { id: number; status: string; turma: string; periodo: string | null } | null
  passos: Passo[]
  bloqueio?: { bloqueado: boolean; motivo?: string | null } | null
  financeiro: { totalAbertoCentavos: number; vencidas: number; parcelas: Parcela[] }
  boletim: Array<{ turma: string; disciplinas: Array<{ nome: string; media: number | null; freqPct: number }> }>
  requerimentos: {
    tipos: Array<{ id: number; nome: string; descricao?: string | null; slaDias: number; custoCentavos: number }>
    abertos: number
    lista: Array<{ id: number; protocolo: string; tipoNome: string; assunto: string; status: string; resposta?: string | null; createdAt: string }>
  }
  rematricula: { disponivel: boolean; ofertas: Array<{ turmaId: number; nome: string }> }
  // ── Vida acadêmica (Fase 7) ──
  // Vinha só do portal SSR do ERP; a aplicação mostrava menos que o portal antigo.
  grade: Array<{ diaSemana: number; horaInicio: string; horaFim: string; disciplinaNome: string; sala?: string | null; professorNome?: string | null }>
  materiais: Array<{ disciplina: string; itens: Array<{ titulo: string; url: string; tipo: string; descricao?: string | null }> }>
  horas: {
    estagio: { horas: number; meta: number; cumprido: boolean }
    atividades: { horas: number; meta: number; cumprido: boolean; pendentes: number }
  } | null
  eventos: Array<{ titulo: string; dataInicio: string; dataFim?: string | null; tipo: string; descricao?: string | null }>
  marca?: string | null
}

export const carregarPainelAluno = () => pedir<PainelAluno>('/api/public/aca/aluno/painel')

/**
 * Gera a cobrança de uma parcela em aberto.
 *
 * A cobrança no gateway é criada sob demanda — antes desta rota, o aluno via a
 * parcela e não tinha como pagar pela aplicação.
 */
export async function gerarCobrancaDaParcela(id: number): Promise<{ jaExistia: boolean; pix: string | null; linhaDigitavel: string | null }> {
  const r = await fetch(`/api/public/aca/aluno/parcelas/${id}/cobranca`, {
    method: 'POST', credentials: 'same-origin',
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d?.error || 'Não foi possível gerar a cobrança.')
  return d
}

// ── Contrato de matrícula ────────────────────────────────────────────────────
// Fase 5: o contrato é lido e assinado aqui. Antes só existia no SSR do ERP e no
// provedor externo de assinatura.

export interface ContratoDoAluno {
  id: number
  matriculaId: number
  titulo: string
  termo: string
  curso: string
  turma: string
  aluno: string
  ra: string
  valorTotalCentavos: number
  numParcelas: number
  valorParcelaCentavos: number
  assinado: boolean
  assinadoEm: string | null
  assinadoPor: string | null
  envelope: { id: number; status: string; link: string | null } | null
}

export const carregarContrato = () =>
  pedir<{ contrato: ContratoDoAluno }>('/api/public/aca/aluno/contrato').then((r) => r.contrato)

export async function assinarContrato(nome: string): Promise<{ jaAssinado: boolean; matriculaEfetivada: boolean }> {
  const r = await fetch('/api/public/aca/aluno/contrato/assinar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ nome }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d?.error || 'Não foi possível registrar sua assinatura.')
  return d
}

// ── Pagamento da taxa de inscrição ───────────────────────────────────────────

export interface MetodoPagamento {
  id: number
  method: string
  provider: string
  status: string
  amount: number | null
  expiresAt?: string | null
  qrCode?: string | null
  qrCodeUrl?: string | null
  boletoLine?: string | null
  boletoPdfUrl?: string | null
  paidAt?: string | null
}

export const iniciarPagamento = (
  code: string,
  metodo: 'pix' | 'boleto' | 'credit_card',
  token: string,
  parcelas = 1,
  // Vai no corpo desta requisição e em nenhum outro lugar: não é guardado no
  // rascunho, não volta na resposta e não aparece em log.
  cartao?: { holderName: string; number: string; expiryMonth: string; expiryYear: string; ccv: string },
  cupom?: string,
  // Token de uso único gerado no navegador (iugu.js). Com ele, os dados do
  // cartão não vão nesta requisição.
  cardToken?: string,
) =>
  pedir<{ ok: boolean; method: MetodoPagamento; checkoutUrl?: string }>(
    `/api/public/registrations/${encodeURIComponent(code)}/payment-init`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        method: metodo, parcelas,
        ...(cartao && !cardToken ? { card: cartao } : {}),
        ...(cardToken ? { cardToken } : {}),
        ...(cupom ? { cupom } : {}),
      }),
    },
  )

export const consultarPagamento = (code: string, token: string) =>
  pedir<{ paymentStatus: string | null; paymentPaidAt?: string | null; checkoutUrl?: string | null; methods?: MetodoPagamento[] }>(
    `/api/public/registrations/${encodeURIComponent(code)}/payment-status`,
    { headers: { Authorization: `Bearer ${token}` } },
  )

/** Só existe quando a conexão do portal é o provedor simulado. */
export const simularPagamento = (code: string, token: string) =>
  pedir<{ ok: boolean }>(`/api/public/registrations/${encodeURIComponent(code)}/simular-pagamento`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  })

// ─────────────────────────────────────────────────────────────────────────────
// Conversão nos pixels
//
// Os snippets (GA4/GTM/Meta/TikTok/LinkedIn) são injetados pelo servidor a
// partir da aba SEO do portal. Aqui só avisamos que a inscrição foi concluída,
// com os mesmos eventos que a tela clássica sempre disparou — trocar de tela
// não pode zerar o que a instituição mede das campanhas.

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
    dataLayer?: unknown[]
    fbq?: (...args: unknown[]) => void
    ttq?: { track: (nome: string, dados?: unknown) => void }
    lintrk?: (acao: string, dados?: unknown) => void
  }
}

/** Nunca lança: medição não pode atrapalhar quem acabou de se inscrever. */
export function marcarConversao(candidateCode: string, nomeDoPortal: string): void {
  try {
    if (window.gtag) {
      window.gtag('event', 'enrollment_submitted', {
        event_category: 'enrollment',
        event_label: candidateCode,
        value: 1,
      })
      window.gtag('event', 'generate_lead', { currency: 'BRL', value: 0 })
    }
    if (Array.isArray(window.dataLayer)) {
      window.dataLayer.push({ event: 'enrollment_submitted', candidateCode })
    }
    if (window.fbq) window.fbq('track', 'Lead', { content_name: nomeDoPortal })
    if (window.ttq) window.ttq.track('SubmitForm', { content_name: nomeDoPortal })
    // LinkedIn: sem conversion_id configurável, o evento genérico é o que dá.
    if (window.lintrk) window.lintrk('track')
  } catch { /* medição nunca bloqueia a tela */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Textos da tela
//
// O padrão vive aqui, e a instituição troca o que quiser no builder. Chave sem
// valor cai no padrão — assim um rótulo novo pode nascer no código e só depois
// virar campo no builder, sem quebrar portal nenhum.

export const TEXTOS_PADRAO: Record<string, string> = {
  continuar: 'Continuar',
  voltar: 'Voltar',
  enviar: 'Confirmar inscrição',
  revisao: 'Revisão',
  revisaoTitulo: 'Confira antes de enviar',
  revisaoSubtitulo: 'Depois de confirmar, esses dados vão para a secretaria.',
  resumoTitulo: 'Resumo da inscrição',
  resumoVazio: 'O curso escolhido e os valores aparecem aqui.',
  resumoTaxa: 'Taxa de inscrição',
  resumoMatricula: 'Taxa de matrícula',
  resumoMensalidade: 'Mensalidade',
  resumoObservacao: 'Os valores são confirmados no contrato, depois da análise dos documentos.',
}

/** Texto da tela: o que a instituição escreveu, ou o padrão.
    Chama-se `rotulo` porque `texto` já é nome de variável local em `pedir`. */
export function rotulo(portal: Portal | null | undefined, chave: string): string {
  const escolhido = portal?.brandLabels?.[chave]
  return (typeof escolhido === 'string' && escolhido.trim()) || TEXTOS_PADRAO[chave] || ''
}

// ── Opções de pagamento ──────────────────────────────────────────────────────

export interface OpcaoParcela {
  parcelas: number
  valorParcela: number
  valorTotal: number
  acrescimo: number
  semJuros: boolean
  descricao: string
}

export interface OpcaoBoleto {
  parcelas: number
  valorEntrada: number
  valorParcela: number
  valorTotal: number
  acrescimo: number
  semAcrescimo: boolean
  descricao: string
}

export interface CupomNaTela {
  aplicado: boolean
  /** Presente quando aplicado. */
  code?: string
  descricao?: string | null
  desconto?: number
  /** 'cupom' | 'a_vista' | 'nenhum' — qual desconto venceu. */
  origem?: string
  /** Presente quando recusado. */
  motivo?: string
  /** Meios em que o cupom vale; null = todos. */
  metodos?: Array<'pix' | 'boleto' | 'credit_card'> | null
  /** Teto de parcelas com o cupom. */
  maxParcelas?: number | null
  acumulaAVista?: boolean
}

export interface OpcoesDePagamento {
  escopo: 'taxa' | 'curso'
  /** "Taxa de inscrição", "Matrícula" ou "1ª mensalidade". */
  rotulo?: string
  valor: number
  /** Preço antes de qualquer desconto. */
  valorTabela?: number
  cupom?: CupomNaTela | null
  meios: {
    pix: { ativo: boolean; valor?: number; descontoPct?: number; expiraHoras?: number }
    boleto: { ativo: boolean; parcelado?: boolean; parcelasMax?: number; opcoes?: OpcaoBoleto[] }
    cartao: {
      ativo: boolean
      hospedado?: boolean
      opcoes?: OpcaoParcela[]
      /** Presente quando o cartão vira token no navegador antes de ir ao servidor (iugu). */
      tokenizacao?: { provider: 'iugu'; accountId: string; teste: boolean }
    }
  }
}

/**
 * O que este portal aceita e quanto fica cada opção — a conta vem do servidor.
 * Com `cupom`, os valores já voltam com o desconto aplicado.
 */
export const opcoesDePagamento = (code: string, token: string, cupom?: string) =>
  pedir<OpcoesDePagamento>(
    `/api/public/registrations/${encodeURIComponent(code)}/payment-options`
      + (cupom ? `?cupom=${encodeURIComponent(cupom)}` : ''),
    { headers: { Authorization: `Bearer ${token}` } },
  )
