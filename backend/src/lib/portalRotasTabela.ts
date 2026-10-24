// src/lib/portalRotasTabela.ts
//
// Acesso por portal — a classificação de TODA rota que pode expor dado de um
// portal (inscrição e o que pende dela). Tabela pura, sem banco: a trava
// (lib/portalGuard.ts) e a bateria (tests/acesso-por-portal.test.ts) leem a
// mesma fonte.
//
// Regra da casa: FECHADA POR PADRÃO. Rota dentro de ESCOPO que nenhuma linha
// classifica vale 'somenteTodos' — para quem é recortado por portal, ela não
// responde. Rota nova esquecida não vaza; a bateria aponta a rota sem linha.
//
// Tipos:
//   entidade      a rota toca um registro identificado por `param` (URL);
//                 a trava resolve até a(s) inscrição(ões) dele. Leitura exige
//                 ver; escrita exige operar. Fora do alcance → 404.
//                 `todas`: a rota abre TODAS as inscrições da pessoa (login no
//                 portal do candidato) — exige alcance sobre cada uma, não só
//                 sobre uma.
//   portal        idem, mas o parâmetro é o próprio portal. `agregado`: número
//                 do portal inteiro (analytics, funil) — membro, que só vê os
//                 próprios leads, não recebe; líder e quem vê tudo, sim.
//   lista         lista sem id na URL: o recorte é aplicado no código da rota
//                 (whereInscricoes/sqlInscricoes) e a bateria confere.
//                 `corpoLivre`: o corpo traz ids que a própria rota recorta
//                 (exportação, painéis) — a trava não barra o pedido inteiro.
//   semPortal     configuração ou cadastro estrutural: nada de portal passa por
//                 ela. Ler: decide a permissão da tela. Alterar: só quem vê
//                 todos os portais — quem é recortado opera inscrições, mas não
//                 mexe na configuração da instituição (21/10/2026).
//   somenteTodos  visão que cruza todos os portais (BI, financeiro geral,
//                 diário de turma…): só quem vê todos os portais.
//
// Ids que chegam no CORPO ou na QUERY (registrationId, alunoIds, portalId…)
// são conferidos pela trava em qualquer tipo — ver CHAVES_DE_ID.

export type Entidade =
  | 'inscricao' | 'documento' | 'redacao' | 'enem' | 'envelope' | 'seiEnvio' | 'webhookHit'
  | 'matricula' | 'aluno' | 'contrato' | 'parcela' | 'ged' | 'lead' | 'processo' | 'portal'

export type Regra =
  | { t: 'entidade'; ent: Entidade; param: string; todas?: boolean }
  | { t: 'portal'; param: string; agregado?: boolean }
  | { t: 'lista'; corpoLivre?: boolean; todas?: boolean }
  | { t: 'semPortal' }
  | { t: 'somenteTodos' }

/** Prefixos onde mora dado de portal. Fora deles a trava não age. */
export const ESCOPO = /^\/api\/(admin\/(enrollment-|educational\/|educacional\/|edu\/|aca\/|coupons|payments\/|payment-providers|sei\/|registrations\/|enem-imports|presencial-exams|essay-submissions|analises-academicas|leads\/:id\/enrollment-link|leads\/export|portal-accounts|widget-data|portal-acesso)|bychat\/leads\/:leadId\/educational-registrations|home-screen\/educacional)/

/** Chaves de corpo/query que carregam id de registro de portal. */
export const CHAVES_DE_ID: Record<string, Entidade> = {
  registrationId: 'inscricao', registrationIds: 'inscricao', regId: 'inscricao', inscricaoId: 'inscricao',
  alunoId: 'aluno', alunoIds: 'aluno',
  matriculaId: 'matricula', matriculaIds: 'matricula',
  contratoId: 'contrato',
  parcelaId: 'parcela', parcelaIds: 'parcela',
  portalId: 'portal', portalIds: 'portal',
  leadId: 'lead', leadIds: 'lead',
}

const E = (ent: Entidade, param = 'id'): Regra => ({ t: 'entidade', ent, param })
const P = (param = 'id', agregado = false): Regra => ({ t: 'portal', param, agregado })
const L: Regra = { t: 'lista' }
const S: Regra = { t: 'semPortal' }
const T: Regra = { t: 'somenteTodos' }

/**
 * [padrão da rota (como o Fastify registra), métodos ('*' = todos), regra].
 * A PRIMEIRA linha que casa vence — linhas específicas antes das genéricas.
 */
export const TABELA: Array<[RegExp, string, Regra]> = [
  // ── Acesso por portal (a própria tela) ──────────────────────────────────
  // Quem é recortado nunca mexe na própria régua (seria se dar acesso a tudo).
  [/^\/api\/admin\/portal-acesso/, '*', T],

  // ── Portal de Matrículas ────────────────────────────────────────────────
  [/^\/api\/admin\/enrollment-portals$/, 'GET', L],
  [/^\/api\/admin\/enrollment-portals$/, 'POST', S],
  [/^\/api\/admin\/enrollment-portals\/source-labels$/, 'GET', L],
  [/^\/api\/admin\/enrollment-portals\/check-slug$/, 'GET', S],
  // Contratos do portal: modelos e configuração são da instituição; o que é
  // de inscrição vai pela entidade.
  [/^\/api\/admin\/enrollment-portals\/contratos\/inscricoes$/, 'GET', L],
  [/^\/api\/admin\/enrollment-portals\/contratos\/inscricao\/:regId/, '*', E('inscricao', 'regId')],
  [/^\/api\/admin\/enrollment-portals\/contratos\/envelope\/:id\/pdf$/, 'GET', E('envelope')],
  [/^\/api\/admin\/enrollment-portals\/contratos\/templates\/:id\/previa$/, 'POST', S],
  [/^\/api\/admin\/enrollment-portals\/contratos\//, '*', S],
  [/^\/api\/admin\/enrollment-portals\/:id\/(analytics|funnel|interessados)$/, 'GET', P('id', true)],
  [/^\/api\/admin\/enrollment-portals\/:id\/(registrations|registrations\.csv|duplicates)$/, 'GET', { t: 'portal', param: 'id' }],
  [/^\/api\/admin\/enrollment-portals\/:id\/duplicates\//, 'POST', P()],
  // O portal em si: ler é do portal; alterar a CONFIGURAÇÃO (formulário,
  // pagamento, marca, arquivos, duplicar, excluir) é da instituição — vale a
  // regra do semPortal (escrita só para quem vê todos). Operar inscrição é outra
  // coisa: vai pelas rotas de inscrição acima e abaixo.
  [/^\/api\/admin\/enrollment-portals\/:id/, 'GET', P()],
  [/^\/api\/admin\/enrollment-portals\/:id/, '*', S],
  [/^\/api\/admin\/enrollment-registrations$/, 'POST', L],
  [/^\/api\/admin\/enrollment-registrations\/:id/, '*', E('inscricao')],

  // ── Documentos, avaliações, jornada ─────────────────────────────────────
  [/^\/api\/admin\/enrollment-document-reviews$/, 'GET', L],
  [/^\/api\/admin\/enrollment-documents$/, 'GET', L],
  [/^\/api\/admin\/enrollment-documents\/:id\//, '*', E('documento')],
  [/^\/api\/admin\/analises-academicas$/, 'GET', L],
  [/^\/api\/admin\/(enem-imports|presencial-exams|essay-submissions)$/, 'GET', L],
  [/^\/api\/admin\/enem-imports\/:id/, '*', E('enem')],
  [/^\/api\/admin\/essay-submissions\/:id/, '*', E('redacao')],
  [/^\/api\/admin\/registrations\/:id\/presencial-exam$/, '*', E('inscricao')],
  [/^\/api\/admin\/educacional\/dados-etapas$/, '*', S],

  // ── Financeiro do portal, pagamentos, cupons (cruzam portais) ───────────
  [/^\/api\/admin\/educational\/portal-financeiro/, '*', T],
  [/^\/api\/admin\/payments\//, '*', T],
  [/^\/api\/admin\/payment-providers\/:id\/sync-charge$/, '*', T],
  [/^\/api\/admin\/payment-providers/, '*', S],
  [/^\/api\/admin\/coupons/, '*', T],

  // ── SEI: a fila é de todos os portais; o envio, da inscrição ────────────
  [/^\/api\/admin\/sei\/(elegibilidade|previa|inscricao)\/:registrationId/, '*', E('inscricao', 'registrationId')],
  [/^\/api\/admin\/sei\/(config|regras|testar|catalogo|mapeamentos)/, '*', S],
  [/^\/api\/admin\/sei\//, '*', T],

  // ── Educacional: estrutura e processos ──────────────────────────────────
  [/^\/api\/admin\/educacional\/selection-processes\/:id\/(classification|classify|convoke)$/, '*', T],
  [/^\/api\/admin\/educacional\/(stats|health|status)$/, 'GET', T],
  [/^\/api\/admin\/educacional\/(seed|toggle)/, '*', T],
  [/^\/api\/admin\/educacional\//, '*', S],
  [/^\/api\/admin\/educational\//, '*', S],
  [/^\/api\/admin\/edu\/geral/, '*', S],

  // ── Lead × educacional ──────────────────────────────────────────────────
  [/^\/api\/bychat\/leads\/:leadId\/educational-registrations$/, '*', E('lead', 'leadId')],
  [/^\/api\/bychat\/leads\/:leadId\/educational-registrations\/:id/, '*', E('processo')],
  [/^\/api\/admin\/leads\/:id\/enrollment-link$/, 'GET', E('lead')],
  [/^\/api\/admin\/portal-accounts\/:leadId\//, '*', { t: 'entidade', ent: 'lead', param: 'leadId', todas: true }],
  [/^\/api\/admin\/leads\/export\/sections$/, 'GET', S],
  [/^\/api\/admin\/leads\/export$/, 'POST', { t: 'lista', corpoLivre: true }],
  [/^\/api\/admin\/widget-data$/, 'POST', { t: 'lista', corpoLivre: true }],
  // A rota recorta pelos portais de quem olha (whereInscricoes).
  [/^\/api\/home-screen\/educacional$/, 'GET', L],

  // ── ERP: o que é de um aluno/matrícula ──────────────────────────────────
  [/^\/api\/admin\/aca\/inscricoes-portal$/, 'GET', L],
  [/^\/api\/admin\/aca\/inscricoes-portal\/efetivar-lote$/, 'POST', L],
  [/^\/api\/admin\/aca\/inscricoes-portal\/:id\//, '*', E('inscricao')],
  [/^\/api\/admin\/aca\/alunos$/, '*', L],
  [/^\/api\/admin\/aca\/meta$/, 'GET', L],
  [/^\/api\/admin\/aca\/alunos\/:id/, '*', E('aluno')],
  [/^\/api\/admin\/aca\/matriculas$/, 'GET', L],
  [/^\/api\/admin\/aca\/matriculas\/:id/, '*', E('matricula')],
  [/^\/api\/admin\/aca\/curriculo\/grade\/:matriculaId$/, 'GET', E('matricula', 'matriculaId')],
  [/^\/api\/admin\/aca\/financeiro\/aluno\/:alunoId\/extrato$/, 'GET', E('aluno', 'alunoId')],
  [/^\/api\/admin\/aca\/financeiro\/bloqueio\/:alunoId$/, 'GET', E('aluno', 'alunoId')],
  [/^\/api\/admin\/aca\/financeiro\/contrato\/:id$/, 'GET', E('contrato')],
  [/^\/api\/admin\/aca\/parcelas\/:id\//, '*', E('parcela')],
  [/^\/api\/admin\/aca\/ged$/, 'GET', L],
  [/^\/api\/admin\/aca\/ged$/, 'POST', L],
  [/^\/api\/admin\/aca\/ged\/:id$/, '*', E('ged')],
  [/^\/api\/admin\/aca\/assinatura$/, 'GET', L],
  [/^\/api\/admin\/aca\/assinatura$/, 'POST', L],
  [/^\/api\/admin\/aca\/assinatura\/de-template$/, 'POST', L],
  [/^\/api\/admin\/aca\/assinatura\/templates\/:id\/previa$/, 'POST', S],
  [/^\/api\/admin\/aca\/assinatura\/(config|variaveis|campos-word|opcoes-vinculo|modelo-exemplo|templates|gatilhos)/, '*', S],
  [/^\/api\/admin\/aca\/assinatura\/:id/, '*', E('envelope')],
  [/^\/api\/admin\/aca\/enade\/aluno\/:alunoId$/, 'GET', E('aluno', 'alunoId')],
  [/^\/api\/admin\/aca\/portal\/link$/, 'POST', { t: 'lista', todas: true }],

  // ── ERP: cadastro estrutural (nenhum aluno passa por aqui) ──────────────
  [/^\/api\/admin\/aca\/(disciplinas|matrizes|modulos|periodos|cadastros|eventos|horarios|ies|mantenedoras|esquemas|requerimento-tipos|requerimento-categorias|alocacao|formas-ingresso|refs|config|equivalencia-grupos|capacidades|criterios|componentes|atos|ppcp|docente)(\/|$)/, '*', S],
  [/^\/api\/admin\/aca\/turmas$/, '*', S],
  [/^\/api\/admin\/aca\/turmas\/:id$/, '*', S],
  [/^\/api\/admin\/aca\/turmas\/:id\/horarios$/, '*', S],
  [/^\/api\/admin\/aca\/curriculo\/(componentes|equivalencias)/, '*', S],
  [/^\/api\/admin\/aca\/(financeiro\/(config|contrato-termo|bloqueio-config)|fin-banco\/(contas-bancarias|contas-financeiras|feriados|indexadores)|cobranca-fiscal\/(nfse-config|regras)|comunicacao\/config|ead\/config|diploma\/config|acordo\/politica|push\/config|estagio\/metas|importacao\/modelo|regimes-especiais\/tipos|vestibular\/(motivos-cancelamento|grupos|empresas)|acervo\/tabela-temporalidade)/, '*', S],

  // ── ERP: o resto cruza alunos de todos os portais ───────────────────────
  // Turma, diário, BI, censo, financeiro geral, remessa, movimentações,
  // vínculos, diplomas, requerimentos… quem é recortado por portal não entra.
  [/^\/api\/admin\/aca\//, '*', T],
]

/** A regra da rota, ou `null` fora do escopo. Sem linha dentro do escopo = somenteTodos. */
export function regraDaRota(metodo: string, rota: string): { regra: Regra; classificada: boolean } | null {
  if (!ESCOPO.test(rota)) return null
  const m = metodo.toUpperCase()
  for (const [re, metodos, regra] of TABELA) {
    if ((metodos === '*' || metodos.split(',').includes(m)) && re.test(rota)) return { regra, classificada: true }
  }
  return { regra: T, classificada: false }
}
