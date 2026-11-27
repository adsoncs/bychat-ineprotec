// Endereço pelo CEP no portal do aluno (inscrição, atendimento e "Completar
// cadastro"). Mesma busca do painel (backend lib/cep.ts: cache e troca de
// provedor), pela rota pública /api/public/portals/cep/:cep.
//
// Regra: só preenche campo que existe NA TELA e que está vazio (ou que a própria
// busca preencheu antes, quando a pessoa troca o CEP). O que a pessoa digitou não
// é apagado. Sem resposta (CEP inexistente, busca fora do ar), nada muda: ela
// preenche à mão.

interface EnderecoDoCep { cep: string; logradouro: string; bairro: string; municipio: string; uf: string }
type Resultado = { situacao: 'encontrado'; endereco: EnderecoDoCep } | { situacao: 'nao_encontrado' } | { situacao: 'indisponivel' }

/** Chaves de CEP reconhecidas (catálogo e formulários antigos). */
const CHAVES_DE_CEP = ['cep', 'enderecoCep', 'cepResidencial']
/** Onde cada parte cai. O catálogo usa logradouro/municipio; formulários antigos, endereco/cidade/estado. */
const DESTINOS: Record<'logradouro' | 'bairro' | 'municipio' | 'uf', string[]> = {
  logradouro: ['logradouro', 'endereco', 'rua'],
  bairro: ['bairro'],
  municipio: ['municipio', 'cidade'],
  uf: ['uf', 'estado'],
}

const memoria = new Map<string, Promise<Resultado | null>>()

function buscar(digitos: string): Promise<Resultado | null> {
  let p = memoria.get(digitos)
  if (!p) {
    p = fetch(`/api/public/portals/cep/${digitos}`, { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<Resultado>) : null))
      .catch(() => null)
    memoria.set(digitos, p)
    // Falha de rede não fica guardada: a próxima tentativa vai de novo.
    p.then((r) => { if (!r) memoria.delete(digitos) })
  }
  return p
}

export const ehCampoDeCep = (nome: string) => CHAVES_DE_CEP.includes(nome)

/** O que a busca preencheu por último em cada tela (para trocar o CEP sem apagar o digitado). */
export type Preenchidos = Record<string, string>

/**
 * Chamar quando um campo de CEP muda. `campos`: nomes (e opções, se for lista)
 * dos campos da tela. `ler` devolve o valor atual; `definir` grava. Devolve o
 * nome do campo que deve receber o foco (o número), se houver.
 */
export async function preencherPeloCep(opts: {
  cep: string
  campos: Array<{ name: string; options?: string[] | undefined }>
  ler: (nome: string) => string
  definir: (nome: string, valor: string) => void
  preenchidos: Preenchidos
}): Promise<string | null> {
  const d = opts.cep.replace(/\D+/g, '')
  if (d.length !== 8) return null
  const r = await buscar(d)
  if (!r || r.situacao !== 'encontrado') return null
  // A pessoa mudou o CEP enquanto buscava: ignora a resposta velha.
  if (opts.ler(CHAVES_DE_CEP.find((k) => opts.campos.some((c) => c.name === k)) ?? 'cep').replace(/\D+/g, '') !== d) return null
  const e = r.endereco
  let algum = false
  for (const parte of Object.keys(DESTINOS) as Array<keyof typeof DESTINOS>) {
    const valor = String(e[parte] ?? '').trim()
    if (!valor) continue
    for (const nome of DESTINOS[parte]) {
      const campo = opts.campos.find((c) => c.name === nome)
      if (!campo) continue
      const atual = opts.ler(nome).trim()
      if (atual && atual !== opts.preenchidos[nome]) continue // digitado pela pessoa: não mexe
      let final = valor
      if (campo.options?.length) {
        const igual = campo.options.find((o) => o.trim().toLowerCase() === valor.toLowerCase())
          ?? campo.options.find((o) => o.trim().toUpperCase().startsWith(`${valor.toUpperCase()} `) || o.trim().toUpperCase().endsWith(`(${valor.toUpperCase()})`))
        if (!igual) continue
        final = igual
      }
      opts.definir(nome, final)
      opts.preenchidos[nome] = final
      algum = true
    }
  }
  if (!algum) return null
  const numero = ['numero', 'enderecoNumero'].find((n) => opts.campos.some((c) => c.name === n))
  return numero && !opts.ler(numero).trim() ? numero : null
}

/** Foco no campo do número depois de preencher (id do input = prefixo + nome). */
export function focar(prefixo: string, nome: string | null) {
  if (!nome) return
  setTimeout(() => (document.getElementById(`${prefixo}${nome}`) as HTMLInputElement | null)?.focus(), 30)
}
