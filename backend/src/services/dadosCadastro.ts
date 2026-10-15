// src/services/dadosCadastro.ts
//
// QUAIS dados da pessoa são pedidos, EM QUE etapa da inscrição/matrícula, e o
// que é indispensável para matricular.
//
// Antes, o formulário do portal pedia um bloco fixo (nome, e-mail, WhatsApp,
// CPF) e o resto era campo livre sem ligação com o cadastro; na efetivação o ERP
// adivinhava pelas chaves (endereço e ENEM se perdiam) e a secretaria digitava o
// que faltasse, sem nada que impedisse matricular com ficha incompleta.
//
// Agora há um CATÁLOGO: cada dado sabe para onde vai no cadastro do aluno. A
// configuração diz, para cada dado, em que etapa pedir (ou não pedir), se é
// obrigatório ali, e se é EXIGIDO PARA MATRICULAR — esse último trava a
// efetivação enquanto faltar.
//
// Onde mora a configuração:
//   · padrão da instituição — Setting `edu.dados_etapas`;
//   · ajuste do portal — EnrollmentPortal.jornadaEtapas.dados (null = padrão).
// Sem nenhuma das duas, nada muda: o portal segue com o formulário que tem.

import { prisma } from '../lib/prisma.js'

// ─── Catálogo ─────────────────────────────────────────────────────────────

export type TipoDado = 'text' | 'email' | 'phone' | 'cpf' | 'date' | 'cep' | 'select' | 'number'

type Destino =
  | { lead: 'nome' | 'email' | 'whatsapp' }
  | { aluno: string; conv?: 'digitos' | 'data' | 'int' }
  | { json: 'enderecoJson' | 'socioEconomicoJson'; campo: string }
  | { responsavel: 'nome' | 'cpf' | 'parentesco' | 'telefone' | 'email' }

export interface DadoCatalogo {
  chave: string
  rotulo: string
  tipo: TipoDado
  grupo: string
  opcoes?: string[]
  destino: Destino
  /** Dado sem o qual não existe inscrição: sempre pedido na inscrição, obrigatório. */
  essencial?: boolean
}

const RACA_COR = ['Branca', 'Preta', 'Parda', 'Amarela', 'Indígena', 'Não declarada']
const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']

export const CATALOGO: DadoCatalogo[] = [
  // Identificação
  { chave: 'nome', rotulo: 'Nome completo', tipo: 'text', grupo: 'Identificação', destino: { lead: 'nome' }, essencial: true },
  { chave: 'email', rotulo: 'E-mail', tipo: 'email', grupo: 'Identificação', destino: { lead: 'email' }, essencial: true },
  { chave: 'whatsapp', rotulo: 'WhatsApp', tipo: 'phone', grupo: 'Identificação', destino: { lead: 'whatsapp' }, essencial: true },
  { chave: 'cpf', rotulo: 'CPF', tipo: 'cpf', grupo: 'Identificação', destino: { aluno: 'cpf', conv: 'digitos' } },
  { chave: 'nascimento', rotulo: 'Data de nascimento', tipo: 'date', grupo: 'Identificação', destino: { aluno: 'dataNascimento', conv: 'data' } },
  { chave: 'sexo', rotulo: 'Sexo', tipo: 'select', grupo: 'Identificação', opcoes: ['Feminino', 'Masculino'], destino: { aluno: 'sexo' } },
  { chave: 'nomeSocial', rotulo: 'Nome social', tipo: 'text', grupo: 'Identificação', destino: { aluno: 'nomeSocial' } },
  { chave: 'rg', rotulo: 'RG', tipo: 'text', grupo: 'Identificação', destino: { aluno: 'rg' } },
  { chave: 'rgOrgaoEmissor', rotulo: 'Órgão emissor do RG', tipo: 'text', grupo: 'Identificação', destino: { aluno: 'rgOrgaoEmissor' } },
  { chave: 'racaCor', rotulo: 'Cor/raça', tipo: 'select', grupo: 'Identificação', opcoes: RACA_COR, destino: { aluno: 'racaCor' } },
  { chave: 'estadoCivil', rotulo: 'Estado civil', tipo: 'select', grupo: 'Identificação', opcoes: ['Solteiro(a)', 'Casado(a)', 'União estável', 'Divorciado(a)', 'Viúvo(a)'], destino: { aluno: 'estadoCivil' } },
  { chave: 'nacionalidade', rotulo: 'Nacionalidade', tipo: 'text', grupo: 'Identificação', destino: { aluno: 'nacionalidade' } },
  { chave: 'naturalidade', rotulo: 'Naturalidade (cidade/UF)', tipo: 'text', grupo: 'Identificação', destino: { aluno: 'naturalidade' } },
  { chave: 'nomeMae', rotulo: 'Nome da mãe', tipo: 'text', grupo: 'Filiação', destino: { aluno: 'nomeMae' } },
  { chave: 'nomePai', rotulo: 'Nome do pai', tipo: 'text', grupo: 'Filiação', destino: { aluno: 'nomePai' } },
  // Endereço — mesmas chaves da ficha em Acadêmico › Pessoas
  { chave: 'cep', rotulo: 'CEP', tipo: 'cep', grupo: 'Endereço', destino: { json: 'enderecoJson', campo: 'cep' } },
  { chave: 'logradouro', rotulo: 'Endereço (rua/avenida)', tipo: 'text', grupo: 'Endereço', destino: { json: 'enderecoJson', campo: 'logradouro' } },
  { chave: 'numero', rotulo: 'Número', tipo: 'text', grupo: 'Endereço', destino: { json: 'enderecoJson', campo: 'numero' } },
  { chave: 'complemento', rotulo: 'Complemento', tipo: 'text', grupo: 'Endereço', destino: { json: 'enderecoJson', campo: 'complemento' } },
  { chave: 'bairro', rotulo: 'Bairro', tipo: 'text', grupo: 'Endereço', destino: { json: 'enderecoJson', campo: 'bairro' } },
  { chave: 'municipio', rotulo: 'Cidade', tipo: 'text', grupo: 'Endereço', destino: { json: 'enderecoJson', campo: 'municipio' } },
  { chave: 'uf', rotulo: 'Estado (UF)', tipo: 'select', grupo: 'Endereço', opcoes: UFS, destino: { json: 'enderecoJson', campo: 'uf' } },
  // Escolaridade e inclusão
  { chave: 'escolaOrigem', rotulo: 'Escola onde concluiu o ensino médio', tipo: 'text', grupo: 'Escolaridade', destino: { json: 'socioEconomicoJson', campo: 'escolaOrigem' } },
  { chave: 'tipoEscolaEM', rotulo: 'Tipo de escola do ensino médio', tipo: 'select', grupo: 'Escolaridade', opcoes: ['Pública', 'Privada', 'Parte pública, parte privada'], destino: { json: 'socioEconomicoJson', campo: 'tipoEscolaEM' } },
  { chave: 'anoConclusaoEM', rotulo: 'Ano de conclusão do ensino médio', tipo: 'number', grupo: 'Escolaridade', destino: { json: 'socioEconomicoJson', campo: 'anoConclusaoEM' } },
  { chave: 'enemInscricao', rotulo: 'Nº de inscrição do ENEM', tipo: 'text', grupo: 'Escolaridade', destino: { aluno: 'enemInscricao' } },
  { chave: 'enemAno', rotulo: 'Ano do ENEM', tipo: 'number', grupo: 'Escolaridade', destino: { aluno: 'enemAno', conv: 'int' } },
  { chave: 'deficiencia', rotulo: 'Pessoa com deficiência, TEA ou altas habilidades', tipo: 'select', grupo: 'Escolaridade', opcoes: ['Não', 'Sim — deficiência', 'Sim — TEA', 'Sim — altas habilidades'], destino: { json: 'socioEconomicoJson', campo: 'deficiencia' } },
  { chave: 'rendaFamiliar', rotulo: 'Renda familiar', tipo: 'text', grupo: 'Escolaridade', destino: { json: 'socioEconomicoJson', campo: 'renda' } },
  // Responsável financeiro (vira AcaResponsavel na matrícula)
  { chave: 'responsavelNome', rotulo: 'Nome do responsável financeiro', tipo: 'text', grupo: 'Responsável financeiro', destino: { responsavel: 'nome' } },
  { chave: 'responsavelCpf', rotulo: 'CPF do responsável', tipo: 'cpf', grupo: 'Responsável financeiro', destino: { responsavel: 'cpf' } },
  { chave: 'responsavelParentesco', rotulo: 'Parentesco', tipo: 'select', grupo: 'Responsável financeiro', opcoes: ['O(a) próprio(a) aluno(a)', 'Mãe', 'Pai', 'Cônjuge', 'Outro'], destino: { responsavel: 'parentesco' } },
  { chave: 'responsavelTelefone', rotulo: 'Telefone do responsável', tipo: 'phone', grupo: 'Responsável financeiro', destino: { responsavel: 'telefone' } },
  { chave: 'responsavelEmail', rotulo: 'E-mail do responsável', tipo: 'email', grupo: 'Responsável financeiro', destino: { responsavel: 'email' } },
]

export const POR_CHAVE = new Map(CATALOGO.map((d) => [d.chave, d]))

/** Nomes que o formulário antigo usava para o mesmo dado — lidos como sinônimo. */
const SINONIMOS: Record<string, string[]> = {
  nascimento: ['dataNascimento', 'data_nascimento', 'birthdate'],
  sexo: ['genero'],
  rgOrgaoEmissor: ['orgao_emissor'],
  racaCor: ['raca_cor', 'raca'],
  estadoCivil: ['estado_civil'],
  nomeMae: ['nome_mae', 'mae'],
  nomePai: ['nome_pai', 'pai'],
  logradouro: ['endereco'],
  municipio: ['cidade'],
  // Pergunta em duas partes do portal ("tem deficiência?" → qual): o tipo,
  // quando houver; senão a resposta ("Não").
  deficiencia: ['tipoDeficiencia', 'possuiDeficiencia'],
}

// ─── Etapas onde um dado pode ser pedido ──────────────────────────────────

export type EtapaDados = 'inscricao' | 'cadastro' | 'documentos' | 'contrato' | 'pagamento'
export const ETAPAS_DADOS: EtapaDados[] = ['inscricao', 'cadastro', 'documentos', 'contrato', 'pagamento']
export const ROTULO_ETAPA: Record<EtapaDados, string> = {
  inscricao: 'Inscrição (formulário)',
  cadastro: 'Completar cadastro',
  documentos: 'Documentos',
  contrato: 'Contrato',
  pagamento: 'Pagamento',
}

export interface CampoConfig { etapa: EtapaDados; obrigatorio: boolean }

export interface DadosConfig {
  /** completo = passo a passo; simplificado = uma página por fase. */
  modo: 'completo' | 'simplificado'
  /** Dado não listado = não é pedido. */
  campos: Record<string, CampoConfig>
  /** Sem estes preenchidos, a inscrição não vira matrícula. */
  exigidosMatricula: string[]
}

/** Ponto de partida sugerido: o formulário de sempre + o mínimo do Censo. */
export const SUGESTAO: DadosConfig = {
  modo: 'completo',
  campos: {
    nome: { etapa: 'inscricao', obrigatorio: true },
    email: { etapa: 'inscricao', obrigatorio: true },
    whatsapp: { etapa: 'inscricao', obrigatorio: true },
    cpf: { etapa: 'inscricao', obrigatorio: true },
    nascimento: { etapa: 'cadastro', obrigatorio: true },
    sexo: { etapa: 'cadastro', obrigatorio: true },
    racaCor: { etapa: 'cadastro', obrigatorio: true },
    nomeMae: { etapa: 'cadastro', obrigatorio: true },
    cep: { etapa: 'cadastro', obrigatorio: true },
    logradouro: { etapa: 'cadastro', obrigatorio: true },
    numero: { etapa: 'cadastro', obrigatorio: true },
    bairro: { etapa: 'cadastro', obrigatorio: true },
    municipio: { etapa: 'cadastro', obrigatorio: true },
    uf: { etapa: 'cadastro', obrigatorio: true },
  },
  exigidosMatricula: ['nome', 'cpf', 'nascimento', 'sexo', 'racaCor', 'nomeMae', 'cep', 'logradouro', 'municipio', 'uf'],
}

export function normalizarDados(bruto: unknown): DadosConfig | null {
  if (!bruto || typeof bruto !== 'object') return null
  const b = bruto as any
  const campos: Record<string, CampoConfig> = {}
  for (const [chave, c] of Object.entries((b.campos ?? {}) as Record<string, any>)) {
    if (!POR_CHAVE.has(chave)) continue
    const etapa = String(c?.etapa ?? '') as EtapaDados
    if (!ETAPAS_DADOS.includes(etapa)) continue
    campos[chave] = { etapa, obrigatorio: !!c?.obrigatorio }
  }
  // Essenciais: sempre na inscrição e obrigatórios — sem eles não há como
  // criar o contato nem devolver a inscrição a quem a fez.
  for (const d of CATALOGO) if (d.essencial) campos[d.chave] = { etapa: 'inscricao', obrigatorio: true }
  const exigidos = Array.isArray(b.exigidosMatricula)
    ? [...new Set((b.exigidosMatricula as unknown[]).map(String).filter((k) => POR_CHAVE.has(k)))]
    : []
  return { modo: b.modo === 'simplificado' ? 'simplificado' : 'completo', campos, exigidosMatricula: exigidos }
}

const CHAVE_SETTING = 'edu.dados_etapas'

export async function lerPadraoInstituicao(): Promise<DadosConfig | null> {
  const s = await prisma.setting.findUnique({ where: { key: CHAVE_SETTING } }).catch(() => null)
  return normalizarDados(s?.value)
}

export async function gravarPadraoInstituicao(bruto: unknown): Promise<DadosConfig> {
  const cfg = normalizarDados(bruto) ?? normalizarDados(SUGESTAO)!
  await prisma.setting.upsert({
    where: { key: CHAVE_SETTING },
    create: { key: CHAVE_SETTING, value: cfg as any, label: 'Dados pedidos em cada etapa (educacional)', grp: 'educacional', fieldType: 'json' },
    update: { value: cfg as any },
  })
  return cfg
}

/** Ajuste do portal, se houver (jornadaEtapas.dados). */
export function dadosDoPortalBruto(jornadaEtapas: unknown): DadosConfig | null {
  return normalizarDados((jornadaEtapas as any)?.dados)
}

/** O que vale para o portal: o ajuste dele, senão o padrão da instituição, senão null (formulário antigo). */
export async function dadosEfetivos(portal: { jornadaEtapas?: unknown } | null): Promise<DadosConfig | null> {
  return dadosDoPortalBruto(portal?.jornadaEtapas) ?? (await lerPadraoInstituicao())
}

// ─── Campos de uma etapa ──────────────────────────────────────────────────

export interface CampoPedido {
  type: TipoDado
  name: string
  label: string
  required: boolean
  options?: string[]
}

function paraCampo(d: DadoCatalogo, obrigatorio: boolean): CampoPedido {
  return { type: d.tipo, name: d.chave, label: d.rotulo, required: obrigatorio, ...(d.opcoes ? { options: d.opcoes } : {}) }
}

/**
 * Campos de uma etapa, na ordem do catálogo. No modo simplificado, a fase de
 * matrícula é uma página só: tudo que é pedido depois da inscrição cai em
 * "Completar cadastro" e as outras etapas ficam só com a sua ação.
 */
export function camposDaEtapa(cfg: DadosConfig, etapa: EtapaDados): CampoPedido[] {
  const vale = (e: EtapaDados) => cfg.modo === 'simplificado' && etapa !== 'inscricao'
    ? (etapa === 'cadastro' ? e !== 'inscricao' : false)
    : e === etapa
  return CATALOGO.filter((d) => cfg.campos[d.chave] && vale(cfg.campos[d.chave].etapa))
    .map((d) => paraCampo(d, cfg.campos[d.chave].obrigatorio))
}

// ─── Formulário de inscrição efetivo ──────────────────────────────────────

/**
 * O formConfig que o portal público usa: os dados da etapa "Inscrição" viram o
 * passo "Dados pessoais" (no lugar do bloco fixo antigo), e campos do catálogo
 * repetidos em outros passos saem de lá — cada dado é pedido uma vez só. No modo
 * simplificado, todos os passos viram uma página.
 */
export function formConfigEfetivo(formConfig: any, cfg: DadosConfig | null): any {
  if (!cfg) return formConfig
  const steps: any[] = Array.isArray(formConfig?.steps) ? formConfig.steps : []
  const dadosInscricao = camposDaEtapa(cfg, 'inscricao')
  const ehIdentidade = (s: any) => {
    const nomes = (s?.fields ?? []).map((f: any) => String(f?.name ?? '').toLowerCase())
    return nomes.includes('nome') && (nomes.includes('email') || nomes.includes('cpf'))
  }
  const outros = steps
    .filter((s) => !ehIdentidade(s))
    // Só sai o que a configuração pede em alguma etapa — um campo extra de modo
    // de ingresso (ex.: Nº do ENEM) que ninguém configurou continua onde está.
    .map((s) => ({ ...s, fields: (s.fields ?? []).filter((f: any) => !cfg.campos[String(f?.name ?? '')]) }))
    .filter((s) => (s.fields ?? []).length > 0)
  const pessoal = { id: 'dados-pessoais', name: 'Dados pessoais', fields: dadosInscricao }
  let novos = [pessoal, ...outros]
  if (cfg.modo === 'simplificado') {
    novos = [{ id: 'inscricao', name: 'Inscrição', fields: novos.flatMap((s) => s.fields ?? []) }]
  }
  return { ...formConfig, steps: novos, _simplificado: cfg.modo === 'simplificado' }
}

// ─── Valores, pendências e gravação no cadastro ───────────────────────────

const vazio = (v: unknown) => v === null || v === undefined || String(v).trim() === ''

/** Valor de um dado no formData (aceita os nomes antigos). */
export function valorNoForm(form: Record<string, any>, chave: string): unknown {
  if (!vazio(form?.[chave])) return form[chave]
  for (const s of SINONIMOS[chave] ?? []) if (!vazio(form?.[s])) return form[s]
  return undefined
}

/** Valor de um dado já gravado no cadastro (aluno/lead/responsável). */
function valorNoCadastro(d: DadoCatalogo, ctx: { lead: any; aluno: any; resp: any }): unknown {
  const dst = d.destino as any
  if (dst.lead) return ctx.lead?.[dst.lead]
  if (dst.aluno) return ctx.aluno?.[dst.aluno]
  if (dst.json) return (ctx.aluno?.[dst.json] as any)?.[dst.campo]
  if (dst.responsavel) return ctx.resp?.[dst.responsavel]
  return undefined
}

async function cadastroDoLead(leadId: number | null) {
  if (!leadId) return { lead: null, aluno: null, resp: null }
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { nome: true, email: true, whatsapp: true } })
  const aluno = await prisma.aluno.findUnique({ where: { leadId } }).catch(() => null)
  const resp = aluno
    ? await prisma.acaResponsavel.findFirst({ where: { alunoId: aluno.id, tipo: 'FINANCEIRO', ativo: true }, orderBy: { id: 'asc' } }).catch(() => null)
    : null
  return { lead, aluno, resp }
}

/** Valor atual de um dado para a inscrição: o que a pessoa informou ou o que já está no cadastro. */
export async function valoresAtuais(reg: { leadId: number | null; formData: unknown }, chaves: string[]) {
  const form = (reg.formData as Record<string, any>) || {}
  const ctx = await cadastroDoLead(reg.leadId)
  const out: Record<string, unknown> = {}
  for (const k of chaves) {
    const d = POR_CHAVE.get(k)
    if (!d) continue
    const v = valorNoForm(form, k) ?? valorNoCadastro(d, ctx)
    out[k] = v instanceof Date ? v.toLocaleDateString('pt-BR') : v
  }
  return out
}

/** Dados exigidos para matricular que ainda faltam nesta inscrição. */
export async function pendenciasParaMatricular(registrationId: number): Promise<{ chave: string; rotulo: string }[]> {
  const reg = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId },
    select: { leadId: true, formData: true, portal: { select: { jornadaEtapas: true } } },
  })
  if (!reg) return []
  const cfg = await dadosEfetivos(reg.portal)
  if (!cfg || !cfg.exigidosMatricula.length) return []
  const atuais = await valoresAtuais(reg, cfg.exigidosMatricula)
  return cfg.exigidosMatricula
    .filter((k) => vazio(atuais[k]))
    .map((k) => ({ chave: k, rotulo: POR_CHAVE.get(k)!.rotulo }))
}

/** Cobertura da configuração: exigido para matricular que nenhuma etapa pede. */
export function lacunasDaConfig(cfg: DadosConfig): { naoPedidos: string[]; opcionais: string[] } {
  return {
    naoPedidos: cfg.exigidosMatricula.filter((k) => !cfg.campos[k]),
    opcionais: cfg.exigidosMatricula.filter((k) => cfg.campos[k] && !cfg.campos[k].obrigatorio),
  }
}

function converter(d: DadoCatalogo, v: unknown): unknown {
  const s = String(v ?? '').trim()
  if (!s) return null
  const conv = (d.destino as any).conv
  if (conv === 'digitos') return s.replace(/\D+/g, '') || null
  if (conv === 'int') { const n = parseInt(s, 10); return Number.isFinite(n) ? n : null }
  if (conv === 'data') {
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
    const dt = m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12) : new Date(s)
    return Number.isNaN(dt.getTime()) ? null : dt
  }
  return s.slice(0, 191)
}

/**
 * Copia para o cadastro do aluno os dados do catálogo presentes no formulário.
 * Não apaga nada: dado vazio no formulário não sobrescreve o que a secretaria
 * já preencheu. Sem aluno ainda (antes da efetivação), não faz nada — os dados
 * ficam no formData e são copiados na efetivação.
 */
export async function aplicarNoCadastro(leadId: number | null, form: Record<string, any>): Promise<void> {
  if (!leadId) return
  const aluno = await prisma.aluno.findUnique({ where: { leadId } }).catch(() => null)
  if (!aluno) return
  const cols: Record<string, unknown> = {}
  const jsons: Record<string, Record<string, unknown>> = {}
  const resp: Record<string, unknown> = {}
  for (const d of CATALOGO) {
    const bruto = valorNoForm(form, d.chave)
    if (vazio(bruto)) continue
    const v = converter(d, bruto)
    if (v === null) continue
    const dst = d.destino as any
    if (dst.aluno) cols[dst.aluno] = v
    else if (dst.json) (jsons[dst.json] ??= {})[dst.campo] = v
    else if (dst.responsavel) resp[dst.responsavel] = dst.responsavel === 'cpf' ? String(v).replace(/\D+/g, '') : v
  }
  for (const [col, novos] of Object.entries(jsons)) {
    cols[col] = { ...(((aluno as any)[col] as object) ?? {}), ...novos }
  }
  if (Object.keys(cols).length) await prisma.aluno.update({ where: { id: aluno.id }, data: cols as any })
  if (resp.nome) {
    const atual = await prisma.acaResponsavel.findFirst({ where: { alunoId: aluno.id, tipo: 'FINANCEIRO', ativo: true }, orderBy: { id: 'asc' } })
    if (atual) await prisma.acaResponsavel.update({ where: { id: atual.id }, data: resp as any })
    else await prisma.acaResponsavel.create({ data: { alunoId: aluno.id, tipo: 'FINANCEIRO', ...(resp as any) } })
  }
}

/** Erro de um valor para o tipo do campo (servidor — espelha o portal). */
export function erroDoValor(c: CampoPedido, v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (!s) return c.required ? `${c.label}: preencha este campo.` : null
  const dig = s.replace(/\D+/g, '')
  if (c.type === 'cpf' && dig.length !== 11) return `${c.label}: CPF precisa ter 11 números.`
  if (c.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) return `${c.label}: e-mail inválido.`
  if (c.type === 'cep' && dig.length !== 8) return `${c.label}: CEP precisa ter 8 números.`
  if (c.type === 'date' && !/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return `${c.label}: use o formato dd/mm/aaaa.`
  if (c.type === 'number' && !/^\d+$/.test(s)) return `${c.label}: só números.`
  if (c.type === 'select' && c.options?.length && !c.options.includes(s)) return `${c.label}: escolha uma das opções.`
  return null
}

// ─── Espelho do formulário ────────────────────────────────────────────────
//
// O que o candidato preenche no portal fica em registration.formData, que não
// é tela nenhuma: a inscrição mostrava só nome/CPF/e-mail/WhatsApp e o endereço
// só virava cadastro na efetivação. Aqui o formulário é lido inteiro, com os
// rótulos do próprio portal, para (1) a tela da inscrição mostrar tudo e
// (2) espelhar o mesmo conteúdo em campos personalizados do lead, de modo que
// quem trabalha no CRM veja os dados sem abrir a inscrição.

export interface CampoPreenchido {
  chave: string
  rotulo: string
  grupo: string
  tipo: TipoDado
  opcoes?: string[]
  valor: string
}

/** Chaves do formData que são controle, não resposta do candidato. */
const CHAVES_TECNICAS = new Set([
  'campusId', 'offeringId', 'entryModeId', 'ofertaId', 'formaIngressoId', 'planoId', 'portalId',
  'senha', 'password', 'senhaConfirmacao', 'lgpdConsent', 'recaptchaToken', 'captcha',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'referrer',
])
/** Tipos de campo do formConfig que não são dado do cadastro. */
const TIPOS_NAO_DADO = new Set(['offering-picker', 'password', 'hidden', 'heading', 'paragraph'])

function textoDoValor(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não'
  if (v instanceof Date) return v.toLocaleDateString('pt-BR')
  if (Array.isArray(v)) return v.map(textoDoValor).filter(Boolean).join(', ')
  if (typeof v === 'object') return ''
  return String(v).trim()
}

function rotuloDaChave(chave: string): string {
  const pronto = POR_CHAVE.get(chave)?.rotulo
  if (pronto) return pronto
  const s = chave.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Todos os campos do formulário da inscrição, na ordem em que o portal os pede.
 * Os rótulos vêm do formConfig (é o que o candidato leu na tela); o catálogo
 * entra como reserva e define o grupo. Respostas que não estão mais no
 * formulário (campo removido depois, dado vindo do chat) vão para o fim.
 */
export function camposDoFormulario(formConfig: unknown, form: Record<string, any>): CampoPreenchido[] {
  const out: CampoPreenchido[] = []
  const vistos = new Set<string>()
  const marcar = (chave: string) => {
    vistos.add(chave)
    for (const s of SINONIMOS[chave] ?? []) vistos.add(s)
  }

  const steps = (formConfig as any)?.steps
  if (Array.isArray(steps)) {
    for (const step of steps) {
      for (const f of (step?.fields ?? [])) {
        const chave = String(f?.name ?? '')
        if (!chave || vistos.has(chave)) continue
        if (CHAVES_TECNICAS.has(chave) || TIPOS_NAO_DADO.has(String(f?.type ?? ''))) { marcar(chave); continue }
        const cat = POR_CHAVE.get(chave)
        out.push({
          chave,
          rotulo: String(f?.label || cat?.rotulo || rotuloDaChave(chave)).slice(0, 191),
          grupo: cat?.grupo || String(step?.name || 'Formulário'),
          tipo: (cat?.tipo ?? (f?.type === 'select' ? 'select' : 'text')) as TipoDado,
          opcoes: Array.isArray(f?.options) ? f.options.map(String) : cat?.opcoes,
          valor: textoDoValor(valorNoForm(form, chave)),
        })
        marcar(chave)
      }
    }
  }

  for (const [chave, bruto] of Object.entries(form ?? {})) {
    if (vistos.has(chave) || chave.startsWith('_') || CHAVES_TECNICAS.has(chave)) continue
    const valor = textoDoValor(bruto)
    if (!valor) continue
    const cat = POR_CHAVE.get(chave)
    out.push({
      chave,
      rotulo: cat?.rotulo ?? rotuloDaChave(chave),
      grupo: cat?.grupo ?? 'Outras respostas',
      tipo: cat?.tipo ?? 'text',
      opcoes: cat?.opcoes,
      valor,
    })
    marcar(chave)
  }

  return out
}

/** Os mesmos campos, agrupados na ordem em que aparecem. */
export function agruparCampos(campos: CampoPreenchido[]): { grupo: string; campos: CampoPreenchido[] }[] {
  const ordem: string[] = []
  const por: Record<string, CampoPreenchido[]> = {}
  for (const c of campos) {
    if (!por[c.grupo]) { por[c.grupo] = []; ordem.push(c.grupo) }
    por[c.grupo].push(c)
  }
  return ordem.map((g) => ({ grupo: g, campos: por[g] }))
}

/** Nome, e-mail e WhatsApp já são colunas do lead: espelhá-los seria repetir. */
const JA_NO_LEAD = new Set(['nome', 'email', 'whatsapp'])
const TIPO_CUSTOM_FIELD: Record<TipoDado, string> = {
  text: 'text', email: 'email', phone: 'phone', cpf: 'text',
  date: 'date', cep: 'text', select: 'select', number: 'number',
}

/** Chave do campo personalizado que espelha um dado do portal. */
export function chaveDoEspelho(chave: string): string {
  const slug = chave.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().replace(/[^a-z0-9_]+/g, '_')
  return `cad_${slug}`.slice(0, 100)
}

/**
 * Copia o formulário para campos personalizados do lead. Cria a definição do
 * campo na primeira vez que o dado aparece (fora dos formulários de captação,
 * para não mudar o que o time preenche à mão) e só grava o que veio
 * preenchido: resposta em branco não apaga o que já estava lá.
 */
export async function espelharNoLead(leadId: number | null, campos: CampoPreenchido[]): Promise<void> {
  if (!leadId) return
  const uteis = campos.filter((c) => c.valor !== '' && !JA_NO_LEAD.has(c.chave))
  if (!uteis.length) return

  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { customFields: true } })
  if (!lead) return

  const chaves = uteis.map((c) => chaveDoEspelho(c.chave))
  const existentes = new Set(
    (await prisma.customField.findMany({ where: { key: { in: chaves } }, select: { key: true } })).map((f) => f.key),
  )
  const novos = uteis
    .filter((c) => !existentes.has(chaveDoEspelho(c.chave)))
    .map((c) => ({
      key: chaveDoEspelho(c.chave),
      label: c.rotulo.slice(0, 191),
      type: TIPO_CUSTOM_FIELD[c.tipo] ?? 'text',
      group: c.grupo.slice(0, 50),
      description: 'Preenchido pelo candidato no portal de matrículas.',
      options: c.opcoes?.length ? (c.opcoes.map((o) => ({ label: o, value: o })) as any) : undefined,
      showInForm: false,
      showInList: false,
      position: 900,
    }))
  if (novos.length) {
    // skipDuplicates: dois envios simultâneos podem criar o mesmo campo.
    await prisma.customField.createMany({ data: novos as any, skipDuplicates: true }).catch(() => {})
  }

  const valores: Record<string, unknown> = { ...((lead.customFields as Record<string, unknown>) ?? {}) }
  for (const c of uteis) valores[chaveDoEspelho(c.chave)] = c.valor
  await prisma.lead.update({ where: { id: leadId }, data: { customFields: valores as any } })
}

/** Espelho a partir da inscrição — o caminho usado pelas rotas do portal. */
export async function espelharInscricaoNoLead(
  reg: { leadId: number | null; formData: unknown },
  formConfig: unknown,
): Promise<void> {
  if (!reg.leadId) return
  const campos = camposDoFormulario(formConfig, (reg.formData as Record<string, any>) || {})
  await espelharNoLead(reg.leadId, campos)
}
