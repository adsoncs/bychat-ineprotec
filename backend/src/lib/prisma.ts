import { PrismaClient } from '@prisma/client'
import { numeroDiscavel, phoneKey } from './phone.js'
import { decryptSettingValue, encryptSettingValue, isSecretSettingKey, isEncrypted } from './secretSettings.js'
import { podeTrocarDono } from './donoDoLead.js'
import { usuariosComerciais } from './equipeComercial.js'

const globalForPrisma = global as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development'
      ? ['query', 'warn', 'error']
      : ['warn', 'error']
  })

// ─── Identidade canônica do contato (fix definitivo de duplicação) ───
// Toda escrita de Lead que toca `whatsapp` recompõe `Lead.phoneKey` (chave
// canônica BR — ver lib/phone.ts). Centralizar aqui garante que QUALQUER caminho
// de criação/edição (webhooks, agendamento, formulários, manual, import, Make,
// API pública…) mantenha a chave de match consistente, sem precisar instrumentar
// cada call site. Respeita um phoneKey explicitamente fornecido pelo caller.
//
// Além da chave de match, o PRÓPRIO `whatsapp` é gravado já canônico (com o DDI
// 55). O CRM guardava o que o canal mandou — o Lead Ads da Meta entrega
// "18988059971", sem DDI — e o disparo automático ia com esse valor para as APIs
// de WhatsApp, que respondiam `exists:false` (Evolution) ou 131009 (Meta). Como
// a normalização é idempotente e roda na escrita, todo canal (Lead Ads, webhook
// de entrada, formulário, chat, manual, importação, API) grava no mesmo formato.
//
// Valores que NÃO são telefone (LID, número sem DDD, ruído) são preservados como
// vieram: aqui não se apaga dado de contato — quem envia é que aborta com erro
// explicativo (ver lib/phone.ts → toWaNumber).
function applyPhoneKey(data: any): void {
  if (!data || typeof data !== 'object') return
  if (!('whatsapp' in data)) return
  const w = data.whatsapp
  const isSet = w && typeof w === 'object' && 'set' in w
  const raw = isSet ? w.set : w
  if (typeof raw !== 'string') return

  const key = phoneKey(raw)
  if (!('phoneKey' in data)) data.phoneKey = key

  // O `whatsapp` é o número discável: igual à chave, menos o 9 que a chave põe
  // em telefone FIXO (ver lib/phone.ts → numeroDiscavel).
  const discavel = numeroDiscavel(raw)
  // JID completo (@lid, @g.us) é identificador de sessão, não telefone — intacto.
  if (discavel && !raw.includes('@') && raw.replace(/\D/g, '') !== discavel) {
    if (isSet) w.set = discavel
    else data.whatsapp = discavel
  }
}

// ─── Segredos das Configurações, cifrados em repouso ───
// Chave de API/secret/token gravados em `Setting` ficavam legíveis na tabela.
// Cifrar aqui (e não em cada call site) porque são dezenas de pontos lendo
// Setting no backend — um esquecido devolveria o segredo em claro sem aviso.
// Ver lib/secretSettings.ts. Valor legado em claro continua sendo lido normal,
// então a migração dos registros existentes pode acontecer depois.
/** Cifra `container.value` quando `key` for de segredo. `key` vem do próprio
 *  data (create/update) ou do `where` (caso do upsert, cujo update não a traz). */
function encryptSettingValueIn(key: unknown, container: any): void {
  if (!container || typeof container !== 'object' || !('value' in container)) return
  const k = typeof key === 'object' && key ? (key as any).set : key
  if (!isSecretSettingKey(k)) return
  const v = container.value
  const isSet = v && typeof v === 'object' && 'set' in v
  if (isSet) v.set = encryptSettingValue(v.set)
  else container.value = encryptSettingValue(v)
}

function encryptSettingData(data: any): void {
  if (data && typeof data === 'object') encryptSettingValueIn(data.key, data)
}

function decryptSettingRow(row: any): any {
  if (!row || typeof row !== 'object') return row
  // Pelo prefixo também: leitura com `select: { value: true }` não traz a key, e
  // o valor saía CIFRADO para quem pediu — a Autentique recebia o envelope
  // "enc:v1:…" como token e respondia 401 (ineprotec, 30/09).
  if ('value' in row && (isSecretSettingKey(row.key) || isEncrypted(row.value))) row.value = decryptSettingValue(row.value)
  return row
}

/**
 * Ficha onde vive a conversa deste lead: a principal, quando ele é uma duplicata
 * ainda não revisada (`pending_review` → possibleDuplicateOfId). Um número, uma
 * conversa: o que um robô, fluxo, cadência ou portal gravar na duplicata entra
 * no chat da principal, onde a resposta do contato também cai (contactIdentity →
 * buscarNoCanal). As fichas continuam separadas até alguém mesclar.
 */
export async function leadDaConversa(leadId: number): Promise<number> {
  const canal = { instanceName: true, cloudApiConnectionId: true } as const
  let id = leadId
  for (let i = 0; i < 5; i++) {
    const l = await prisma.lead.findUnique({ where: { id }, select: { duplicateStatus: true, possibleDuplicateOfId: true, ...canal } })
    if (!l || l.duplicateStatus !== 'pending_review' || !l.possibleDuplicateOfId || l.possibleDuplicateOfId === id) break
    // Cada número é uma conversa (1 lead por telefone POR número): a duplicata
    // que já fala por um número e a principal que fala por OUTRO são dois chats
    // no aparelho do contato. Desviar juntava os dois — o que o agente mandava
    // pelo número dele ia parar na conversa do outro e sumia da tela (beyond,
    // 20/10: 5 mensagens do número do agente gravadas na conversa da API oficial).
    const p = await prisma.lead.findUnique({ where: { id: l.possibleDuplicateOfId }, select: canal })
    if (!p || numeroDiferente(l, p)) break
    id = l.possibleDuplicateOfId
  }
  return id
}

type CanalDaFicha = { instanceName: string | null; cloudApiConnectionId: number | null }
const chaveDoCanal = (c: CanalDaFicha) =>
  c.cloudApiConnectionId != null ? `cloud:${c.cloudApiConnectionId}` : c.instanceName ? `evo:${c.instanceName}` : null

/** As duas fichas têm número definido e não é o mesmo. Ficha sem número (formulário, portal) segue a principal. */
export function numeroDiferente(a: CanalDaFicha, b: CanalDaFicha): boolean {
  const x = chaveDoCanal(a), y = chaveDoCanal(b)
  return x !== null && y !== null && x !== y
}

async function redirecionarMensagem(data: any): Promise<void> {
  if (!data || typeof data !== 'object') return
  if (typeof data.leadId === 'number') {
    data.leadId = await leadDaConversa(data.leadId)
  } else if (typeof data.lead?.connect?.id === 'number') {
    data.lead.connect.id = await leadDaConversa(data.lead.connect.id)
  }
}

// ─── Trava do responsável (ver lib/donoDoLead.ts) ───
function valorDoCampo(raw: any): number | null {
  const v = raw && typeof raw === 'object' && 'set' in raw ? raw.set : raw
  return v == null ? null : Number(v)
}

function semTrocaDeDono(data: any): any {
  const { assignedUserId: _dono, assignedAt: _quando, ...resto } = data || {}
  return resto
}

// Chave `routing.donoFixo` (Cadastros › Roteamento). Cache de 60s: ligar ou
// desligar na tela vale em até um minuto.
let _donoFixo: { ligado: boolean; ate: number } | null = null
async function travaDoDonoLigada(): Promise<boolean> {
  if (_donoFixo && _donoFixo.ate > Date.now()) return _donoFixo.ligado
  const s = await prisma.setting.findUnique({ where: { key: 'routing.donoFixo' }, select: { value: true } }).catch(() => null)
  const v = s?.value as unknown
  const ligado = v === true || v === 1 || (typeof v === 'string' && v.toLowerCase() === 'true')
  _donoFixo = { ligado, ate: Date.now() + 60_000 }
  return ligado
}

function avisarTrava(ids: number[], novoDono: number | null): void {
  console.warn(`[dono] troca automática barrada — ${ids.length} lead(s) mantêm o responsável (pedido: ${novoDono ?? 'sem dono'}; leads ${ids.slice(0, 10).join(', ')})`)
}

// ─── Lead: funil de entrada e troca de equipe ───
// Registrado ANTES do middleware abaixo, então envolve ele: vê a gravação já
// feita (com a trava de dono aplicada) e só então age.
//
// · funnelEntradaId: o funil em que o lead entrou, para os relatórios de
//   aquisição. Gravado uma vez — mover o lead de funil depois não o tira do
//   resultado da campanha que o trouxe.
// · Troca de equipe de lead GANHO pode abrir um card no funil da nova equipe
//   (services/oportunidadeAutomatica.ts). São 16 caminhos que gravam teamId;
//   este é o único por onde todos passam.
prisma.$use(async (params, next) => {
  if (params.model !== 'Lead') return next(params)
  const a = params.action

  if (a === 'create' && params.args?.data && params.args.data.funnelId != null && params.args.data.funnelEntradaId == null) {
    params.args.data.funnelEntradaId = params.args.data.funnelId
  }

  const data = a === 'update' || a === 'updateMany' ? params.args?.data : null
  const trocaEquipe = !!data && 'teamId' in data
  const trocaFunil = !!data && 'funnelId' in data
  // Ganho: o responsável deste momento vira o VENDEDOR do lead (Lead.vendedorUserId)
  // — comissão, metas e placares contam por ele, e transferir depois não o muda.
  // São vários caminhos que marcam Ganho (botão, etapa, pagamento, fluxo); este
  // é o único por onde todos passam.
  const outcomeNovo = data && 'outcome' in data
    ? (data.outcome && typeof data.outcome === 'object' && 'set' in data.outcome ? data.outcome.set : data.outcome)
    : undefined
  const marcaGanho = outcomeNovo === 'won'
  if (!trocaEquipe && !trocaFunil && !marcaGanho) return next(params)

  const antes = await prisma.lead.findMany({
    where: params.args?.where ?? {},
    select: { id: true, teamId: true, outcome: true },
  }).catch(() => [] as { id: number; teamId: number | null; outcome: string | null }[])
  const result = await next(params)
  if (!antes.length) return result
  const ids = antes.map((l) => l.id)

  // Fora da transação de quem gravou: ler/gravar por fora esperaria o lock dela.
  setImmediate(() => {
    if (trocaFunil) {
      // SQL direto: ids são inteiros vindos do banco, e um updateMany passaria de
      // novo por este middleware.
      prisma.$executeRawUnsafe(
        `UPDATE bychat_leads SET funnelEntradaId = funnelId WHERE funnelEntradaId IS NULL AND funnelId IS NOT NULL AND id IN (${ids.map(Number).join(',')})`,
      ).catch(() => {})
    }
    if (trocaEquipe) {
      import('../services/oportunidadeAutomatica.js')
        .then((m) => m.aoTrocarDeEquipe(antes))
        .catch((e) => console.error('[oportunidade]', e?.message || e))
    }
    // Só quem ACABOU de virar Ganho (reaberto e ganho de novo também): quem já
    // estava ganho guarda o vendedor que tinha. Quem é o vendedor (equipe
    // comercial, último comercial, responsável): services/vendedorDoLead.ts.
    const ganhosAgora = antes.filter((l) => l.outcome !== 'won').map((l) => Number(l.id))
    if (marcaGanho && ganhosAgora.length) {
      import('../services/vendedorDoLead.js')
        .then((m) => m.gravarVendedorNoGanho(ganhosAgora))
        .catch((e) => console.error('[vendedor]', e?.message || e))
    }
  })
  return result
})

prisma.$use(async (params, next) => {
  if (params.model === 'Message' && (params.action === 'create' || params.action === 'createMany' || params.action === 'upsert')) {
    const d = params.action === 'upsert' ? params.args?.create : params.args?.data
    if (Array.isArray(d)) for (const x of d) await redirecionarMensagem(x)
    else await redirecionarMensagem(d)
    return next(params)
  }

  if (params.model === 'Setting') {
    const a = params.action
    if (a === 'create') encryptSettingData(params.args?.data)
    // No update a key vive no `where` (o data costuma trazer só o value).
    else if (a === 'update') {
      encryptSettingData(params.args?.data)
      encryptSettingValueIn(params.args?.where?.key, params.args?.data)
    }
    else if (a === 'upsert') {
      encryptSettingData(params.args?.create)
      // O `update` do upsert não traz a key — ela está no where.
      encryptSettingValueIn(params.args?.where?.key, params.args?.update)
    } else if (a === 'createMany') {
      const d = params.args?.data
      if (Array.isArray(d)) d.forEach(encryptSettingData)
      else encryptSettingData(d)
    } else if (a === 'updateMany') {
      // updateMany não sabe a key de cada linha: só cifra quando o where a fixa.
      encryptSettingValueIn(params.args?.where?.key, params.args?.data)
    }

    const result = await next(params)
    if (Array.isArray(result)) return result.map(decryptSettingRow)
    return decryptSettingRow(result)
  }

  if (params.model === 'Lead') {
    const a = params.action
    if (a === 'create' || a === 'update') {
      applyPhoneKey(params.args?.data)
    } else if (a === 'upsert') {
      applyPhoneKey(params.args?.create)
      applyPhoneKey(params.args?.update)
    } else if (a === 'createMany' || a === 'updateMany') {
      const d = params.args?.data
      if (Array.isArray(d)) d.forEach(applyPhoneKey)
      else applyPhoneKey(d)
    }

    // ─── Lead com responsável não muda de mão sozinho (chave routing.donoFixo) ───
    // Regra em lib/donoDoLead.ts: só o próprio dono (ou admin) tira o lead de
    // quem está com ele. Gravação automática que tenta trocar ou apagar um dono
    // existente segue sem o campo — o resto do que ela grava (equipe, etapa,
    // status) vale normalmente. Dar dono a lead sem dono continua livre.
    if (a === 'upsert' && params.args?.update && 'assignedUserId' in params.args.update && await travaDoDonoLigada()) {
      const novo = valorDoCampo(params.args.update.assignedUserId)
      const atual = await prisma.lead.findUnique({ where: params.args.where, select: { id: true, assignedUserId: true } }).catch(() => null)
      if (atual && !podeTrocarDono(atual.assignedUserId, novo)) {
        avisarTrava([atual.id], novo)
        params.args.update = semTrocaDeDono(params.args.update)
      }
    }

    // ─── Dono do lead manda no dono da negociação ───
    // O lead troca de responsável por uma dúzia de caminhos (painel, fila do
    // atendimento, chatbot, roteamento, workflow, transferência, virada de
    // turno). Instrumentar cada um deixaria a proposta com o nome antigo em
    // algum deles — e o painel de Negociações mostraria o vendedor errado.
    // Aqui é o único ponto por onde todos passam.
    //
    // Só negociações EM ABERTO: proposta fechada guarda quem estava com ela no
    // fechamento (é o registro da venda, não o estado atual da carteira).
    if ((a === 'update' || a === 'updateMany') && params.args?.data && 'assignedUserId' in params.args.data) {
      const novoDono = valorDoCampo(params.args.data.assignedUserId)
      // Conversa liberada (fila "Liberadas") deixa de ser liberada quando alguém
      // assume o lead — por qualquer caminho: puxar, transferir, rodízio.
      if (novoDono != null && !('conversaLiberadaEm' in params.args.data)) params.args.data.conversaLiberadaEm = null
      const linhas = await prisma.lead.findMany({ where: params.args?.where ?? {}, select: { id: true, assignedUserId: true } })
      const trava = await travaDoDonoLigada()
      const barrados = trava ? linhas.filter((l) => !podeTrocarDono(l.assignedUserId, novoDono)).map((l) => l.id) : []
      const ids = linhas.filter((l) => !barrados.includes(l.id)).map((l) => l.id)

      let result: any
      if (!barrados.length) {
        result = await next(params)
      } else {
        avisarTrava(barrados, novoDono)
        const resto = semTrocaDeDono(params.args.data)
        if (a === 'update') {
          params.args.data = resto
          result = await next(params)
        } else {
          // updateMany: os liberados recebem tudo; os barrados, o resto sem o dono.
          let count = 0
          if (ids.length) {
            params.args.where = { AND: [params.args.where ?? {}, { id: { in: ids } }] }
            count += (await next(params)).count
          }
          // Dentro de transação, gravar por fora esperaria o lock dela mesma.
          if (Object.keys(resto).length && !params.runInTransaction) {
            count += (await prisma.lead.updateMany({ where: { id: { in: barrados } }, data: resto })).count
          } else if (Object.keys(resto).length) {
            console.warn(`[dono] updateMany em transação: campos ${Object.keys(resto).join(', ')} não aplicados aos leads ${barrados.join(', ')}`)
          }
          result = { count }
        }
      }
      if (ids.length) {
        // Equipe comercial marcada: lead que sai da comercial (Financeiro,
        // Secretaria, liberado ao resolver) ainda em negociação não leva a
        // proposta — ela fica com quem negociou. Só passa entre comerciais, ou
        // quando a proposta não está com ninguém da comercial.
        const comerciais = await usuariosComerciais().catch(() => null)
        const novoEhComercial = novoDono != null && !!comerciais?.has(novoDono)
        const whereNeg: any = { leadId: { in: ids }, resultado: null }
        if (comerciais?.size && !novoEhComercial) {
          whereNeg.OR = [{ responsavelUserId: null }, { responsavelUserId: { notIn: [...comerciais] } }]
        }
        await prisma.negotiation.updateMany({
          where: whereNeg,
          data: { responsavelUserId: novoDono ?? null },
        }).catch(() => { /* propagação é best-effort: não derruba a atribuição do lead */ })
        // Última pessoa da comercial com o lead: o novo dono, se for da
        // comercial; senão o dono que está saindo, se era. Fora da transação de
        // quem gravou (esperaria o lock dela).
        if (comerciais?.size) {
          const porPessoa = new Map<number, number[]>()
          for (const l of linhas) {
            if (!ids.includes(l.id)) continue
            const quem = novoEhComercial ? novoDono! : (l.assignedUserId != null && comerciais.has(l.assignedUserId) ? l.assignedUserId : null)
            if (quem == null) continue
            porPessoa.set(quem, [...(porPessoa.get(quem) ?? []), Number(l.id)])
          }
          if (porPessoa.size) setImmediate(() => {
            for (const [quem, leadIds] of porPessoa) {
              prisma.$executeRawUnsafe(
                `UPDATE bychat_leads SET ultimoComercialUserId = ? WHERE id IN (${leadIds.join(',')})`, quem,
              ).catch((e) => console.error('[comercial]', e?.message || e))
            }
          })
        }
      }
      return result
    }
  }
  return next(params)
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
