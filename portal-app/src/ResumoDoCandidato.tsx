// Bloco de cima do portal do candidato: quem é (anonimizado — LGPD) e o resumo
// da inscrição, num cartão só. Os dados vêm mascarados do servidor
// (/registrations/:code/resumo): o completo nem chega ao navegador.
// As ações da conta (senha, comprovante, sair) entram como filhos.
import { useEffect, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'

interface Resumo {
  candidato: { nome: string; email: string | null; whatsapp: string | null; cpf: string | null }
  inscricao: {
    codigo: string; situacao: string; portal: string | null; curso: string | null; oferta: string | null; modalidade: string | null; turno: string | null
    unidade?: string | null; polo?: string | null; ingresso?: string | null
  }
  pagamento: { valorCheio: number | null; cupom: string | null; desconto: number; valor: number | null; meio: string | null; parcelas: number; pago: boolean } | null
}

const SITUACAO: Record<string, string> = {
  draft: 'Rascunho', pending: 'Em andamento', submitted: 'Enviada', paid: 'Paga',
  docs_uploaded: 'Documentos enviados', docs_reviewing: 'Documentos em análise', docs_approved: 'Documentos aprovados',
  docs_rejected: 'Documentos recusados', reviewing: 'Em análise', approved: 'Aprovada', enrolled: 'Matriculado(a)',
  rejected: 'Não aprovada', cancelled: 'Cancelada', expired: 'Expirada',
}
/**
 * Cor do selo da situação: em andamento = laranja, concluída = verde,
 * cancelada/recusada = vermelho. "Enviada" é um sucesso da pessoa (ela fez a
 * parte dela): fica na cor da marca do portal (Branding) — classe vazia usa o
 * estilo base do .rc-situacao.
 */
export function tomDaSituacao(status: string): 'pendente' | 'ok' | 'erro' | '' {
  if (status === 'submitted') return ''
  if (['paid', 'approved', 'enrolled', 'docs_approved'].includes(status)) return 'ok'
  if (['rejected', 'cancelled', 'expired', 'docs_rejected'].includes(status)) return 'erro'
  return 'pendente'
}
const MEIO: Record<string, string> = { pix: 'Pix', boleto: 'Boleto', credit_card: 'Cartão' }
const reais = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))

export function ResumoDoCandidato(props: {
  codigo: string; token: string; children?: ComponentChildren
  /** Portal logado: mostra "Editar meus dados" (nome, e-mail e WhatsApp). */
  podeEditar?: boolean
  /** Portal da inscrição — o link "faça uma nova inscrição" do aviso. */
  portalSlug?: string | null
  aoSalvar?: (eu: unknown) => void
  /** Portal logado (a sessão é da própria pessoa): o nome completo, como ela
   *  cadastrou — atualiza na hora quando ela edita. Sem ele, só o abreviado. */
  nomeCompleto?: string | null
  /** Edição controlada por fora (menu da conta no topo). */
  editando?: boolean
  aoMudarEdicao?: (v: boolean) => void
}) {
  const [r, setR] = useState<Resumo | null>(null)
  const [versao, setVersao] = useState(0)
  const [editandoLocal, setEditandoLocal] = useState(false)
  const editando = props.editando ?? editandoLocal
  const setEditando = (v: boolean) => { if (props.aoMudarEdicao) props.aoMudarEdicao(v); else setEditandoLocal(v) }
  useEffect(() => {
    fetch(`/api/public/registrations/${encodeURIComponent(props.codigo)}/resumo`, { headers: { Authorization: `Bearer ${props.token}` } })
      .then((x) => (x.ok ? x.json() : null)).then(setR).catch(() => {})
  }, [props.codigo, props.token, versao])

  if (!r) return <div class="cartao"><div class="esqueleto" style="height:150px" /></div>
  const i = r.inscricao
  const p = r.pagamento
  const modalidade = [i.modalidade, i.turno].filter(Boolean).join(' · ')
  // Duas partes: em cima, a pessoa (nome, e-mail, WhatsApp e o código da
  // inscrição); embaixo, a inscrição na ordem unidade → ingresso → curso →
  // modalidade. O valor, quando há cobrança, fecha o cartão.
  return (
    <div class="cartao resumo-candidato">
      <div class="rc-topo">
        <h2>Olá, {props.nomeCompleto ? props.nomeCompleto.trim().split(/\s+/)[0] : r.candidato.nome} <span aria-hidden="true">👋</span></h2>
        <span class={`rc-situacao ${tomDaSituacao(i.situacao)}`}>{SITUACAO[i.situacao] ?? i.situacao}</span>
      </div>
      {editando ? (
        <EditarDados cpf={r.candidato.cpf} portalSlug={props.portalSlug}
          aoCancelar={() => setEditando(false)}
          aoSalvar={(eu) => { setEditando(false); setVersao((v) => v + 1); props.aoSalvar?.(eu) }} />
      ) : (
        <>
          <dl class="rc-dados">
            {props.nomeCompleto && <div><dt>Nome</dt><dd>{props.nomeCompleto}</dd></div>}
            {r.candidato.email && <div><dt>E-mail</dt><dd>{r.candidato.email}</dd></div>}
            {r.candidato.whatsapp && <div><dt>WhatsApp</dt><dd>{r.candidato.whatsapp}</dd></div>}
            <div><dt>Inscrição</dt><dd><b>{i.codigo}</b></dd></div>
          </dl>
          {props.podeEditar && props.editando === undefined && (
            <div class="rc-editar"><button type="button" class="botao-contorno" onClick={() => setEditando(true)}>Editar meus dados</button></div>
          )}
        </>
      )}
      <dl class="rc-dados">
        {i.unidade && <div class="rc-largo"><dt>Unidade</dt><dd>{i.unidade}{i.polo && <span class="rc-mini">{i.polo}</span>}</dd></div>}
        {i.ingresso && <div class="rc-largo"><dt>Tipo de ingresso</dt><dd>{i.ingresso}</dd></div>}
        {i.curso && <div class="rc-largo"><dt>Curso</dt><dd>{i.curso}{i.oferta && i.oferta !== i.curso && <span class="rc-mini">{i.oferta}</span>}</dd></div>}
        {modalidade && <div class="rc-largo"><dt>Modalidade</dt><dd>{modalidade}</dd></div>}
        {p && (
          <div class="rc-largo">
            <dt>{p.pago ? 'Valor pago' : 'Valor a pagar'}</dt>
            <dd>
              <b>{reais(p.valor)}</b>
              {[p.meio && MEIO[p.meio], p.parcelas > 1 && `${p.parcelas}x`].filter(Boolean).length > 0 && <span> · {[p.meio && MEIO[p.meio], p.parcelas > 1 && `${p.parcelas}x`].filter(Boolean).join(' · ')}</span>}
              {p.desconto > 0 && (
                <span class="rc-mini">de <s>{reais(p.valorCheio)}</s> · desconto {reais(p.desconto)}{p.cupom ? ` (cupom ${p.cupom})` : ''}</span>
              )}
            </dd>
          </div>
        )}
      </dl>
      {props.children && <div class="rc-acoes">{props.children}</div>}
    </div>
  )
}

/** 5562991138484 → (62) 99113-8484 (BR); outros formatos ficam como estão. */
function telefoneLegivel(t: string): string {
  const d = t.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return t
}

/**
 * Edição dos dados de contato no portal logado: nome, e-mail e WhatsApp, com
 * os valores completos (a sessão é da própria pessoa). CPF e dados da
 * inscrição ficam de fora — o servidor também recusa (POST /portal/meus-dados).
 */
function EditarDados(props: { cpf: string | null; portalSlug?: string | null; aoCancelar: () => void; aoSalvar: (eu: unknown) => void }) {
  const [v, setV] = useState<{ nome: string; email: string; whatsapp: string } | null>(null)
  const [erros, setErros] = useState<Record<string, string>>({})
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  useEffect(() => {
    fetch('/api/public/portal/eu', { credentials: 'same-origin' })
      .then((x) => (x.ok ? x.json() : null))
      .then((j) => setV({ nome: j?.eu?.nome ?? '', email: j?.eu?.email ?? '', whatsapp: telefoneLegivel(j?.eu?.whatsapp ?? '') }))
      .catch(() => setErro('Não foi possível carregar seus dados.'))
  }, [])

  async function salvar(e: Event) {
    e.preventDefault()
    if (!v) return
    setSalvando(true); setErro(null); setErros({})
    try {
      const x = await fetch('/api/public/portal/meus-dados', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(v),
      })
      const j = await x.json().catch(() => ({}))
      if (!x.ok) { setErros(j.erros || {}); throw new Error(j.error || 'Não foi possível salvar.') }
      props.aoSalvar(j.eu)
    } catch (e: any) { setErro(e.message); setSalvando(false) }
  }

  if (!v) return <div class="esqueleto" style="height:220px;margin-top:16px" />
  const campo = (nome: 'nome' | 'email' | 'whatsapp', rotulo: string, tipo: string, extra: Record<string, string> = {}) => (
    <div class={`campo ${erros[nome] ? 'ruim' : ''}`}>
      <label for={`md-${nome}`}>{rotulo}</label>
      <input id={`md-${nome}`} type={tipo} value={v[nome]} required {...extra}
        onInput={(e: any) => setV({ ...v, [nome]: e.currentTarget.value })} />
      {erros[nome] && <span class="erro">{erros[nome]}</span>}
    </div>
  )
  return (
    <form class="rc-form" onSubmit={salvar}>
      {campo('nome', 'Nome completo', 'text', { autocomplete: 'name' })}
      {campo('email', 'E-mail', 'email', { autocomplete: 'email', inputMode: 'email' })}
      {campo('whatsapp', 'WhatsApp', 'tel', { autocomplete: 'tel', inputMode: 'tel', placeholder: '(00) 00000-0000' })}
      <div class="campo">
        <label for="md-cpf">CPF</label>
        <input id="md-cpf" value={props.cpf ?? ''} disabled />
      </div>
      <p class="sub rc-aviso">
        O e-mail é o seu acesso ao portal. CPF e os dados da inscrição (unidade, tipo de ingresso, curso e modalidade) não podem ser alterados — se algo da inscrição estiver errado,{' '}
        {props.portalSlug ? <a href={`/portal/${props.portalSlug}`}>faça uma nova inscrição</a> : 'faça uma nova inscrição'}.
      </p>
      {erro && <div class="aviso erro">{erro}</div>}
      <div class="acoes" style="margin-top:4px">
        <button class="principal" type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
        <button class="secundario" type="button" onClick={props.aoCancelar} disabled={salvando}>Cancelar</button>
      </div>
    </form>
  )
}
