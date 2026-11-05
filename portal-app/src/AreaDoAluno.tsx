// "Meu Portal" — área do aluno no portal logado (04/11/2026).
//
// Depois da inscrição enviada, o portal deixa de ser só a lista de etapas: o
// aluno vê as faturas (pagas e em aberto), os documentos, o contrato/termo
// assinado e, quando o AVA for integrado, o acesso às aulas. Liga por
// instituição (Setting `portal_area_aluno`); o servidor é que decide
// (/api/public/portal/area) — desligada, Portal.tsx segue como sempre foi.
//
// Abas pelo endereço (#financeiro, #documentos…), para o voltar do navegador e
// links diretos funcionarem. No celular as abas viram uma barra no rodapé.
import { useEffect, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { Jornada } from './Jornada'
import { Documentos } from './Documentos'
import { ResumoDoCandidato, tomDaSituacao } from './ResumoDoCandidato'
import { carregarCandidato, type Candidato, type carregarJornadaDoPortal } from './api'

type Situacao = 'paga' | 'aberta' | 'vencida' | 'cancelada' | 'estornada' | 'prevista'
interface Fatura {
  chave: string; titulo: string; detalhe: string | null; valor: number; vencimento: string | null
  situacao: Situacao; pagaEm: string | null; meio: string | null
  pagar: string | null; boletoPdf: string | null; recibo: string | null
  pix: string | null; linha: string | null; buscarCodigos: boolean; podeGerar: boolean
}
interface Contrato { id: number; titulo: string; forma: 'eletronica' | 'aceite' | 'papel'; situacao: 'assinado' | 'aguardando'; assinadoEm: string | null; temPdf: boolean }
export interface Area {
  ativa: true; modo: 'aluno'
  inscricao: { id: number; codigo: string; status: string; curso: string; portal: string | null; portalSlug: string | null; criadaEm: string }
  inscricoes: Array<{ codigo: string; curso: string; status: string }>
  token: string
  financeiro: { faturas: Fatura[]; aviso: string | null; proxima: Fatura | null; emAberto: number; vencidas: number; pagas: number }
  contratos: Contrato[]
  ava: { disponivel: boolean; url: string | null; usuario?: string | null; curso?: string | null; suspenso?: boolean }
}
type JornadaDoPortal = Awaited<ReturnType<typeof carregarJornadaDoPortal>>

const ABAS = [
  { id: 'inicio', rotulo: 'Início' },
  { id: 'financeiro', rotulo: 'Financeiro' },
  { id: 'documentos', rotulo: 'Documentos' },
  { id: 'contratos', rotulo: 'Contratos' },
  { id: 'ava', rotulo: 'AVA' },
] as const
type Aba = typeof ABAS[number]['id']

const STATUS: Record<string, string> = {
  submitted: 'Inscrição enviada', paid: 'Pagamento confirmado', docs_uploaded: 'Documentos enviados',
  docs_reviewing: 'Documentos em análise', docs_approved: 'Documentos aprovados', docs_rejected: 'Documento recusado',
  reviewing: 'Em análise', approved: 'Aprovado', enrolled: 'Matriculado', rejected: 'Não aprovado',
  cancelled: 'Cancelada', expired: 'Expirada',
}
const SITUACAO: Record<Situacao, { rotulo: string; tom: string }> = {
  paga: { rotulo: 'Paga', tom: 'ok' },
  aberta: { rotulo: 'Em aberto', tom: 'pendente' },
  vencida: { rotulo: 'Vencida', tom: 'erro' },
  cancelada: { rotulo: 'Cancelada', tom: 'neutro' },
  estornada: { rotulo: 'Estornada', tom: 'neutro' },
  prevista: { rotulo: 'Prevista', tom: 'neutro' },
}
const FORMA: Record<Contrato['forma'], string> = {
  eletronica: 'Assinatura eletrônica', aceite: 'Aceite eletrônico no portal', papel: 'Assinado no papel',
}

const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
/** "2026-12-10" ou ISO → 10/12/2026, sem o fuso mudar o dia. */
const dia = (v: string | null) => {
  if (!v) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : new Date(v).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

const abaDoEndereco = (): Aba => {
  const h = location.hash.replace('#', '')
  return (ABAS.some((a) => a.id === h) ? h : 'inicio') as Aba
}

export function AreaDoAluno(props: {
  area: Area; nome: string; jornada: JornadaDoPortal | null
  editando: boolean; aoMudarEdicao: (v: boolean) => void; aoSalvarDados: (eu: unknown) => void
  aoTrocarInscricao: (codigo: string) => void; aoRecarregar: () => void
}) {
  const { area } = props
  const [aba, setAba] = useState<Aba>(abaDoEndereco)
  const [cand, setCand] = useState<Candidato | null>(null)
  const [versaoDocs, setVersaoDocs] = useState(0)

  useEffect(() => {
    const ao = () => setAba(abaDoEndereco())
    addEventListener('hashchange', ao)
    return () => removeEventListener('hashchange', ao)
  }, [])
  useEffect(() => { carregarCandidato(area.token).then(setCand).catch(() => setCand(null)) }, [area.token, versaoDocs])
  // "Editar meus dados" (menu do topo) mora no Início.
  useEffect(() => { if (props.editando && aba !== 'inicio') ir('inicio') }, [props.editando])

  function ir(a: Aba) {
    if (a === aba) return
    history.pushState(null, '', a === 'inicio' ? location.pathname + location.search : `#${a}`)
    setAba(a)
    scrollTo({ top: 0, behavior: 'smooth' })
  }

  const docs = resumoDosDocumentos(cand)
  const etapasAbertas = props.jornada && props.jornada.inscricao.candidateCode === area.inscricao.codigo
    ? props.jornada.etapas.filter((e) => e.situacao !== 'feito') : []
  const primeiro = props.nome.trim().split(/\s+/)[0] || ''
  const alertas = { financeiro: area.financeiro.vencidas > 0, documentos: docs.recusados > 0 || docs.faltam > 0 }

  return (
    <div class="ada">
      <header class="ada-capa">
        <div class="ada-capa-texto">
          <span class="ada-sobre">Meu Portal</span>
          <h1>Olá, {primeiro}</h1>
          <p>{area.inscricao.curso}</p>
        </div>
        <div class="ada-capa-meta">
          <span class={`ada-selo ${tomDaSituacao(area.inscricao.status) || 'marca'}`}>{STATUS[area.inscricao.status] ?? area.inscricao.status}</span>
          <span class="ada-codigo">Inscrição <b>{area.inscricao.codigo}</b></span>
          {area.inscricoes.length > 1 && (
            <label class="ada-troca">
              <span class="ada-oculto">Trocar de inscrição</span>
              <select value={area.inscricao.codigo} onChange={(e) => props.aoTrocarInscricao((e.target as HTMLSelectElement).value)}>
                {area.inscricoes.map((i) => <option key={i.codigo} value={i.codigo}>{i.curso} · {i.codigo}</option>)}
              </select>
            </label>
          )}
        </div>
      </header>

      <nav class="ada-abas" aria-label="Seções do portal">
        {ABAS.map((a) => (
          <button key={a.id} type="button" class={`ada-aba${aba === a.id ? ' ativa' : ''}`} aria-current={aba === a.id ? 'page' : undefined} onClick={() => ir(a.id)}>
            <Icone nome={a.id} />
            <span>{a.rotulo}</span>
            {(alertas as any)[a.id] && <i class="ada-ponto" aria-label="requer atenção" />}
          </button>
        ))}
      </nav>

      {aba === 'inicio' && (
        <section class="ada-secao" aria-label="Início">
          <div class="ada-resumos">
            <CartaoResumo icone="financeiro" titulo="Financeiro" tom={area.financeiro.vencidas ? 'erro' : area.financeiro.proxima ? 'pendente' : 'ok'}
              valor={area.financeiro.proxima ? reais(area.financeiro.proxima.valor) : area.financeiro.faturas.length ? 'Em dia' : 'Sem faturas'}
              legenda={area.financeiro.proxima
                ? `${area.financeiro.proxima.situacao === 'vencida' ? 'Venceu em' : 'Vence em'} ${dia(area.financeiro.proxima.vencimento)}`
                : area.financeiro.pagas ? `${area.financeiro.pagas} ${area.financeiro.pagas === 1 ? 'fatura paga' : 'faturas pagas'}` : 'Nada a pagar agora'}
              acao={area.financeiro.proxima ? 'Ver e pagar' : 'Ver faturas'} aoClicar={() => ir('financeiro')} />
            <CartaoResumo icone="documentos" titulo="Documentos" tom={docs.recusados ? 'erro' : docs.faltam ? 'pendente' : docs.total ? 'ok' : 'neutro'}
              valor={docs.total ? `${docs.aprovados} de ${docs.total}` : '—'}
              legenda={docs.recusados ? `${docs.recusados} recusado(s) — reenvie` : docs.faltam ? `${docs.faltam} a enviar` : docs.emAnalise ? `${docs.emAnalise} em análise` : docs.total ? 'Todos aprovados' : 'Nenhum exigido'}
              acao="Ver documentos" aoClicar={() => ir('documentos')} />
            <CartaoResumo icone="contratos" titulo="Contrato" tom={area.contratos.some((c) => c.situacao === 'assinado') ? 'ok' : area.contratos.length ? 'pendente' : 'neutro'}
              valor={area.contratos.some((c) => c.situacao === 'assinado') ? 'Assinado' : area.contratos.length ? 'Aguardando' : '—'}
              legenda={(() => { const c = area.contratos.find((x) => x.situacao === 'assinado'); return c ? `em ${dia(c.assinadoEm)}` : area.contratos.length ? 'Falta a sua assinatura' : 'Ainda não emitido' })()}
              acao="Ver contrato" aoClicar={() => ir('contratos')} />
            <CartaoResumo icone="ava" titulo="AVA" tom="neutro" valor={area.ava.disponivel ? 'Disponível' : area.ava.suspenso ? 'Suspenso' : 'Em breve'}
              legenda={area.ava.disponivel ? 'Suas aulas e materiais' : 'Acesso às aulas por aqui'} acao="Saiba mais" aoClicar={() => ir('ava')} />
          </div>

          <div class="ada-duas">
            <div class="ada-coluna">
              {etapasAbertas.length > 0 && props.jornada && (
                <div class="cartao">
                  <h2 class="ada-titulo">O que falta</h2>
                  <Jornada codigo={props.jornada.inscricao.candidateCode} token={props.jornada.token} contexto="painel" etapas={etapasAbertas} portalSlug={props.jornada.portal?.slug} />
                </div>
              )}
              <div class="cartao">
                <div class="ada-titulo-linha">
                  <h2 class="ada-titulo">Faturas</h2>
                  <button type="button" class="ada-link" onClick={() => ir('financeiro')}>Ver todas</button>
                </div>
                {area.financeiro.faturas.length === 0
                  ? <p class="ada-vazio">Nenhuma fatura por enquanto.</p>
                  : <ListaDeFaturas faturas={proximasEUltimas(area.financeiro.faturas)} codigo={area.inscricao.codigo} compacta aoMudar={props.aoRecarregar} />}
              </div>
            </div>
            <div class="ada-coluna">
              <ResumoDoCandidato titulo="Seus dados" codigo={area.inscricao.codigo} token={area.token} podeEditar portalSlug={area.inscricao.portalSlug}
                nomeCompleto={props.nome} editando={props.editando} aoMudarEdicao={props.aoMudarEdicao} aoSalvar={props.aoSalvarDados} />
            </div>
          </div>
        </section>
      )}

      {aba === 'financeiro' && (
        <section class="ada-secao" aria-label="Financeiro">
          <div class="ada-numeros">
            <Numero rotulo="Em aberto" valor={reais(area.financeiro.emAberto)} tom={area.financeiro.emAberto ? 'pendente' : 'ok'} />
            <Numero rotulo="Vencidas" valor={String(area.financeiro.vencidas)} tom={area.financeiro.vencidas ? 'erro' : 'neutro'} />
            <Numero rotulo="Pagas" valor={String(area.financeiro.pagas)} tom="ok" />
          </div>
          {area.financeiro.vencidas > 0 && (
            <div class="aviso erro" role="alert">Há fatura vencida. Pague pelo botão <b>Pagar</b> ou fale com a secretaria para combinar.</div>
          )}
          <div class="cartao">
            <h2 class="ada-titulo">Suas faturas</h2>
            {area.financeiro.faturas.length === 0
              ? <p class="ada-vazio">Nenhuma fatura por enquanto. Quando houver cobrança, ela aparece aqui.</p>
              : <ListaDeFaturas faturas={area.financeiro.faturas} codigo={area.inscricao.codigo} aoMudar={props.aoRecarregar} />}
            {area.financeiro.aviso && <p class="ada-nota">{area.financeiro.aviso}</p>}
          </div>
        </section>
      )}

      {aba === 'documentos' && (
        <section class="ada-secao" aria-label="Documentos">
          <Documentos token={area.token} embutido aoMudar={() => setVersaoDocs((v) => v + 1)} />
        </section>
      )}

      {aba === 'contratos' && (
        <section class="ada-secao" aria-label="Contratos e termos">
          <div class="cartao">
            <h2 class="ada-titulo">Contratos e termos</h2>
            {area.contratos.length === 0
              ? <p class="ada-vazio">O contrato aparece aqui assim que for emitido para você.</p>
              : area.contratos.map((c) => <LinhaDeContrato key={c.id} c={c} codigo={area.inscricao.codigo} token={area.token} />)}
          </div>
        </section>
      )}

      {aba === 'ava' && (
        <section class="ada-secao" aria-label="Ambiente Virtual de Aprendizagem">
          <div class="cartao ada-ava">
            <span class="ada-ava-icone"><Icone nome="ava" grande /></span>
            <h2 class="ada-titulo">Ambiente Virtual de Aprendizagem</h2>
            {area.ava.disponivel && area.ava.url ? (
              <>
                <p class="ada-sub">{area.ava.curso ? <>Curso: <b>{area.ava.curso}</b></> : 'Suas aulas, materiais e atividades.'}</p>
                <a class="ada-botao" href={area.ava.url} target="_blank" rel="noopener">Acessar meu curso</a>
                {area.ava.usuario && <p class="ada-sub">Seu usuário no AVA: <b>{area.ava.usuario}</b></p>}
              </>
            ) : area.ava.suspenso ? (
              <p class="ada-sub">O acesso ao curso está suspenso no momento. Fale com a secretaria para reativar.</p>
            ) : (
              <p class="ada-sub">Em breve você vai acessar suas aulas por aqui, com seu progresso, notas e materiais do curso — sem precisar de outra senha.</p>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

/** Início: a próxima a pagar primeiro, depois as últimas movimentações (até 4). */
function proximasEUltimas(f: Fatura[]): Fatura[] {
  const abertas = f.filter((x) => x.situacao === 'aberta' || x.situacao === 'vencida')
  const pagas = f.filter((x) => x.situacao === 'paga').slice(-2).reverse()
  const previstas = f.filter((x) => x.situacao === 'prevista').slice(0, 1)
  return [...abertas, ...pagas, ...previstas].slice(0, 4)
}

function resumoDosDocumentos(c: Candidato | null) {
  const exig = (c?.processRegistration?.effectiveDocumentRequirements ?? []).filter((e) => e.required)
  const porTipo = new Map((c?.documents ?? []).map((d) => [d.typeCode, d]))
  let aprovados = 0, recusados = 0, emAnalise = 0, faltam = 0
  for (const e of exig) {
    const d = porTipo.get(e.documentType.code)
    if (!d) faltam++
    else if (d.status === 'approved') aprovados++
    else if (d.status === 'rejected') recusados++
    else emAnalise++
  }
  return { total: exig.length, aprovados, recusados, emAnalise, faltam }
}

function CartaoResumo(p: { icone: string; titulo: string; valor: string; legenda: string; tom: string; acao: string; aoClicar: () => void }) {
  return (
    <button type="button" class={`ada-resumo tom-${p.tom}`} onClick={p.aoClicar}>
      <span class="ada-resumo-topo"><span class="ada-resumo-icone"><Icone nome={p.icone} /></span>{p.titulo}</span>
      <b class="ada-resumo-valor">{p.valor}</b>
      <span class="ada-resumo-legenda">{p.legenda}</span>
      <span class="ada-resumo-acao">{p.acao} <span aria-hidden="true">→</span></span>
    </button>
  )
}

function Numero(p: { rotulo: string; valor: string; tom: string }) {
  return <div class={`ada-numero tom-${p.tom}`}><span>{p.rotulo}</span><b>{p.valor}</b></div>
}

function ListaDeFaturas(p: { faturas: Fatura[]; codigo: string; compacta?: boolean; aoMudar: () => void }) {
  return <ul class={`ada-faturas${p.compacta ? ' compacta' : ''}`}>{p.faturas.map((f) => <LinhaDeFatura key={f.chave} f={f} codigo={p.codigo} compacta={p.compacta} aoMudar={p.aoMudar} />)}</ul>
}

function LinhaDeFatura({ f, codigo, compacta, aoMudar }: { f: Fatura; codigo: string; compacta?: boolean; aoMudar: () => void }) {
  const [pix, setPix] = useState(f.pix)
  const [linha, setLinha] = useState(f.linha)
  const [copiado, setCopiado] = useState<string | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const s = SITUACAO[f.situacao]
  const aberta = f.situacao === 'aberta' || f.situacao === 'vencida'

  async function copiar(texto: string, qual: string) {
    try { await navigator.clipboard.writeText(texto); setCopiado(qual); setTimeout(() => setCopiado(null), 2500) } catch { setErro('Não foi possível copiar. Selecione o código abaixo e copie.') }
  }
  async function buscar(qual: 'pix' | 'linha') {
    if (buscando) return
    setBuscando(true); setErro(null)
    try {
      const r = await fetch('/api/public/portal/area/fatura/codigos', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo, chave: f.chave }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Não foi possível buscar o código agora.')
      setPix(d.pix); setLinha(d.linha)
      const t = qual === 'pix' ? d.pix : d.linha
      if (t) await copiar(t, qual)
      else setErro(qual === 'pix' ? 'Esta fatura não tem PIX. Use "Pagar".' : 'Esta fatura não tem boleto. Use "Pagar".')
    } catch (e: any) { setErro(e.message) } finally { setBuscando(false) }
  }

  async function gerar() {
    if (buscando) return
    setBuscando(true); setErro(null)
    try {
      const r = await fetch('/api/public/portal/area/fatura/gerar', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo, chave: f.chave }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Não foi possível gerar o boleto agora.')
      aoMudar()
    } catch (e: any) { setErro(e.message); setBuscando(false) }
  }

  const quando = f.situacao === 'paga'
    ? `Paga em ${dia(f.pagaEm)}`
    : f.situacao === 'prevista' ? (f.vencimento ? `Previsão ${dia(f.vencimento)}` : 'Data a definir')
      : f.vencimento ? `${f.situacao === 'vencida' ? 'Venceu' : 'Vence'} em ${dia(f.vencimento)}` : ''

  return (
    <li class={`ada-fatura sit-${f.situacao}`}>
      <div class="ada-fatura-linha">
        <span class="ada-fatura-desc">
          <b>{f.titulo}</b>
          <span>{[quando, f.meio, f.detalhe].filter(Boolean).join(' · ')}</span>
        </span>
        <span class="ada-fatura-valor">
          <b>{reais(f.valor)}</b>
          <span class={`ada-selo ${s.tom}`}>{s.rotulo}</span>
        </span>
      </div>
      {f.podeGerar && (
        <div class="ada-fatura-acoes">
          <button type="button" class="ada-botao" disabled={buscando} onClick={gerar}>{buscando ? 'Gerando…' : 'Gerar boleto e PIX'}</button>
        </div>
      )}
      {!compacta && (aberta || f.recibo) && (
        <div class="ada-fatura-acoes">
          {aberta && f.pagar && <a class="ada-botao" href={f.pagar} target="_blank" rel="noopener">Pagar</a>}
          {aberta && (pix || f.buscarCodigos) && (
            <button type="button" class="botao-contorno" disabled={buscando} onClick={() => (pix ? copiar(pix, 'pix') : buscar('pix'))}>{copiado === 'pix' ? 'PIX copiado' : 'Copiar PIX'}</button>
          )}
          {aberta && (linha || f.buscarCodigos) && (
            <button type="button" class="botao-contorno" disabled={buscando} onClick={() => (linha ? copiar(linha, 'linha') : buscar('linha'))}>{copiado === 'linha' ? 'Linha copiada' : 'Copiar linha digitável'}</button>
          )}
          {aberta && f.boletoPdf && <a class="botao-contorno" href={f.boletoPdf} target="_blank" rel="noopener">Boleto (PDF)</a>}
          {f.recibo && <a class="botao-contorno" href={f.recibo} target="_blank" rel="noopener">Comprovante</a>}
        </div>
      )}
      {erro && <p class="ada-erro">{erro}</p>}
    </li>
  )
}

function LinhaDeContrato({ c, codigo, token }: { c: Contrato; codigo: string; token: string }) {
  const [abrindo, setAbrindo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  async function abrir() {
    // O PDF exige o token da inscrição no cabeçalho: baixa e abre o arquivo.
    const janela = window.open('', '_blank')
    setAbrindo(true); setErro(null)
    try {
      const r = await fetch(`/api/public/registrations/${encodeURIComponent(codigo)}/contrato/pdf`, { headers: { Authorization: `Bearer ${token}` } })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Não foi possível abrir o documento.')
      const url = URL.createObjectURL(await r.blob())
      if (janela) janela.location.href = url; else location.href = url
    } catch (e: any) { janela?.close(); setErro(e.message) } finally { setAbrindo(false) }
  }
  return (
    <div class="ada-contrato">
      <span class="ada-contrato-icone"><Icone nome="contratos" /></span>
      <span class="ada-contrato-desc">
        <b>{c.titulo}</b>
        <span>{FORMA[c.forma]}{c.assinadoEm ? ` · ${dia(c.assinadoEm)}` : ''}</span>
      </span>
      <span class={`ada-selo ${c.situacao === 'assinado' ? 'ok' : 'pendente'}`}>{c.situacao === 'assinado' ? 'Assinado' : 'Aguardando assinatura'}</span>
      {c.temPdf && <button type="button" class="botao-contorno" disabled={abrindo} onClick={abrir}>{abrindo ? 'Abrindo…' : c.situacao === 'assinado' ? 'Baixar PDF' : 'Ver documento'}</button>}
      {erro && <p class="ada-erro">{erro}</p>}
    </div>
  )
}

function Icone({ nome, grande }: { nome: string; grande?: boolean }): ComponentChildren {
  const t = grande ? 28 : 18
  const caminhos: Record<string, ComponentChildren> = {
    inicio: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M10 21v-6h4v6" /></>,
    financeiro: <><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 10h19" /><path d="M6.5 15h4" /></>,
    documentos: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></>,
    contratos: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="m9 15 2 2 4-4" /></>,
    ava: <><rect x="2.5" y="4" width="19" height="13" rx="2" /><path d="M8 21h8M12 17v4" /><path d="m10 8.5 4 2-4 2z" /></>,
  }
  return (
    <svg viewBox="0 0 24 24" width={t} height={t} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {caminhos[nome] ?? null}
    </svg>
  )
}
