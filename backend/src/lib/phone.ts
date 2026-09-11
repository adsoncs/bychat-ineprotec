// src/lib/phone.ts
//
// Identidade canônica de telefone — fonte ÚNICA de verdade para casar contatos.
// Resolve as 4 fontes de divergência que fragmentavam o mesmo contato em vários
// leads/conversas:
//   1) código de país 55 presente em uns, ausente em outros;
//   2) 9º dígito do celular BR presente em uns, ausente em outros;
//   3) WhatsApp LID (@lid, identificador de privacidade) que NÃO é telefone;
//   4) telefone de OUTRO PAÍS, que não pode ser lido como brasileiro sem DDI.
//
// `phoneKey()` devolve a chave canônica (ex.: "5544991323882") usada para o
// match EXATO. Todas as variações do mesmo número colapsam na mesma chave:
//   44991323882  → 5544991323882
//   554491323882 → 5544991323882   (faltava o 9)
//   5544991323882→ 5544991323882
//   16892064057  → 16892064057     (Estados Unidos, NÃO vira 5516892064057)
//   74607944044732 (LID, 14 díg.) → null  (não é telefone)
//
// Sobre o item 4: até 10/09/2026 todo bloco de 10 ou 11 dígitos era adotado
// como brasileiro sem DDI. O número da Marcia, mãe de aluna do severiano
// (+1 689 206-4057, Flórida), tem exatamente 11 dígitos, então virou
// `5516892064057` — DDD 16, Ribeirão Preto — e o operador tomou onze recusas
// seguidas de "O número 5516892064057 não tem WhatsApp" numa conversa aberta e
// ativa. Quem separa os dois casos é `lib/countryCodes.ts`: celular brasileiro
// tem DDD de lista fechada e o 9 obrigatório, e "16 8 9206-4057" não tem nem
// um nem outro.

import {
  BRASIL,
  DDD_BR,
  bandeira,
  ehE164Br,
  ehE164Plausivel,
  ehNacionalBr,
  separarE164,
  type Pais,
} from './countryCodes.js'

/** Só os dígitos. */
export function onlyDigits(raw: string | null | undefined): string {
  return (raw || '').replace(/\D/g, '')
}

/** Um bloco de dígitos é um telefone BR plausível (DDD válido + 8 ou 9 dígitos)? */
function isBrBlock(d: string): boolean {
  return /^(1[1-9]|[2-9][1-9])\d{8,9}$/.test(d)
}

/** "55" + DDD + número, com o 9º dígito do celular garantido. */
function canonicoBr(nsn: string): string {
  const ddd = nsn.slice(0, 2)
  let num = nsn.slice(2)
  if (num.length === 8) num = '9' + num
  return '55' + ddd + num
}

/**
 * Formulários (sobretudo o Lead Ads da Meta) às vezes chegam com DOIS telefones
 * colados no mesmo campo — ex.: "1898123391718920016015" = 18981233917 +
 * 18920016015. O valor inteiro não é discável e a Meta devolve 131009 ("número
 * no formato incorreto") no disparo. Recupera o PRIMEIRO número quando — e só
 * quando — a divisão é inequívoca: os dois blocos são telefones BR plausíveis.
 * Qualquer outro comprimento estranho (LID de 15 dígitos, ruído) devolve null,
 * para nunca inventar um número a partir de lixo.
 */
export function firstOfConcatenated(raw: string | null | undefined): string | null {
  const d = onlyDigits(raw)
  if (d.length < 20 || d.length > 26) return null
  const candidates: string[] = []
  for (const cut of [10, 11, 12, 13]) {
    const head = d.slice(0, cut)
    const tail = d.slice(cut)
    const headOk = isBrBlock(head) || (head.startsWith('55') && isBrBlock(head.slice(2)))
    const tailOk = isBrBlock(tail) || (tail.startsWith('55') && isBrBlock(tail.slice(2)))
    if (headOk && tailOk) candidates.push(head)
  }
  // Divisão ambígua (mais de um corte válido) → não arrisca.
  return candidates.length === 1 ? candidates[0] : null
}

/**
 * Heurística: parece um WhatsApp LID (não é telefone discável)?
 *
 * O corte não pode ser só de comprimento: o E.164 vai até 15 dígitos e há país
 * que usa isso (Áustria), enquanto o LID tem tipicamente 14–16. O que separa os
 * dois é o PLANO: acima de 13 dígitos, só continua sendo telefone o bloco que
 * casa com DDI + comprimento nacional de algum país. "74607944044732" começa
 * com 7 (Rússia) mas deixa 13 dígitos onde o plano russo aceita 10 — é LID.
 */
export function isLikelyLid(raw: string | null | undefined): boolean {
  const s = (raw || '').toLowerCase()
  if (s.includes('@lid')) return true
  const d = onlyDigits(raw)
  if (d.length <= 13) return false
  return !ehE164Plausivel(d)
}

/**
 * Separa a IDENTIDADE do ENDEREÇO de um contato do WhatsApp.
 *
 * Quando a Meta entrega só o LID (identificador de privacidade) e nem
 * `remoteJidAlt` nem as heurísticas devolvem o número real, o valor que circula
 * pelo código é o LID. Ele serve para RESPONDER — a conversa funciona, e é por
 * isso que ele circula —, mas não é telefone de ninguém.
 *
 * Gravá-lo na coluna `whatsapp` do lead custa caro e em silêncio:
 *
 *  • a mesma pessoa volta com o número real e vira OUTRO lead, porque não há
 *    `waLid` ligando os dois;
 *  • disparo ativo para aquele "número" não chega a lugar nenhum;
 *  • a ficha exibe um telefone que ninguém consegue discar.
 *
 * Medido no severiano em 10/09/2026: 21 leads com LID na coluna de telefone,
 * dos quais 15 sem `waLid` — a convergência que o placeholder prometia nunca
 * poderia acontecer neles.
 *
 * Use no momento de GRAVAR o contato. O endereço de entrega continua sendo o
 * que já era; o que muda é onde cada coisa é guardada.
 */
export function identidadeDoContato(valor: string | null | undefined): {
  /** Telefone de verdade, ou vazio. Nunca um LID. */
  whatsapp: string
  /** O LID, quando o valor era um. É ele que liga esta conversa à pessoa. */
  waLid: string | null
} {
  const bruto = String(valor || '').trim()
  if (!bruto) return { whatsapp: '', waLid: null }
  if (isLikelyLid(bruto) || isGroupJid(bruto)) {
    return { whatsapp: '', waLid: bruto }
  }
  return { whatsapp: bruto, waLid: null }
}

/**
 * É o JID de um grupo do WhatsApp (`120363...@g.us`)?
 *
 * Grupo não é telefone: não passa por phoneKey/toWaNumber (que destroem o
 * sufixo) e só a Evolution entrega nele — a Cloud API oficial não envia a
 * grupos. Usado nos destinos de aviso interno (Empresa › Notificações).
 */
export function isGroupJid(raw: string | null | undefined): boolean {
  return /^\d{5,}@g\.us$/i.test((raw || '').trim())
}

/**
 * Chave canônica de telefone para MATCH. Devolve `null` quando o valor não é um
 * telefone identificável (LID, lixo, curto demais) — o caller NUNCA deve tratar
 * `null` como número.
 *
 * A ordem das decisões é o coração do módulo:
 *
 *   1. Brasil em E.164 ("55" + nacional válido) — o caso de longe mais comum.
 *   2. DDI declarado pelo autor ("+" ou "00" na frente): obedece o que ele
 *      escreveu, mesmo que o resto pareça brasileiro. É a única forma de
 *      resolver ambiguidades reais como +51 9 8765-4321 (Peru), que sem o "+"
 *      é indistinguível de um celular do DDD 51 (Porto Alegre).
 *   3. Brasileiro sem DDI (DDD da lista fechada + estrutura válida) → prefixa 55.
 *   4. Estrangeiro reconhecível (DDI + comprimento nacional do plano do país).
 *   5. Fallback histórico: trata como BR. Preserva a chave de todo o acervo
 *      cadastrado antes disto — mexer nele duplicaria contato.
 */
export function phoneKey(raw: string | null | undefined): string | null {
  // Um "@lid" explícito é identificador de privacidade, nunca telefone.
  if (String(raw || '').toLowerCase().includes('@lid')) return null

  const bruto = String(raw ?? '')
  // "+55 11 …" ou "00 1 689 …": quem preencheu DECLAROU o país. A informação
  // se perde em `onlyDigits`, então é lida aqui, antes.
  const ddiDeclarado = /^\s*(\+|00\d)/.test(bruto)

  let d = onlyDigits(bruto)
  if (!d) return null
  // Remove prefixo de discagem internacional "00".
  d = d.replace(/^00/, '')
  // DDI 55 repetido ("555518…", acontece quando um caminho já normalizado é
  // normalizado de novo por outro que também prefixa). Roda ANTES do corte por
  // comprimento, senão "555518981233917" (15 díg.) seria descartado como LID.
  while (/^55(55(?:1[1-9]|[2-9][1-9])9?\d{8})$/.test(d)) d = d.slice(2)
  // DDD escrito no formato antigo de discagem, com zero à esquerda: "018998128130"
  // (operadora + DDD) e "5501899…". Sem isso o número cai no fallback "outro país"
  // e sai do CRM sem o 55 — foi o caso do lead 156 (Meta Lead Ads).
  if (/^0[1-9][1-9]\d{8,9}$/.test(d)) d = d.slice(1)
  else if (/^550[1-9][1-9]\d{8,9}$/.test(d)) d = '55' + d.slice(3)

  if (d.length > 15) {
    // Acima do teto do E.164: LID, ruído — ou dois números colados no mesmo
    // campo de formulário, único caso recuperável (divisão inequívoca).
    const first = firstOfConcatenated(d)
    if (!first) return null
    d = first
  }

  // 1) Brasil em E.164.
  if (ehE164Br(d)) return canonicoBr(d.slice(2))

  // 2) DDI declarado: a palavra de quem preencheu vale mais que a heurística.
  if (ddiDeclarado) {
    const sep = separarE164(d)
    if (sep && sep.ddi !== '55') return d
  }

  // 3) Brasileiro sem o 55.
  if (ehNacionalBr(d)) return canonicoBr(d)

  // 4) Estrangeiro reconhecível pelo plano de numeração do país.
  //    O piso de 6 dígitos evita adotar ramal ou número parcial como se fosse
  //    telefone; abaixo disso nem os planos mais curtos (Niue, Santa Helena)
  //    chegam.
  if (d.length >= 6) {
    const sep = separarE164(d)
    if (sep && sep.ddi !== '55') {
      // Terreno disputado: 10 ou 11 dígitos começando por um DDD brasileiro de
      // verdade é a forma de um telefone daqui sem o 55. Um cadastro
      // incompleto ("5513301130005" quer dizer DDD 13 e nada mais) casaria com
      // algum DDI por sorte e o contato brasileiro viraria estrangeiro — pior
      // que o problema original, porque quebra conversa que funciona. Aqui só
      // vale prova ESTRUTURAL do plano do outro país, não coincidência de
      // comprimento.
      const disputado = (d.length === 10 || d.length === 11) && DDD_BR.has(d.slice(0, 2))
      if (!disputado || sep.forte) return d
    }
  }

  // Comprido demais para telefone brasileiro e sem plano de país que o aceite:
  // LID ou ruído.
  if (d.length > 13) return null
  if (d.length < 10) return null // sem DDD não dá pra identificar com segurança

  // 5) Fallback histórico — mesmo resultado de antes de existirem os passos 1-4.
  let core: string // DDD + número, sem o 55
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    core = d.slice(2)
  } else if (d.length === 10 || d.length === 11) {
    core = d
  } else {
    // Formato fora de qualquer padrão: usa os dígitos como chave estável.
    return d
  }

  const ddd = core.slice(0, 2)
  let num = core.slice(2)
  if (num.length === 8) num = '9' + num // insere o 9º dígito do celular
  if (num.length !== 9) return d.length >= 10 ? '55' + core : d // fallback defensivo
  return '55' + ddd + num
}

/** Telefone para EXIBIÇÃO/ENVIO (canônico se BR; senão os dígitos). */
export function displayPhone(raw: string | null | undefined): string {
  return phoneKey(raw) ?? onlyDigits(raw)
}

/**
 * Número pronto para DISCAGEM nas APIs de WhatsApp (Evolution e Cloud API), em
 * dígitos com DDI: "5518998196075". Devolve `null` quando o valor não é um
 * telefone discável (LID, sem DDD, lixo) — nesse caso o caller deve ABORTAR o
 * envio com erro explicativo em vez de mandar para a API e colecionar
 * `exists:false` (Evolution) ou 131009 (Meta).
 *
 * Um JID completo ("...@lid", "...@g.us") NÃO passa por aqui: é identificador de
 * sessão, não telefone — quem envia deve repassá-lo intacto.
 */
export function toWaNumber(raw: string | null | undefined): string | null {
  const key = phoneKey(raw)
  if (!key) return null
  // Teto e piso do E.164. Número estrangeiro curto (Faroé, Groenlândia) só
  // passa quando o plano do país o reconheceu — foi o passo 4 do phoneKey.
  if (key.length < 6 || key.length > 15) return null
  if (key.length < 10 && !ehE164Plausivel(key)) return null
  return key
}

/** Dois valores representam o mesmo contato telefônico? */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = phoneKey(a)
  const kb = phoneKey(b)
  return ka !== null && ka === kb
}

export interface PaisDoTelefone {
  /** DDI sem "+". */
  ddi: string
  /** ISO 3166-1 alpha-2, já desambiguado no NANP (809 → DO, não US). */
  iso: string
  /** Nome do país em português. */
  nome: string
  /** Bandeira em emoji. */
  bandeira: string
  /** Número nacional, sem o DDI. */
  nacional: string
  /** É o Brasil? Atalho para as telas, que só destacam o que é de fora. */
  brasileiro: boolean
  /**
   * O país foi confirmado pela ESTRUTURA do número (código de área e central
   * válidos), não só pelo comprimento. Só o NANP tem essa prova hoje. É o que
   * autoriza uma correção automática de cadastro — coincidência de comprimento
   * não autoriza.
   */
  estrutural: boolean
}

/**
 * De que país é este telefone? `null` quando o valor não é telefone (LID, lixo)
 * ou quando nenhum plano de numeração o reconhece.
 *
 * É o que permite a ficha do contato dizer "🇺🇸 Estados Unidos" em vez de deixar
 * o operador achar que o cadastro está errado.
 */
export function paisDoTelefone(raw: string | null | undefined): PaisDoTelefone | null {
  const key = phoneKey(raw)
  if (!key) return null
  const sep = separarE164(key)
  if (!sep) return null
  return {
    ddi: sep.ddi,
    iso: sep.iso,
    nome: sep.nome,
    bandeira: bandeira(sep.iso),
    nacional: sep.nsn,
    brasileiro: sep.ddi === '55',
    estrutural: sep.forte,
  }
}

/** O telefone é de fora do Brasil? (Valor não reconhecido conta como BR.) */
export function ehEstrangeiro(raw: string | null | undefined): boolean {
  const p = paisDoTelefone(raw)
  return p !== null && !p.brasileiro
}

/**
 * Telefone em formato de leitura.
 *   BR   → "(18) 99692-9494"
 *   NANP → "+1 (689) 206-4057"
 *   demais → "+351 912 345 678" (blocos de 3, o resto na frente)
 */
export function formatarTelefone(raw: string | null | undefined): string {
  const key = phoneKey(raw)
  if (!key) return onlyDigits(raw)
  const sep = separarE164(key)
  if (!sep) return `+${key}`

  if (sep.ddi === '55') {
    const ddd = sep.nsn.slice(0, 2)
    const resto = sep.nsn.slice(2)
    const meio = resto.length === 9
      ? `${resto.slice(0, 5)}-${resto.slice(5)}`
      : `${resto.slice(0, 4)}-${resto.slice(4)}`
    return `(${ddd}) ${meio}`
  }

  if (sep.ddi === '1' && sep.nsn.length === 10) {
    return `+1 (${sep.nsn.slice(0, 3)}) ${sep.nsn.slice(3, 6)}-${sep.nsn.slice(6)}`
  }

  // Agrupamento genérico da direita para a esquerda, em blocos de 3.
  const blocos: string[] = []
  let resto = sep.nsn
  while (resto.length > 3) {
    blocos.unshift(resto.slice(-3))
    resto = resto.slice(0, -3)
  }
  if (resto) blocos.unshift(resto)
  return `+${sep.ddi} ${blocos.join(' ')}`
}

/**
 * Outras grafias plausíveis do MESMO telefone, para tentar quando o WhatsApp
 * disser que o número não existe.
 *
 * Existe por causa do lead 841 do severiano (Ideal Cartuchos, 09/09/2026): a
 * loja atende num FIXO com WhatsApp Business, (18) 3623-4401. O `phoneKey`
 * acima insere o nono dígito em todo número de 8 dígitos — inclusive em fixo —,
 * então o cadastro virou `5518936234401`, que não existe. A Evolution recusava,
 * a operadora tentou 13 vezes em 9 minutos e nenhuma mensagem saiu; consultada
 * a grafia sem o 9, a mesma Evolution respondeu `exists: true` com o nome da
 * loja.
 *
 * Aqui só geramos candidatos para CONSULTA e ENVIO — a identidade do contato
 * (`phoneKey`) fica intocada de propósito: ela é a chave que junta lead,
 * mensagem e conversa, e mudá-la é outro assunto, com risco de duplicar
 * contato.
 *
 * No Brasil o nono dígito é dos CELULARES, cujo número começa em 9 (antes,
 * 6-9). Fixo começa em 2-5 — daí a distinção abaixo. Telefone de fora do Brasil
 * não tem variante: o plano é outro e chutar dígito ali só geraria consulta a
 * número de terceiro.
 */
export function variantesDeDiscagem(raw: string | null | undefined): string[] {
  const d = onlyDigits(raw)
  if (!d || isLikelyLid(d)) return []
  if (ehEstrangeiro(d)) return []

  const fora: string[] = []
  const push = (v: string) => { if (v !== d && !fora.includes(v)) fora.push(v) }

  // 55 + DDD + 9 + 8 dígitos, e o primeiro deles é de FIXO (2-5): o 9 foi posto
  // por engano na normalização. A grafia real é sem ele.
  const comNoveIndevido = /^(55[1-9][1-9])9([2-5]\d{7})$/.exec(d)
  if (comNoveIndevido) push(comNoveIndevido[1] + comNoveIndevido[2])

  // 55 + DDD + 8 dígitos começando em 6-9: celular de antes do nono dígito,
  // que hoje só atende com ele.
  const semNove = /^(55[1-9][1-9])([6-9]\d{7})$/.exec(d)
  if (semNove) push(semNove[1] + '9' + semNove[2])

  return fora
}

export { BRASIL, bandeira, separarE164 }
export type { Pais }
