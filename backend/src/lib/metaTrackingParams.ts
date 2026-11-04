// src/lib/metaTrackingParams.ts
//
// Parâmetros de rastreamento dos formulários nativos da Meta (Lead Ads).
//
// No formulário, em Configurações → "Parâmetros de rastreamento", a equipe de
// mídia cadastra pares nome/valor ocultos (ex.: Modalidade = Pós Graduação) para
// identificar o formulário. O lead não vê nem responde: o valor é FIXO por
// formulário e a Meta o devolve em todo lead, dentro do `field_data`, com o
// nome do parâmetro como se fosse uma pergunta.
//
// Antes o sistema não pedia `tracking_parameters` ao Graph. O parâmetro não
// estava em `questions`, então nunca aparecia na tela de mapeamento, nunca
// entrava no `fieldMapping` e o valor era descartado em createLeadFromMeta
// (ficava só no MetaLeadLog.rawData). Agora ele é tratado como campo NATIVO:
// cada nome de parâmetro ganha um campo personalizado (grupo "Rastreamento e
// origem") e o destino é imposto em tempo de execução — não depende de alguém
// mapear, e salvar o mapeamento na tela não consegue removê-lo.

import { prisma } from './prisma.js'
import { normKey } from './metaFieldMap.js'

export interface TrackingParam {
  /** Nome do parâmetro como foi digitado na Meta (é também o nome no field_data). */
  key: string
  /** Valor fixo configurado no formulário. */
  value: string
  /** Campo personalizado que recebe o valor (sem o prefixo cf_). */
  customFieldKey: string | null
}

export const TRACKING_FIELD_GROUP = 'rastreamento'

export const TRACKING_FIELD_DESCRIPTION =
  'Campo oculto da Meta (parâmetro de rastreamento). É configurado dentro do formulário nativo, ' +
  'em Lead Ads → Configurações → Parâmetros de rastreamento (nome do parâmetro + valor), e chega ' +
  'preenchido em todo lead daquele formulário. Não precisa mapear: o sistema liga sozinho. ' +
  'Para mudar o valor, edite o parâmetro no formulário, na Meta. Pode ser usado em filtros, ' +
  'workflows e roteamento como qualquer campo.'

/** Lê `tracking_parameters` do Graph (ou do metadata salvo) e descarta lixo. */
export function readTrackingParams(raw: unknown): { key: string; value: string }[] {
  if (!Array.isArray(raw)) return []
  const out: { key: string; value: string }[] = []
  const seen = new Set<string>()
  for (const p of raw) {
    const key = typeof p?.key === 'string' ? p.key.trim() : ''
    const value = p?.value === undefined || p?.value === null ? '' : String(p.value).trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push({ key: key.slice(0, 191), value: value.slice(0, 500) })
  }
  return out
}

/** Parâmetros já resolvidos que estão gravados no metadata do MetaForm. */
export function trackingParamsOf(metadata: unknown): TrackingParam[] {
  const list = (metadata as any)?.trackingParameters
  if (!Array.isArray(list)) return []
  return list
    .filter((p: any) => typeof p?.key === 'string' && p.key)
    .map((p: any) => ({
      key: p.key,
      value: p.value === undefined || p.value === null ? '' : String(p.value),
      customFieldKey: typeof p.customFieldKey === 'string' && p.customFieldKey ? p.customFieldKey : null,
    }))
}

/** Destino imposto: nome do parâmetro → cf_<campo>. Vence o fieldMapping salvo. */
export function trackingMappingOf(metadata: unknown): Record<string, string> {
  const map: Record<string, string> = {}
  for (const p of trackingParamsOf(metadata)) {
    if (p.customFieldKey) map[p.key] = `cf_${p.customFieldKey}`
  }
  return map
}

/**
 * Completa os campos de um lead NOVO com o valor fixo do formulário quando a
 * Meta não o mandou no field_data. Não usar em reprocessamento de lead antigo:
 * o parâmetro pode ter sido criado depois que aquele lead entrou.
 */
export function withTrackingValues(fields: Record<string, string>, metadata: unknown): Record<string, string> {
  const params = trackingParamsOf(metadata)
  if (params.length === 0) return fields
  const out = { ...fields }
  for (const p of params) {
    if (!out[p.key] && p.value) out[p.key] = p.value
  }
  return out
}

/**
 * Resolve os parâmetros de vários formulários reaproveitando a mesma leitura de
 * campos personalizados (sincronizar 70 formulários não pode virar 70 SELECTs).
 */
export function createTrackingResolver() {
  let cache: { key: string; label: string; active: boolean }[] | null = null

  async function fieldFor(paramKey: string): Promise<string | null> {
    const key = normKey(paramKey).slice(0, 100)
    if (!key) return null
    if (!cache) {
      cache = await prisma.customField.findMany({ select: { key: true, label: true, active: true } })
    }
    // Mesmo código (ativo ou não) primeiro: campo inativo é respeitado — não
    // reativamos o que alguém excluiu, mas também não criamos um duplicado.
    // O valor fica guardado no lead e reaparece se o campo for reativado.
    const byKey = cache.find((cf) => cf.key === key)
    if (byKey) return byKey.key
    const byLabel = cache.find((cf) => cf.active && normKey(cf.label) === key)
    if (byLabel) return byLabel.key

    const last = await prisma.customField.findFirst({ orderBy: { position: 'desc' }, select: { position: true } })
    try {
      await prisma.customField.create({
        data: {
          key,
          label: paramKey.trim().slice(0, 191),
          type: 'text',
          description: TRACKING_FIELD_DESCRIPTION,
          group: TRACKING_FIELD_GROUP,
          showInForm: false,
          showInList: false,
          showInKanban: false,
          showInConversation: true,
          position: (last?.position ?? 0) + 1,
          active: true,
        },
      })
      console.log(`[Meta] Campo personalizado "${paramKey}" (${key}) criado para o parâmetro de rastreamento da Meta`)
    } catch (err: any) {
      // Corrida com outra sincronização: o campo já existe, segue com ele.
      if (err?.code !== 'P2002') throw err
    }
    cache.push({ key, label: paramKey, active: true })
    return key
  }

  return async function resolve(raw: unknown): Promise<TrackingParam[]> {
    const out: TrackingParam[] = []
    for (const p of readTrackingParams(raw)) {
      out.push({ ...p, customFieldKey: await fieldFor(p.key) })
    }
    return out
  }
}

/** Mesma lista? (para não regravar o metadata de form que não mudou). */
export function sameTrackingParams(a: TrackingParam[], b: TrackingParam[]): boolean {
  if (a.length !== b.length) return false
  return a.every((p, i) => p.key === b[i].key && p.value === b[i].value && p.customFieldKey === b[i].customFieldKey)
}
