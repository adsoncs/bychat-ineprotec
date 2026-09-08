// src/lib/metaFieldMap.ts
//
// Casamento entre a pergunta do formulário Meta Lead Ads e o campo do lead.
//
// O rótulo do campo no Lead Ads é livre e, em campanha brasileira, quase sempre
// composto: "nome_do_responsável", "whatsapp_do_responsável". O casamento exato
// que existia aqui (`/^(nome|full_name|phone|…)$/`) não pegava nenhum deles — o
// campo caía em `_formData` e o lead nascia SEM nome e SEM telefone, sem erro
// nenhum na tela. Incidente severiano 05-08/09/2026: 24 leads de anúncio mudos,
// todos reprovados na condição de telefone do workflow de boas-vindas, com o
// nome e o WhatsApp inteiros guardados no payload cru ao lado.
//
// Agora o casamento é por CONTEÚDO do rótulo, excluindo o que fala de terceiro:
// "nome_do_aluno" é o filho, não o contato que vai receber a mensagem.
//
// Fica em lib/ (e não dentro de routes/meta.ts) para ser testável sem subir
// Prisma e as filas — ver tests/metaFieldMap.test.ts.

/** Mapeamento padrão dos campos nativos do Meta (rótulos em inglês). */
export const DEFAULT_FIELD_MAP: Record<string, string> = {
  'full_name': 'nome',
  'first_name': 'nome',
  'last_name': 'nome',
  'email': 'email',
  'phone_number': 'whatsapp',
  'phone': 'whatsapp',
  'company_name': 'empresa',
  'company': 'empresa',
  'city': 'cidade',
  'state': 'cidade',
  'zip_code': 'cidade',
  'job_title': 'segmento',
  'street_address': 'cidade',
}

/** minúsculas, sem acento, separadores virando `_`. */
export function normKey(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

/** Rótulo que descreve outra pessoa/coisa — nunca é o nome do contato. */
const THIRD_PARTY_RE = /(alun|filh|crianc|estudante|escola|colegio|curso|turma|serie|professor|indicad)/

/**
 * Campo núcleo do lead que este rótulo representa, ou null.
 * A ordem importa: um "nome_da_empresa" não pode virar o nome da pessoa.
 */
export function guessCoreField(rawKey: string, label?: string): string | null {
  for (const k of [normKey(rawKey), normKey(label || '')]) {
    if (!k) continue
    if (/(e_?mail)/.test(k)) return 'email'
    if (/(whats|telefone|celular|phone|fone|mobile|^tel$|_tel$|^tel_)/.test(k)) return 'whatsapp'
    if (/(empresa|company|organizacao)/.test(k)) return 'empresa'
    if (/(nome|name)/.test(k) && !THIRD_PARTY_RE.test(k)) return 'nome'
    if (/(cidade|city|municipio)/.test(k)) return 'cidade'
  }
  return null
}

/**
 * Mapeamento automático das perguntas do formulário.
 *
 * Duas passadas de propósito: os campos núcleo (nome/telefone/e-mail) são
 * resolvidos ANTES dos custom fields, porque um lead sem telefone é lead
 * perdido — não abre conversa, não entra em disparo — enquanto um custom field
 * a menos só falta na ficha. Primeiro candidato vence: dois campos "nome" não
 * viram um nome concatenado.
 */
export function buildAutoMapping(questions: any[], cfLookup: Record<string, string>): Record<string, string> {
  const map: Record<string, string> = {}
  const taken = new Set<string>()
  for (const q of questions || []) {
    const key = q?.key || q?.label || ''
    if (!key) continue
    const core = DEFAULT_FIELD_MAP[key] || guessCoreField(key, q?.label)
    if (core && !taken.has(core)) { map[key] = core; taken.add(core) }
  }
  for (const q of questions || []) {
    const key = q?.key || q?.label || ''
    if (!key || map[key]) continue
    map[key] = cfLookup[normKey(key)] || cfLookup[normKey(q?.label || '')] || '_formData'
  }
  return map
}
