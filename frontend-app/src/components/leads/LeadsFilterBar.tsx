// Barra de filtros da tela de Leads.
//
// Cada filtro é um botão compacto ("Responsável ▾") que abre uma lista com
// busca e contagem por opção. Ativo, o botão vira "Responsável: Ana +2" com um ×
// para limpar só ele. Os filtros do dia a dia ficam sempre à mostra; os demais
// entram pelo "+ Filtro", agrupados por tema, e somem quando limpos.
//
// Compatível com filtros salvos antigos: as chaves de valor único (funnelId,
// status, source, aiScoreLabel) são lidas como lista e, ao mexer no filtro,
// trocadas pela chave nova de lista.
import { useMemo, useState, useRef, useEffect } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import * as Popover from '@radix-ui/react-popover'
import {
  Users2, KanbanSquare, Layers, Megaphone, Tag as TagIcon, Calendar, CalendarClock, CalendarCheck,
  MessageCircle, ListTodo, Sparkles, Trophy, XCircle, MapPin, Briefcase, Phone, Link2, Search, Check,
  ChevronDown, X, Plus, Flag, GraduationCap, ClipboardList, Target, Clock, UserCheck,
  ArrowDownWideNarrow, Zap, AlertTriangle, Inbox, Flame, Smartphone, School, BookOpen, FileCheck2,
  Banknote, BadgeCheck, FormInput, ListChecks,
} from '@/components/ui/icon-set'
import { useLeadFilterOptions, type LeadFilterOption, type LeadFilterOptions, type LeadsListFilters } from '@/hooks/useLeads'
import { useEducacionalLigado } from '@/hooks/usePermissions'
import { leadSourceLabel } from '@/lib/leadSourceLabels'
import { STATUS_INSCRICAO, PAGAMENTO, SITUACAO_MATRICULA } from '@/components/leads/eduColumns'
import { cn } from '@/lib/cn'

type F = LeadsListFilters
type Patch = Partial<F>

// ─── Rótulos ───────────────────────────────────────────────────────────

const ORIGIN_LABELS: Record<string, string> = {
  trackable_link: 'Link rastreável', meta_ctwa: 'Meta Ads → WhatsApp', meta_ctm: 'Meta Ads → Direct/Messenger',
  google_ads: 'Google Ads', meta_lead_ads: 'Meta Lead Ads (formulário)', organic: 'Orgânico', web_form: 'Formulário do site',
  scheduling: 'Agendamento', web_chat: 'Chat do site', chat: 'Chat', api: 'API', import: 'Importação', manual: 'Manual',
  whatsapp: 'WhatsApp direto', instagram: 'Instagram direto', telegram: 'Telegram', enrollment_portal: 'Portal de matrículas',
  make: 'Make.com', direct: 'Direto (sem pista)', db_connector: 'Banco de dados', __none: 'Sem tipo',
}
const SCORE_LABELS: Record<string, string> = { hot: 'Quente (70–100)', warm: 'Morno (40–69)', cold: 'Frio (0–39)', __none: 'Sem score' }
const SCORE_COLORS: Record<string, string> = { hot: '#ef4444', warm: '#f59e0b', cold: '#3b82f6' }

// ─── Datas ─────────────────────────────────────────────────────────────

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function br(s: string): string {
  const [y, m, d] = s.split('-')
  return `${d}/${m}${y !== String(new Date().getFullYear()) ? `/${y!.slice(2)}` : ''}`
}
type Preset = { id: string; label: string; range: () => [string, string] }
const PRESETS: Preset[] = [
  { id: 'hoje', label: 'Hoje', range: () => { const t = ymd(new Date()); return [t, t] } },
  { id: 'ontem', label: 'Ontem', range: () => { const d = new Date(); d.setDate(d.getDate() - 1); const t = ymd(d); return [t, t] } },
  { id: '7d', label: 'Últimos 7 dias', range: () => { const d = new Date(); d.setDate(d.getDate() - 6); return [ymd(d), ymd(new Date())] } },
  { id: '30d', label: 'Últimos 30 dias', range: () => { const d = new Date(); d.setDate(d.getDate() - 29); return [ymd(d), ymd(new Date())] } },
  { id: 'mes', label: 'Este mês', range: () => { const d = new Date(); return [ymd(new Date(d.getFullYear(), d.getMonth(), 1)), ymd(d)] } },
  { id: 'mespassado', label: 'Mês passado', range: () => { const d = new Date(); return [ymd(new Date(d.getFullYear(), d.getMonth() - 1, 1)), ymd(new Date(d.getFullYear(), d.getMonth(), 0))] } },
  { id: 'ano', label: 'Este ano', range: () => { const d = new Date(); return [ymd(new Date(d.getFullYear(), 0, 1)), ymd(d)] } },
]
function resumoDeData(de?: string, ate?: string): string {
  for (const p of PRESETS) { const [a, b] = p.range(); if (a === de && b === ate) return p.label }
  if (de && ate) return de === ate ? br(de) : `${br(de)} – ${br(ate)}`
  if (de) return `desde ${br(de)}`
  if (ate) return `até ${br(ate)}`
  return ''
}

// ─── Definições ────────────────────────────────────────────────────────

type Grupo = 'Pessoas' | 'Funil e resultado' | 'Origem e campanha' | 'Atendimento' | 'Perfil do lead' | 'Datas' | 'Qualidade e sinais' | 'Educacional' | 'Campos personalizados'
const ORDEM_GRUPOS: Grupo[] = ['Pessoas', 'Funil e resultado', 'Atendimento', 'Origem e campanha', 'Datas', 'Perfil do lead', 'Qualidade e sinais', 'Educacional', 'Campos personalizados']

interface Base {
  id: string
  label: string
  grupo: Grupo
  icon: (p: { size?: number; class?: string }) => ComponentChildren
  descricao?: string
  fixo?: boolean
  /** Some do menu quando o módulo não está ligado. */
  visivel?: (ctx: Ctx) => boolean
  limpar: Patch | ((f: F) => Patch)
}
interface Multi extends Base {
  tipo: 'multi'
  opcoes: keyof LeadFilterOptions | ((o: LeadFilterOptions) => LeadFilterOption[])
  ler: (f: F) => string[]
  gravar: (vals: string[], f: F) => Patch
  rotulo?: (o: LeadFilterOption) => string
  filtrarOpcoes?: (ops: LeadFilterOption[], f: F) => LeadFilterOption[]
  /** Modo das etiquetas (qualquer / todas / não tem). */
  modos?: { ler: (f: F) => string; opcoes: { id: string; label: string }[]; gravar: (modo: string, vals: string[], f: F) => Patch }
}
interface Opcao { label: string; hint?: string | undefined; patch: Patch; ativo: (f: F) => boolean }
interface Escolha extends Base {
  tipo: 'escolha'
  secoes: { titulo?: string; opcoes: Opcao[] }[]
}
interface Data extends Base {
  tipo: 'data'
  de: keyof F
  ate: keyof F
}
interface Etapa extends Base { tipo: 'etapa' }
type Def = Multi | Escolha | Data | Etapa

interface Ctx { edu: boolean; contexto: 'leads' | 'kanban'; temEdu: boolean }

const limparDe = (def: Def, f: F): Patch => (typeof def.limpar === 'function' ? def.limpar(f) : def.limpar)
function opcoesDe(def: Multi, o?: LeadFilterOptions): LeadFilterOption[] {
  if (!o) return []
  if (typeof def.opcoes === 'function') return def.opcoes(o)
  return (o[def.opcoes] as LeadFilterOption[] | undefined) ?? []
}
/** No Kanban o quadro já é de um funil e as colunas são as etapas. */
const SO_NA_LISTA = new Set(['funil', 'etapa', 'entradaEtapa'])

const numeros = (v: string[]) => v.map(Number).filter(Number.isInteger)
const lista = <T,>(v: T[] | undefined) => (v && v.length ? v : undefined)

function multiTexto(chave: keyof F, legado?: keyof F): Pick<Multi, 'ler' | 'gravar'> {
  return {
    ler: (f) => (f[chave] as string[] | undefined) ?? (legado && f[legado] ? [String(f[legado])] : []),
    gravar: (v) => ({ [chave]: lista(v), ...(legado ? { [legado]: undefined } : {}) }) as Patch,
  }
}
function multiNumero(chave: keyof F, legado?: keyof F): Pick<Multi, 'ler' | 'gravar'> {
  return {
    ler: (f) => ((f[chave] as number[] | undefined) ?? (legado && f[legado] != null ? [Number(f[legado])] : [])).map(String),
    gravar: (v) => ({ [chave]: lista(numeros(v)), ...(legado ? { [legado]: undefined } : {}) }) as Patch,
  }
}
function opc(label: string, patch: Patch, hint?: string): Opcao {
  const chaves = Object.keys(patch) as (keyof F)[]
  return { label, hint, patch, ativo: (f) => chaves.every((k) => f[k] === patch[k]) }
}

const DEFS: Def[] = [
  // Pessoas
  {
    id: 'responsavel', label: 'Responsável', grupo: 'Pessoas', icon: UserCheck, fixo: true, tipo: 'multi', opcoes: 'agents',
    ler: (f) => [...(f.assignedUserIds ?? []).map(String), ...(f.onlyUnassigned ? ['__none'] : [])],
    gravar: (v) => {
      const ids = numeros(v.filter((x) => x !== '__none'))
      return { assignedUserIds: lista(ids), onlyUnassigned: v.includes('__none') ? true : undefined, assignedUserId: undefined }
    },
    limpar: { assignedUserIds: undefined, onlyUnassigned: undefined, assignedUserId: undefined },
  },
  {
    id: 'equipe', label: 'Equipe', grupo: 'Pessoas', icon: Users2, tipo: 'multi', opcoes: 'teams',
    descricao: 'Setor que cuida do lead', ...multiNumero('teamIds'), limpar: { teamIds: undefined },
    gravar: (v) => ({ teamIds: lista(v.map(Number).filter((n) => Number.isInteger(n))) }),
  },
  // Funil e resultado
  {
    id: 'funil', label: 'Funil', grupo: 'Funil e resultado', icon: KanbanSquare, fixo: true, tipo: 'multi', opcoes: 'funnels',
    ...multiNumero('funnelIds', 'funnelId'), limpar: { funnelIds: undefined, funnelId: undefined },
    gravar: (v) => ({ funnelIds: lista(v.map(Number).filter((n) => Number.isInteger(n))), funnelId: undefined }),
  },
  {
    id: 'etapa', label: 'Etapa', grupo: 'Funil e resultado', icon: Layers, fixo: true, tipo: 'multi', opcoes: 'stages',
    ler: (f) => f.statuses ?? (f.status ? [f.status] : []),
    gravar: (v) => ({ statuses: lista(v), status: undefined }),
    filtrarOpcoes: (ops, f) => {
      const funis = f.funnelIds ?? (f.funnelId != null ? [f.funnelId] : [])
      return funis.length ? ops.filter((o) => funis.includes(Number(o.value.split('::')[0]))) : ops
    },
    limpar: { statuses: undefined, status: undefined },
  },
  {
    id: 'resultado', label: 'Resultado', grupo: 'Funil e resultado', icon: Trophy, tipo: 'escolha',
    secoes: [{ opcoes: [
      opc('Em andamento', { outcome: 'open' }, 'Sem ganho nem perda'),
      opc('Ganhos', { outcome: 'won' }),
      opc('Perdidos', { outcome: 'lost' }),
      opc('Ganhos ou perdidos', { outcome: 'classified' }),
    ] }],
    limpar: { outcome: undefined },
  },
  {
    id: 'motivo', label: 'Motivo da perda', grupo: 'Funil e resultado', icon: XCircle, tipo: 'multi', opcoes: 'lossReasons',
    ...multiNumero('lossReasonIds'), limpar: { lossReasonIds: undefined },
  },
  {
    id: 'resumo', label: 'Resumo', grupo: 'Funil e resultado', icon: ClipboardList, tipo: 'multi', opcoes: 'statusSummaries',
    descricao: 'Código de situação do lead', ...multiNumero('statusSummaryIds'), limpar: { statusSummaryIds: undefined },
    gravar: (v) => ({ statusSummaryIds: lista(v.map(Number).filter((n) => Number.isInteger(n))) }),
  },
  // Atendimento
  {
    id: 'atendimento', label: 'Atendimento', grupo: 'Atendimento', icon: MessageCircle, tipo: 'escolha',
    descricao: 'Mensagens sem resposta, sem 1º contato',
    secoes: [{ opcoes: [
      opc('Aguardando resposta', { awaitingReply: true, neverAnswered: undefined }, 'Tem mensagem do lead não lida'),
      opc('Nunca respondido', { neverAnswered: true, awaitingReply: undefined }, 'A equipe ainda não respondeu'),
    ] }],
    limpar: { awaitingReply: undefined, neverAnswered: undefined },
  },
  {
    id: 'parado', label: 'Sem conversa há', grupo: 'Atendimento', icon: Clock, tipo: 'escolha',
    descricao: 'Última mensagem antiga',
    secoes: [{ opcoes: [1, 3, 7, 15, 30, 60, 90].map((n) => opc(`${n}+ ${n === 1 ? 'dia' : 'dias'}`, { idleDays: n })) }],
    limpar: { idleDays: undefined },
  },
  {
    id: 'atividades', label: 'Atividades', grupo: 'Atendimento', icon: ListTodo, tipo: 'escolha',
    secoes: [{ opcoes: [
      opc('Atrasadas', { activity: 'overdue' }, 'Tem atividade vencida em aberto'),
      opc('Para hoje', { activity: 'today' }),
      opc('Agendadas', { activity: 'upcoming' }, 'Tem próxima atividade marcada'),
      opc('Sem próxima atividade', { activity: 'none' }, 'Nada em aberto: lead pode esfriar'),
    ] }],
    limpar: { activity: undefined },
  },
  {
    id: 'canal', label: 'Número / canal', grupo: 'Atendimento', icon: Smartphone, tipo: 'multi', opcoes: 'channels',
    descricao: 'Conexão de WhatsApp que recebeu o lead', ...multiTexto('channels'), limpar: { channels: undefined },
  },
  // Origem e campanha
  {
    id: 'origem', label: 'Origem', grupo: 'Origem e campanha', icon: Target, fixo: true, tipo: 'multi', opcoes: 'sources',
    ...multiTexto('sources', 'source'), rotulo: (o) => (o.value === '__none' ? 'Sem origem' : leadSourceLabel(o.value)),
    limpar: { sources: undefined, source: undefined },
  },
  {
    id: 'tipoOrigem', label: 'Tipo de origem', grupo: 'Origem e campanha', icon: Zap, tipo: 'multi', opcoes: 'originTypes',
    descricao: 'Anúncio, link rastreável, orgânico…', ...multiTexto('originTypes'),
    rotulo: (o) => ORIGIN_LABELS[o.value] ?? o.label, limpar: { originTypes: undefined },
  },
  {
    id: 'campanha', label: 'Campanha', grupo: 'Origem e campanha', icon: Megaphone, tipo: 'multi', opcoes: 'campaigns',
    descricao: 'Meta, Google e utm_campaign', ...multiTexto('campaigns'), limpar: { campaigns: undefined },
  },
  {
    id: 'anuncio', label: 'Anúncio', grupo: 'Origem e campanha', icon: Flag, tipo: 'multi', opcoes: 'adNames',
    ...multiTexto('adNames'), limpar: { adNames: undefined },
  },
  {
    id: 'utmSource', label: 'utm_source', grupo: 'Origem e campanha', icon: Link2, tipo: 'multi', opcoes: 'utmSources',
    ...multiTexto('utmSources'), limpar: { utmSources: undefined },
  },
  {
    id: 'utmMedium', label: 'utm_medium', grupo: 'Origem e campanha', icon: Link2, tipo: 'multi', opcoes: 'utmMediums',
    ...multiTexto('utmMediums'), limpar: { utmMediums: undefined },
  },
  // Datas
  { id: 'entrada', label: 'Entrada como lead', grupo: 'Datas', icon: Calendar, fixo: true, tipo: 'data', de: 'dateFrom', ate: 'dateTo', limpar: { dateFrom: undefined, dateTo: undefined } },
  { id: 'cadastro', label: 'Cadastro', grupo: 'Datas', icon: CalendarClock, tipo: 'data', de: 'createdFrom', ate: 'createdTo', descricao: 'Primeiro contato com o sistema', limpar: { createdFrom: undefined, createdTo: undefined } },
  { id: 'ultimaMsg', label: 'Última mensagem', grupo: 'Datas', icon: MessageCircle, tipo: 'data', de: 'lastMessageFrom', ate: 'lastMessageTo', limpar: { lastMessageFrom: undefined, lastMessageTo: undefined } },
  { id: 'dataResultado', label: 'Data do ganho/perda', grupo: 'Datas', icon: CalendarCheck, tipo: 'data', de: 'outcomeFrom', ate: 'outcomeTo', limpar: { outcomeFrom: undefined, outcomeTo: undefined } },
  { id: 'atribuicao', label: 'Atribuição', grupo: 'Datas', icon: UserCheck, tipo: 'data', de: 'assignedFrom', ate: 'assignedTo', descricao: 'Quando ganhou o responsável atual', limpar: { assignedFrom: undefined, assignedTo: undefined } },
  { id: 'entradaEtapa', label: 'Entrada na etapa', grupo: 'Datas', icon: Layers, tipo: 'etapa', descricao: 'Quem entrou numa etapa no período', limpar: { stageKey: undefined, stageEnteredFrom: undefined, stageEnteredTo: undefined } },
  // Perfil
  {
    id: 'etiquetas', label: 'Etiquetas', grupo: 'Perfil do lead', icon: TagIcon, fixo: true, tipo: 'multi', opcoes: 'tags',
    ler: (f) => [...(f.excludeTagIds?.length ? f.excludeTagIds : f.tagIds ?? []).map(String), ...(f.noTags ? ['__none'] : [])],
    gravar: (v, f) => {
      const ids = lista(numeros(v.filter((x) => x !== '__none')))
      const nenhuma = v.includes('__none') ? true : undefined
      return f.excludeTagIds?.length ? { excludeTagIds: ids, tagIds: undefined, noTags: nenhuma } : { tagIds: ids, excludeTagIds: undefined, noTags: nenhuma }
    },
    modos: {
      ler: (f) => (f.excludeTagIds?.length ? 'none' : f.tagMode === 'all' ? 'all' : 'any'),
      opcoes: [{ id: 'any', label: 'Qualquer uma' }, { id: 'all', label: 'Todas' }, { id: 'none', label: 'Não tem' }],
      gravar: (modo, vals) => {
        const ids = lista(numeros(vals.filter((x) => x !== '__none')))
        if (modo === 'none') return { excludeTagIds: ids, tagIds: undefined, tagMode: undefined }
        return { tagIds: ids, excludeTagIds: undefined, tagMode: modo === 'all' ? 'all' : undefined }
      },
    },
    limpar: { tagIds: undefined, excludeTagIds: undefined, noTags: undefined, tagMode: undefined },
  },
  {
    id: 'cidade', label: 'Cidade', grupo: 'Perfil do lead', icon: MapPin, tipo: 'multi', opcoes: 'cidades',
    ...multiTexto('cidades'), limpar: { cidades: undefined },
  },
  {
    id: 'segmento', label: 'Segmento', grupo: 'Perfil do lead', icon: Briefcase, tipo: 'multi', opcoes: 'segmentos',
    ...multiTexto('segmentos'), limpar: { segmentos: undefined },
  },
  {
    id: 'contato', label: 'Dados de contato', grupo: 'Perfil do lead', icon: Phone, tipo: 'escolha',
    descricao: 'Com ou sem e-mail e WhatsApp',
    secoes: [
      { titulo: 'E-mail', opcoes: [opc('Com e-mail', { hasEmail: 'yes' }), opc('Sem e-mail', { hasEmail: 'no' })] },
      { titulo: 'WhatsApp', opcoes: [opc('Com WhatsApp', { hasWhatsapp: 'yes' }), opc('Sem WhatsApp', { hasWhatsapp: 'no' })] },
    ],
    limpar: { hasEmail: undefined, hasWhatsapp: undefined },
  },
  {
    id: 'inscricao', label: 'Inscrição no portal', grupo: 'Educacional', icon: GraduationCap, tipo: 'escolha',
    visivel: (c) => c.edu,
    secoes: [{ opcoes: [opc('Tem inscrição', { registration: 'yes' }), opc('Sem inscrição', { registration: 'no' })] }],
    limpar: { registration: undefined },
  },
  // Qualidade e sinais
  {
    id: 'score', label: 'Score IA', grupo: 'Qualidade e sinais', icon: Sparkles, tipo: 'multi', opcoes: 'aiScores',
    ...multiTexto('aiScoreLabels', 'aiScoreLabel'), rotulo: (o) => SCORE_LABELS[o.value] ?? o.label,
    limpar: { aiScoreLabels: undefined, aiScoreLabel: undefined },
  },
  {
    id: 'sinais', label: 'Sinais', grupo: 'Qualidade e sinais', icon: AlertTriangle, tipo: 'escolha',
    descricao: 'Duplicado, venda detectada, clique de anúncio',
    secoes: [
      { titulo: 'Rastreio', opcoes: [opc('Com ID de clique de anúncio', { hasClickId: true }, 'gclid, fbclid ou ctwa_clid')] },
      { titulo: 'Conversa', opcoes: [opc('Venda detectada pela IA', { saleDetected: true })] },
      { titulo: 'Cadastro', opcoes: [opc('Possível duplicado', { duplicate: true }, 'Aguardando revisão em Duplicados')] },
      { titulo: 'Abrangência', opcoes: [opc('Incluir contatos não qualificados', { includeUnqualified: true }, 'Também quem só conversou, sem virar lead')] },
    ],
    limpar: { hasClickId: undefined, saleDetected: undefined, duplicate: undefined, includeUnqualified: undefined },
  },
  // Educacional (portal, curso e situação valem para a MESMA inscrição)
  {
    id: 'eduPortal', label: 'Portal', grupo: 'Educacional', icon: School, tipo: 'multi', opcoes: (o) => o.edu?.portals ?? [],
    descricao: 'Portal da inscrição', visivel: (c) => c.temEdu, ...multiNumero('eduPortalIds'), limpar: { eduPortalIds: undefined },
  },
  {
    id: 'eduCurso', label: 'Curso', grupo: 'Educacional', icon: BookOpen, tipo: 'multi', opcoes: (o) => o.edu?.courses ?? [],
    descricao: 'Curso da inscrição', visivel: (c) => c.temEdu, ...multiNumero('eduCourseIds'), limpar: { eduCourseIds: undefined },
  },
  {
    id: 'eduProcesso', label: 'Processo seletivo', grupo: 'Educacional', icon: ListChecks, tipo: 'multi', opcoes: (o) => o.edu?.processes ?? [],
    visivel: (c) => c.temEdu, ...multiNumero('eduProcessIds'), limpar: { eduProcessIds: undefined },
  },
  {
    id: 'eduSituacao', label: 'Situação da inscrição', grupo: 'Educacional', icon: ClipboardList, tipo: 'multi', opcoes: (o) => o.edu?.statuses ?? [],
    descricao: 'Aguardando pagamento, paga, matriculada…', visivel: (c) => c.temEdu, ...multiTexto('eduStatuses'),
    rotulo: (o) => STATUS_INSCRICAO[o.value] ?? o.label, limpar: { eduStatuses: undefined },
  },
  {
    id: 'eduPagamento', label: 'Pagamento da inscrição', grupo: 'Educacional', icon: Banknote, tipo: 'multi', opcoes: (o) => o.edu?.payments ?? [],
    descricao: 'Paga, pendente, vencida…', visivel: (c) => c.temEdu, ...multiTexto('eduPayments'),
    rotulo: (o) => (o.value === '__none' ? 'Sem cobrança' : PAGAMENTO[o.value] ?? o.label), limpar: { eduPayments: undefined },
  },
  {
    id: 'eduContrato', label: 'Contrato', grupo: 'Educacional', icon: FileCheck2, tipo: 'escolha', visivel: (c) => c.temEdu,
    secoes: [{ opcoes: [opc('Contrato aceito', { eduContract: 'yes' }), opc('Contrato não aceito', { eduContract: 'no' })] }],
    limpar: { eduContract: undefined },
  },
  {
    id: 'eduMatricula', label: 'Matrícula (aluno)', grupo: 'Educacional', icon: BadgeCheck, tipo: 'multi', opcoes: (o) => o.edu?.situacoes ?? [],
    descricao: 'Situação do vínculo: ativo, trancado, formado…', visivel: (c) => c.temEdu, ...multiTexto('eduSituacoes'),
    rotulo: (o) => SITUACAO_MATRICULA[o.value] ?? o.label, limpar: { eduSituacoes: undefined },
  },
  {
    id: 'eduMatriculado', label: 'Virou aluno', grupo: 'Educacional', icon: GraduationCap, tipo: 'escolha', visivel: (c) => c.temEdu,
    secoes: [{ opcoes: [opc('Já é aluno (tem matrícula)', { eduEnrolled: 'yes' }), opc('Ainda não é aluno', { eduEnrolled: 'no' })] }],
    limpar: { eduEnrolled: undefined },
  },
]

/** Um filtro por campo personalizado ativo (grupo no fim do "+ Filtro"). */
function defsDosCampos(o?: LeadFilterOptions): Def[] {
  return (o?.customFields ?? []).map((c): Multi => ({
    id: `cf:${c.key}`, label: c.label, grupo: 'Campos personalizados', icon: FormInput, tipo: 'multi',
    descricao: c.group ? `Campo personalizado · ${c.group}` : 'Campo personalizado',
    opcoes: () => c.values,
    ler: (f) => f.customFieldFilters?.[c.key] ?? [],
    gravar: (v, f) => {
      const resto = { ...(f.customFieldFilters ?? {}) }
      if (v.length) resto[c.key] = v
      else delete resto[c.key]
      return { customFieldFilters: Object.keys(resto).length ? resto : undefined }
    },
    limpar: (f) => {
      const resto = { ...(f.customFieldFilters ?? {}) }
      delete resto[c.key]
      return { customFieldFilters: Object.keys(resto).length ? resto : undefined }
    },
  }))
}

function ativo(def: Def, f: F): boolean {
  switch (def.tipo) {
    case 'multi': return def.ler(f).length > 0
    case 'escolha': return def.secoes.some((s) => s.opcoes.some((o) => o.ativo(f)))
    case 'data': return !!(f[def.de] || f[def.ate])
    case 'etapa': return !!(f.stageKey || f.stageEnteredFrom || f.stageEnteredTo)
  }
}

/** Quantos filtros estão ligados (busca e visões rápidas incluídas). */
export function contarFiltrosAtivos(f: F): number {
  const campos = Object.values(f.customFieldFilters ?? {}).filter((v) => v && v.length).length
  return DEFS.filter((d) => ativo(d, f)).length + campos + (f.search ? 1 : 0) + (f.assignedUserId === 'me' ? 1 : 0)
}

// ─── Visões rápidas ────────────────────────────────────────────────────

interface Visao { id: string; label: string; icon: Def['icon']; patch: Patch; ativo: (f: F) => boolean }
const LIMPA_VISOES: Patch = { assignedUserId: undefined, onlyUnassigned: undefined, awaitingReply: undefined, activity: undefined, idleDays: undefined, aiScoreLabels: undefined, aiScoreLabel: undefined }
const VISOES: Visao[] = [
  { id: 'meus', label: 'Meus leads', icon: UserCheck, patch: { assignedUserId: 'me', assignedUserIds: undefined }, ativo: (f) => f.assignedUserId === 'me' },
  { id: 'semdono', label: 'Sem responsável', icon: Inbox, patch: { onlyUnassigned: true, assignedUserIds: undefined }, ativo: (f) => !!f.onlyUnassigned && !f.assignedUserIds?.length },
  { id: 'aguardando', label: 'Aguardando resposta', icon: MessageCircle, patch: { awaitingReply: true }, ativo: (f) => !!f.awaitingReply },
  { id: 'atrasadas', label: 'Atividade atrasada', icon: AlertTriangle, patch: { activity: 'overdue' }, ativo: (f) => f.activity === 'overdue' },
  { id: 'parados', label: 'Parados 7+ dias', icon: Clock, patch: { idleDays: 7 }, ativo: (f) => f.idleDays === 7 },
  { id: 'quentes', label: 'Quentes', icon: Flame, patch: { aiScoreLabels: ['hot'], aiScoreLabel: undefined }, ativo: (f) => f.aiScoreLabels?.length === 1 && f.aiScoreLabels[0] === 'hot' },
]

// ─── Componente ────────────────────────────────────────────────────────

const ORDENS: { id: string; label: string; sortBy: NonNullable<F['sortBy']>; sortDir: 'asc' | 'desc' }[] = [
  { id: 'recentes', label: 'Mais recentes', sortBy: 'createdAt', sortDir: 'desc' },
  { id: 'antigos', label: 'Mais antigos', sortBy: 'createdAt', sortDir: 'asc' },
  { id: 'ultimaMsg', label: 'Última mensagem', sortBy: 'lastMessageAt', sortDir: 'desc' },
  { id: 'score', label: 'Maior score IA', sortBy: 'aiScore', sortDir: 'desc' },
  { id: 'nome', label: 'Nome (A–Z)', sortBy: 'nome', sortDir: 'asc' },
  { id: 'resultado', label: 'Ganho/perda mais recente', sortBy: 'outcomeAt', sortDir: 'desc' },
]

export function LeadsFilterBar({
  filters, onChange, onClearAll, total, salvos, busca, contexto = 'leads', extra,
}: {
  filters: F
  onChange: (p: Patch) => void
  onClearAll: () => void
  total?: number | undefined
  /** Barra de filtros salvos (vai à direita da linha de filtros). */
  salvos?: ComponentChildren
  /** Campo de busca (fica no começo da 1ª linha). */
  busca?: ComponentChildren
  /** 'kanban' esconde Funil/Etapa/Entrada na etapa e o Ordenar (o quadro tem os seus). */
  contexto?: 'leads' | 'kanban'
  /** Algo a mais no fim da 1ª linha (ex.: indicador de atualização do quadro). */
  extra?: ComponentChildren
}) {
  const { data: opcoes, isLoading } = useLeadFilterOptions()
  const edu = useEducacionalLigado()
  const ctx: Ctx = { edu, contexto, temEdu: edu && !!opcoes?.edu }
  const [aberto, setAberto] = useState<string | null>(null)
  const [extras, setExtras] = useState<string[]>([])

  const defs = [...DEFS, ...defsDosCampos(opcoes)]
    .filter((d) => !d.visivel || d.visivel(ctx))
    .filter((d) => contexto === 'leads' || !SO_NA_LISTA.has(d.id))
  const mostrados = defs.filter((d) => d.fixo || ativo(d, filters) || extras.includes(d.id))
  const escondidos = defs.filter((d) => !mostrados.includes(d))
  const nAtivos = contarFiltrosAtivos(filters)

  function fechar(id: string) {
    setAberto((a) => (a === id ? null : a))
    // Filtro extra que fechou vazio sai da barra (não fica botão morto).
    const def = defs.find((d) => d.id === id)
    if (def && !def.fixo && !ativo(def, filters)) setExtras((x) => x.filter((i) => i !== id))
  }

  function adicionar(id: string) {
    setExtras((x) => (x.includes(id) ? x : [...x, id]))
    // Abre depois que o menu "+ Filtro" fechar, senão o foco volta para ele.
    setTimeout(() => setAberto(id), 30)
  }

  const ordemAtual = ORDENS.find((o) => o.sortBy === (filters.sortBy ?? 'createdAt') && o.sortDir === (filters.sortDir ?? 'desc'))

  return (
    <div class="flex flex-col gap-2.5">
      {/* 1ª linha: busca à esquerda; ordenação e filtros salvos à direita */}
      <div class="flex flex-wrap items-center gap-2 min-w-0">
        <div class="min-w-0 flex-1 basis-64 max-w-xl">{busca}</div>
        <div class="ml-auto flex flex-wrap items-center gap-1.5">
          {contexto === 'leads' && <OrdenarMenu atual={ordemAtual?.label ?? 'Personalizada'} onEscolher={(o) => onChange({ sortBy: o.sortBy, sortDir: o.sortDir })} />}
          {salvos}
          {extra}
        </div>
      </div>

      {/* 2ª linha: visões rápidas, as perguntas que o time faz todo dia */}
      <div class="flex items-center gap-2 min-w-0">
        <div class="flex min-w-0 max-w-full items-center gap-1 overflow-x-auto rounded-lg bg-surface-3 p-0.5 [scrollbar-width:none]" role="group" aria-label="Visões rápidas">
          <button
            type="button"
            onClick={() => onChange(LIMPA_VISOES)}
            aria-pressed={!VISOES.some((v) => v.ativo(filters))}
            class={cn('h-7 shrink-0 whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-colors',
              !VISOES.some((v) => v.ativo(filters)) ? 'bg-surface-2 text-fg surface-raised' : 'text-fg-muted hover:text-fg')}
          >
            Todos
          </button>
          {VISOES.map((v) => {
            const on = v.ativo(filters)
            const Icon = v.icon
            return (
              <button
                key={v.id}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(on ? Object.fromEntries(Object.keys(v.patch).map((k) => [k, undefined])) : v.patch)}
                class={cn('inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-colors',
                  on ? 'bg-surface-2 text-accent surface-raised' : 'text-fg-muted hover:text-fg')}
              >
                <Icon size={13} />
                {v.label}
              </button>
            )
          })}
        </div>
        {total !== undefined && (
          <span class="ml-auto shrink-0 text-xs text-fg-muted">
            <strong class="text-fg tabular-nums">{total.toLocaleString('pt-BR')}</strong> {total === 1 ? 'lead' : 'leads'}
          </span>
        )}
      </div>

      {/* Linha de filtros */}
      <div class="flex flex-wrap items-center gap-1.5">
        {mostrados.map((def) => (
          <FiltroBotao
            key={def.id}
            def={def}
            filters={filters}
            opcoes={opcoes}
            carregando={isLoading}
            aberto={aberto === def.id}
            onAbrir={(v) => (v ? setAberto(def.id) : fechar(def.id))}
            onChange={onChange}
          />
        ))}

        {escondidos.length > 0 && <MenuAdicionar defs={escondidos} onEscolher={adicionar} />}

        {nAtivos > 0 && (
          <button type="button" onClick={() => { setExtras([]); onClearAll() }}
            class="h-8 px-2 text-xs font-medium text-fg-muted hover:text-danger">
            Limpar tudo
          </button>
        )}

      </div>
    </div>
  )
}

// ─── Botão de cada filtro ──────────────────────────────────────────────

function resumo(def: Def, f: F, opcoes?: LeadFilterOptions): string {
  switch (def.tipo) {
    case 'multi': {
      const sel = def.ler(f)
      if (!sel.length) return ''
      const ops = opcoesDe(def, opcoes)
      const nome = (v: string) => {
        if (v === '__none' || v === '0') return def.id === 'etiquetas' ? 'Sem etiqueta' : (ops.find((o) => o.value === v)?.label ?? 'Sem')
        const o = ops.find((x) => x.value === v || x.value.endsWith(`::${v}`))
        return o ? (def.rotulo ? def.rotulo(o) : o.label) : v
      }
      const prefixo = def.modos && def.modos.ler(f) === 'none' ? 'não tem ' : def.modos && def.modos.ler(f) === 'all' && sel.length > 1 ? 'todas: ' : ''
      return prefixo + nome(sel[0]!) + (sel.length > 1 ? ` +${sel.length - 1}` : '')
    }
    case 'escolha': {
      const on = def.secoes.flatMap((s) => s.opcoes).filter((o) => o.ativo(f))
      return on.map((o) => o.label).join(', ')
    }
    case 'data': return resumoDeData(f[def.de] as string | undefined, f[def.ate] as string | undefined)
    case 'etapa': {
      const op = opcoes?.stages.find((o) => o.value.endsWith(`::${f.stageKey}`))
      const per = resumoDeData(f.stageEnteredFrom, f.stageEnteredTo)
      return [op?.label ?? f.stageKey, per].filter(Boolean).join(' · ')
    }
  }
}

function FiltroBotao({
  def, filters, opcoes, carregando, aberto, onAbrir, onChange,
}: {
  def: Def; filters: F; opcoes?: LeadFilterOptions | undefined; carregando: boolean
  aberto: boolean; onAbrir: (v: boolean) => void; onChange: (p: Patch) => void
}) {
  const on = ativo(def, filters)
  const texto = on ? resumo(def, filters, opcoes) : ''
  const Icon = def.icon
  return (
    <Popover.Root open={aberto} onOpenChange={onAbrir}>
      <div class={cn(
        'inline-flex h-8 items-center rounded-md border text-xs font-medium transition-colors',
        on ? 'border-accent/60 bg-accent/10 text-fg' : 'border-border border-dashed bg-surface-2 text-fg-muted hover:text-fg hover:border-fg-muted/60',
        aberto && !on && 'border-solid border-fg-muted/60 text-fg',
      )}>
        <Popover.Trigger asChild>
          <button type="button" class="inline-flex h-full max-w-[18rem] items-center gap-1.5 pl-2.5 pr-2 min-w-0" aria-label={`Filtro ${def.label}`}>
            <Icon size={13} class={on ? 'text-accent shrink-0' : 'shrink-0'} />
            <span class="shrink-0">{def.label}</span>
            {on && texto && (
              <>
                <span class="h-3.5 w-px bg-accent/30 shrink-0" />
                <span class="truncate font-semibold text-accent">{texto}</span>
              </>
            )}
            {!on && <ChevronDown size={12} class="shrink-0 opacity-70" />}
          </button>
        </Popover.Trigger>
        {on && (
          <button type="button" onClick={() => onChange(limparDe(def, filters))} aria-label={`Limpar ${def.label}`}
            class="grid h-full w-7 place-items-center rounded-r-md text-fg-muted hover:text-danger hover:bg-danger/10">
            <X size={12} />
          </button>
        )}
      </div>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          class="w-[19rem] max-w-[calc(100vw-2rem)] rounded-panel bg-surface-2 border border-border shadow-xl surface-raised overflow-hidden"
          style={{ zIndex: 'var(--z-popover)' }}
          onOpenAutoFocus={(e: Event) => { if (def.tipo !== 'multi') e.preventDefault() }}
        >
          <div class="flex items-center gap-2 border-b border-border px-3 py-2">
            <Icon size={14} class="text-fg-muted" />
            <span class="text-xs font-semibold text-fg">{def.label}</span>
            {def.descricao && <span class="truncate text-2xs text-fg-muted">· {def.descricao}</span>}
          </div>
          {def.tipo === 'multi' && <PainelMulti def={def} filters={filters} opcoes={opcoes} carregando={carregando} onChange={onChange} onFechar={() => onAbrir(false)} />}
          {def.tipo === 'escolha' && <PainelEscolha def={def} filters={filters} onChange={onChange} />}
          {def.tipo === 'data' && <PainelData de={(filters[def.de] as string) ?? ''} ate={(filters[def.ate] as string) ?? ''} onChange={(a, b) => onChange({ [def.de]: a || undefined, [def.ate]: b || undefined } as Patch)} />}
          {def.tipo === 'etapa' && <PainelEtapa filters={filters} opcoes={opcoes} onChange={onChange} />}
          {on && (
            <div class="flex justify-between border-t border-border px-3 py-2">
              <button type="button" class="text-xs text-fg-muted hover:text-danger" onClick={() => onChange(limparDe(def, filters))}>Limpar</button>
              <button type="button" class="text-xs font-semibold text-accent hover:underline" onClick={() => onAbrir(false)}>Concluir</button>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function Caixa({ marcado }: { marcado: boolean }) {
  return (
    <span class={cn('grid size-4 shrink-0 place-items-center rounded border transition-colors',
      marcado ? 'border-accent bg-accent text-fg-on-brand' : 'border-border bg-surface-inset')}>
      {marcado && <Check size={11} />}
    </span>
  )
}

function Radio({ marcado }: { marcado: boolean }) {
  return (
    <span class={cn('grid size-4 shrink-0 place-items-center rounded-full border transition-colors',
      marcado ? 'border-accent' : 'border-border bg-surface-inset')}>
      {marcado && <span class="size-2 rounded-full bg-accent" />}
    </span>
  )
}

function PainelMulti({
  def, filters, opcoes, carregando, onChange, onFechar,
}: {
  def: Multi; filters: F; opcoes?: LeadFilterOptions | undefined; carregando: boolean
  onChange: (p: Patch) => void; onFechar: () => void
}) {
  const [busca, setBusca] = useState('')
  const [ativoIdx, setAtivoIdx] = useState(0)
  const listaRef = useRef<HTMLDivElement>(null)
  const sel = def.ler(filters)
  // Etapa legada vem só com a chave ("NOVO"); casa com "funil::NOVO".
  const marcado = (v: string) => sel.includes(v) || (v.includes('::') && sel.includes(v.split('::')[1]!))

  let todas = opcoesDe(def, opcoes)
  if (def.filtrarOpcoes) todas = def.filtrarOpcoes(todas, filters)
  if (def.id === 'etiquetas' && !todas.some((o) => o.value === '__none')) {
    todas = [{ value: '__none', label: 'Sem nenhuma etiqueta', count: 0 }, ...todas]
  }
  const rot = (o: LeadFilterOption) => (def.rotulo ? def.rotulo(o) : o.label)
  const termo = busca.trim().toLocaleLowerCase('pt-BR')
  const visiveis = useMemo(
    () => (termo ? todas.filter((o) => `${rot(o)} ${o.group ?? ''}`.toLocaleLowerCase('pt-BR').includes(termo)) : todas),
    [todas, termo],
  )
  useEffect(() => setAtivoIdx(0), [termo])

  function alternar(v: string) {
    const atual = sel.filter((x) => !(v.includes('::') && x === v.split('::')[1]))
    const novo = atual.includes(v) ? atual.filter((x) => x !== v) : [...atual, v]
    onChange(def.gravar(novo, filters))
  }

  function teclas(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAtivoIdx((i) => Math.min(i + 1, visiveis.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAtivoIdx((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); const o = visiveis[ativoIdx]; if (o) alternar(o.value) }
    else if (e.key === 'Escape') onFechar()
  }
  useEffect(() => {
    listaRef.current?.querySelector<HTMLElement>(`[data-idx="${ativoIdx}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [ativoIdx])

  let grupoAnterior: string | undefined
  return (
    <div>
      {def.modos && (
        <div class="flex gap-1 border-b border-border p-2">
          {def.modos.opcoes.map((m) => (
            <button key={m.id} type="button" onClick={() => onChange(def.modos!.gravar(m.id, sel, filters))}
              class={cn('h-6 flex-1 rounded text-2xs font-medium transition-colors',
                def.modos!.ler(filters) === m.id ? 'bg-accent/15 text-accent' : 'text-fg-muted hover:bg-surface-3 hover:text-fg')}>
              {m.label}
            </button>
          ))}
        </div>
      )}
      <div class="relative border-b border-border">
        <Search size={13} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
        <input
          type="text"
          value={busca}
          onInput={(e) => setBusca((e.target as HTMLInputElement).value)}
          onKeyDown={teclas}
          placeholder={`Buscar ${def.label.toLocaleLowerCase('pt-BR')}…`}
          class="h-9 w-full bg-transparent pl-8 pr-3 text-xs text-fg placeholder:text-fg-muted focus:outline-none"
          autoFocus
        />
      </div>
      <div ref={listaRef} class="max-h-[18rem] overflow-y-auto p-1" role="listbox" aria-multiselectable="true">
        {carregando && <div class="px-3 py-6 text-center text-xs text-fg-muted">Carregando opções…</div>}
        {!carregando && visiveis.length === 0 && (
          <div class="px-3 py-6 text-center text-xs text-fg-muted">{termo ? 'Nada encontrado com esse termo.' : 'Nenhum lead com este dado ainda.'}</div>
        )}
        {visiveis.map((o, i) => {
          const cabecalho = o.group && o.group !== grupoAnterior ? o.group : null
          grupoAnterior = o.group
          const m = marcado(o.value)
          const cor = def.id === 'score' ? SCORE_COLORS[o.value] : o.color
          return (
            <div key={o.value}>
              {cabecalho && <div class="px-2 pb-1 pt-2 text-3xs font-semibold uppercase tracking-wider text-fg-muted">{cabecalho}</div>}
              <button
                type="button"
                role="option"
                aria-selected={m}
                data-idx={i}
                onClick={() => alternar(o.value)}
                onMouseEnter={() => setAtivoIdx(i)}
                class={cn('flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-xs',
                  i === ativoIdx ? 'bg-surface-3' : '', m ? 'text-fg' : 'text-fg-muted')}
              >
                <Caixa marcado={m} />
                {cor && <span class="size-2 shrink-0 rounded-full" style={{ background: cor }} />}
                <span class={cn('min-w-0 flex-1 truncate', m && 'font-medium', (o.value === '__none' || o.value === '0') && 'italic')}>{rot(o)}</span>
                {o.count > 0 && <span class="shrink-0 tabular-nums text-2xs text-fg-muted">{o.count.toLocaleString('pt-BR')}</span>}
              </button>
            </div>
          )
        })}
      </div>
      {sel.length === 0 && visiveis.length > 0 && (
        <div class="border-t border-border px-3 py-1.5 text-3xs text-fg-muted">↑↓ para navegar · Enter marca · números = leads</div>
      )}
    </div>
  )
}

function PainelEscolha({ def, filters, onChange }: { def: Escolha; filters: F; onChange: (p: Patch) => void }) {
  return (
    <div class="p-1">
      {def.secoes.map((s, si) => {
        const limparSecao = Object.fromEntries(s.opcoes.flatMap((o) => Object.keys(o.patch)).map((k) => [k, undefined])) as Patch
        return (
          <div key={si} class={cn(si > 0 && 'mt-1 border-t border-border pt-1')}>
            {s.titulo && <div class="px-2 pb-0.5 pt-1.5 text-3xs font-semibold uppercase tracking-wider text-fg-muted">{s.titulo}</div>}
            {s.opcoes.map((o) => {
              const m = o.ativo(filters)
              const unica = s.opcoes.length === 1
              return (
                <button key={o.label} type="button" onClick={() => onChange(m ? limparSecao : { ...limparSecao, ...o.patch })}
                  class="flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-3">
                  <span class="mt-px">{unica ? <Caixa marcado={m} /> : <Radio marcado={m} />}</span>
                  <span class="min-w-0 flex-1">
                    <span class={cn('block text-xs', m ? 'font-medium text-fg' : 'text-fg-muted')}>{o.label}</span>
                    {o.hint && <span class="block text-2xs text-fg-muted">{o.hint}</span>}
                  </span>
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

const campoData = 'h-8 w-full rounded-md border border-border bg-surface-inset surface-inset px-2 text-xs text-fg focus:outline-none focus:border-accent'

function PainelData({ de, ate, onChange }: { de: string; ate: string; onChange: (de: string, ate: string) => void }) {
  return (
    <div class="p-2">
      <div class="grid grid-cols-2 gap-1">
        {PRESETS.map((p) => {
          const [a, b] = p.range()
          const m = a === de && b === ate
          return (
            <button key={p.id} type="button" onClick={() => onChange(a, b)}
              class={cn('h-7 rounded-md px-2 text-left text-xs transition-colors',
                m ? 'bg-accent/15 font-medium text-accent' : 'text-fg-muted hover:bg-surface-3 hover:text-fg')}>
              {p.label}
            </button>
          )
        })}
      </div>
      <div class="mt-2 border-t border-border pt-2">
        <div class="mb-1 text-3xs font-semibold uppercase tracking-wider text-fg-muted">Personalizado</div>
        <div class="flex items-center gap-1.5">
          <input type="date" class={campoData} value={de} max={ate || undefined} onInput={(e) => onChange((e.target as HTMLInputElement).value, ate)} aria-label="De" />
          <span class="text-2xs text-fg-muted">até</span>
          <input type="date" class={campoData} value={ate} min={de || undefined} onInput={(e) => onChange(de, (e.target as HTMLInputElement).value)} aria-label="Até" />
        </div>
      </div>
    </div>
  )
}

function PainelEtapa({ filters, opcoes, onChange }: { filters: F; opcoes?: LeadFilterOptions | undefined; onChange: (p: Patch) => void }) {
  const etapas = opcoes?.stages ?? []
  return (
    <div class="p-2">
      <label class="mb-1 block text-3xs font-semibold uppercase tracking-wider text-fg-muted">Etapa</label>
      <select class={campoData} value={filters.stageKey ?? ''}
        onChange={(e) => onChange({ stageKey: (e.target as HTMLSelectElement).value || undefined })}>
        <option value="">Escolha a etapa…</option>
        {etapas.map((o) => {
          const k = o.value.split('::')[1]!
          return <option key={o.value} value={k}>{o.group ? `${o.group} › ` : ''}{o.label}</option>
        })}
      </select>
      <div class="mt-2">
        <PainelData de={filters.stageEnteredFrom ?? ''} ate={filters.stageEnteredTo ?? ''}
          onChange={(a, b) => onChange({ stageEnteredFrom: a || undefined, stageEnteredTo: b || undefined })} />
      </div>
      {!filters.stageKey && (filters.stageEnteredFrom || filters.stageEnteredTo) && (
        <p class="px-1 text-2xs text-warning">Escolha a etapa para o período valer.</p>
      )}
    </div>
  )
}

// ─── "+ Filtro" ────────────────────────────────────────────────────────

function MenuAdicionar({ defs, onEscolher }: { defs: Def[]; onEscolher: (id: string) => void }) {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState('')
  const termo = busca.trim().toLocaleLowerCase('pt-BR')
  const filtrados = defs.filter((d) => !termo || `${d.label} ${d.descricao ?? ''} ${d.grupo}`.toLocaleLowerCase('pt-BR').includes(termo))
  return (
    <Popover.Root open={aberto} onOpenChange={(v) => { setAberto(v); if (!v) setBusca('') }}>
      <Popover.Trigger asChild>
        <button type="button" class="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-xs font-medium text-accent hover:bg-accent/10">
          <Plus size={13} /> Filtro
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} collisionPadding={12}
          class="w-[20rem] max-w-[calc(100vw-2rem)] rounded-panel bg-surface-2 border border-border shadow-xl surface-raised overflow-hidden"
          style={{ zIndex: 'var(--z-popover)' }}>
          <div class="relative border-b border-border">
            <Search size={13} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input type="text" autoFocus value={busca} onInput={(e) => setBusca((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && filtrados[0]) { setAberto(false); onEscolher(filtrados[0].id) } }}
              placeholder="Filtrar por…" class="h-9 w-full bg-transparent pl-8 pr-3 text-xs text-fg placeholder:text-fg-muted focus:outline-none" />
          </div>
          <div class="max-h-[22rem] overflow-y-auto p-1">
            {ORDEM_GRUPOS.map((g) => {
              const doGrupo = filtrados.filter((d) => d.grupo === g)
              if (!doGrupo.length) return null
              return (
                <div key={g}>
                  <div class="px-2 pb-1 pt-2 text-3xs font-semibold uppercase tracking-wider text-fg-muted">{g}</div>
                  {doGrupo.map((d) => {
                    const Icon = d.icon
                    return (
                      <button key={d.id} type="button" onClick={() => { setAberto(false); onEscolher(d.id) }}
                        class="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-3">
                        <span class="grid size-6 shrink-0 place-items-center rounded-md bg-surface-3 text-fg-muted"><Icon size={13} /></span>
                        <span class="min-w-0 flex-1">
                          <span class="block text-xs font-medium text-fg">{d.label}</span>
                          {d.descricao && <span class="block truncate text-2xs text-fg-muted">{d.descricao}</span>}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )
            })}
            {filtrados.length === 0 && <div class="px-3 py-6 text-center text-xs text-fg-muted">Nenhum filtro com esse nome.</div>}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function OrdenarMenu({ atual, onEscolher }: { atual: string; onEscolher: (o: (typeof ORDENS)[number]) => void }) {
  const [aberto, setAberto] = useState(false)
  return (
    <Popover.Root open={aberto} onOpenChange={setAberto}>
      <Popover.Trigger asChild>
        <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 text-xs font-medium text-fg-muted hover:text-fg">
          <ArrowDownWideNarrow size={13} />
          <span class="hidden sm:inline">Ordenar:</span>
          <span class="text-fg">{atual}</span>
          <ChevronDown size={11} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} collisionPadding={12}
          class="w-56 rounded-panel bg-surface-2 border border-border shadow-xl surface-raised p-1"
          style={{ zIndex: 'var(--z-popover)' }}>
          {ORDENS.map((o) => (
            <button key={o.id} type="button" onClick={() => { onEscolher(o); setAberto(false) }}
              class={cn('flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-3',
                o.label === atual ? 'font-medium text-accent' : 'text-fg')}>
              {o.label}
              {o.label === atual && <Check size={12} />}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

