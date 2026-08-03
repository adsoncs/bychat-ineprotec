import { PrismaClient } from '@prisma/client'
import { phoneKey } from './phone.js'
import { decryptSettingValue, encryptSettingValue, isSecretSettingKey } from './secretSettings.js'

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

  // JID completo (@lid, @g.us) é identificador de sessão, não telefone — intacto.
  if (key && !raw.includes('@') && raw.replace(/\D/g, '') !== key) {
    if (isSet) w.set = key
    else data.whatsapp = key
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
  if (isSecretSettingKey(row.key) && 'value' in row) row.value = decryptSettingValue(row.value)
  return row
}

prisma.$use(async (params, next) => {
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
      const raw = params.args.data.assignedUserId
      const novoDono = raw && typeof raw === 'object' && 'set' in raw ? raw.set : raw
      const whereId = params.args?.where?.id
      const ids: number[] = typeof whereId === 'number'
        ? [whereId]
        : (await prisma.lead.findMany({ where: params.args?.where ?? {}, select: { id: true } })).map((l) => l.id)
      const result = await next(params)
      if (ids.length) {
        await prisma.negotiation.updateMany({
          where: { leadId: { in: ids }, resultado: null },
          data: { responsavelUserId: novoDono ?? null },
        }).catch(() => { /* propagação é best-effort: não derruba a atribuição do lead */ })
      }
      return result
    }
  }
  return next(params)
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
