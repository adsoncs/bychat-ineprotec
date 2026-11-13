// /portal — o portal único do candidato e do aluno.
//
// Antes eram três telas com o mesmo conteúdo, cada uma com o seu jeito de entrar:
// /portal (início), /portal/aluno (vida acadêmica) e /candidato/<código>
// (código + CPF). Agora tudo mora aqui: /portal/aluno e /candidato redirecionam,
// e o login (/portal/login) aceita e-mail + senha ou código + CPF.
//
// No desktop, dados à esquerda e etapas/vida acadêmica à direita (estilo.css ›
// .lado-a-lado); no celular, uma coluna só.
import { useEffect, useState } from 'preact/hooks'
import { carregarMarca, type MarcaDoPortal } from './marca'
import { Moldura, MenuDaConta } from './Moldura'
import { Jornada } from './Jornada'
import { ResumoDoCandidato, tomDaSituacao } from './ResumoDoCandidato'
import { SecoesDoAluno } from './Aluno'
import { AreaDoAluno, type Area } from './AreaDoAluno'
import { carregarJornadaDoPortal, carregarPainelAluno, type PainelAluno } from './api'
import { t as tx } from './textos'

interface Eu {
  nome: string; email: string | null; whatsapp: string | null; temSenha: boolean
  aluno: { id: number; ra: string | null } | null
  inscricoes: Array<{ id: number; candidateCode: string; status: string; curso?: string | null }>
}

const STATUS: Record<string, string> = {
  draft: 'Rascunho', pending: 'Em andamento', submitted: 'Enviada', paid: 'Paga',
  docs_uploaded: 'Documentos enviados', docs_reviewing: 'Documentos em análise', docs_approved: 'Documentos aprovados',
  docs_rejected: 'Documentos recusados', reviewing: 'Em análise', approved: 'Aprovada', enrolled: 'Matriculado',
  rejected: 'Não aprovada', cancelled: 'Cancelada', transferred: 'Transferida', expired: 'Expirada',
}
const q = new URLSearchParams(location.search)

export function Portal() {
  const [marca, setMarca] = useState<MarcaDoPortal | null>(null)
  const [eu, setEu] = useState<Eu | null>(null)
  const [jornada, setJornada] = useState<Awaited<ReturnType<typeof carregarJornadaDoPortal>> | null>(null)
  // Vida acadêmica: só quem já é aluno. `undefined` = carregando.
  const [painel, setPainel] = useState<PainelAluno | null | undefined>(undefined)
  const [falha, setFalha] = useState<string | null>(null)
  // "Editar meus dados" vem do menu da conta (topo) e abre no cartão de dados.
  const [editando, setEditando] = useState(false)
  function editar() {
    setEditando(true)
    requestAnimationFrame(() => document.querySelector('.resumo-candidato')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  // "Meu Portal" (AreaDoAluno): a instituição liga; `undefined` = consultando.
  const [area, setArea] = useState<Area | null | undefined>(undefined)
  function carregarArea(codigo?: string) {
    const u = '/api/public/portal/area' + (codigo ? `?codigo=${encodeURIComponent(codigo)}` : '')
    return fetch(u, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((a) => setArea(a?.ativa && a.modo === 'aluno' ? a : null))
      .catch(() => setArea(null))
  }

  useEffect(() => {
    void carregarArea()
    void carregarMarca().then(setMarca)
    fetch('/api/public/portal/eu', { credentials: 'same-origin' })
      .then(async (r) => {
        if (r.status === 401) { location.href = '/portal/login'; return }
        const e: Eu = (await r.json()).eu
        setEu(e)
        if (!e.aluno) { setPainel(null); return }
        carregarPainelAluno()
          .then((p) => {
            setPainel(p)
            if (p.marca) {
              document.documentElement.style.setProperty('--marca', p.marca)
              document.documentElement.style.setProperty('--marca-suave', `color-mix(in srgb, ${p.marca} 12%, transparent)`)
            }
          })
          .catch(() => setPainel(null))
      })
      .catch(() => setFalha(tx('portal.falha', 'Não foi possível abrir o seu portal. Verifique a conexão e tente de novo.')))
    carregarJornadaDoPortal(q.get('inscricao')).then(setJornada).catch(() => {})
  }, [])

  // Trocar de inscrição (quem tem mais de uma): a escolhida fica na URL para o recarregar manter.
  function abrirInscricao(codigo: string) {
    setEditando(false)
    setJornada(null)
    const u = new URL(location.href); u.searchParams.set('inscricao', codigo); history.replaceState(null, '', u)
    carregarJornadaDoPortal(codigo).then(setJornada)
      .catch(() => setFalha(tx('portal.falha', 'Não foi possível abrir o seu portal. Verifique a conexão e tente de novo.')))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const ativas = (eu?.inscricoes ?? []).filter((i) => i.status !== 'merged')
  const outras = ativas.filter((i) => i.candidateCode !== jornada?.inscricao.candidateCode)
  // Mesmo visual do "Fazer agora" das etapas (estilo.css › .botao-contorno).

  if (area) {
    return (
      <Moldura marca={marca} acesso={eu ? <MenuDaConta nome={eu.nome} temSenha={eu.temSenha} aoEditar={() => setEditando(true)} /> : undefined}>
        {q.get('aviso') && <div class="aviso info">{q.get('aviso')}</div>}
        {!eu ? <div class="esqueleto" style="height:320px" /> : (
          <AreaDoAluno area={area} nome={eu.nome} jornada={jornada}
            editando={editando} aoMudarEdicao={setEditando} aoSalvarDados={(novo) => setEu({ ...eu, ...(novo as Eu) })}
            aoTrocarInscricao={(c) => { setArea(undefined); void carregarArea(c) }} aoRecarregar={() => void carregarArea(area.inscricao.codigo)} />
        )}
      </Moldura>
    )
  }
  if (area === undefined) return <Moldura marca={marca}><div class="esqueleto" style="height:320px" /></Moldura>

  return (
    <Moldura marca={marca} acesso={eu ? <MenuDaConta nome={eu.nome} temSenha={eu.temSenha} aoEditar={jornada ? editar : undefined} /> : undefined}>
      {falha && <div class="aviso erro">{falha}</div>}
      {q.get('aviso') && <div class="aviso info">{q.get('aviso')}</div>}
      {!eu ? <div class="esqueleto" style="height:220px" /> : (
        <div class="lado-a-lado">
          {/* Coluna dos dados: quem é, a inscrição, a senha e o resto da conta. */}
          <div class="coluna-dados">
            {painel && (
              <div class="cartao">
                <h2>{painel.aluno.nome}</h2>
                <p class="sub" style="margin:0">
                  {painel.aluno.ra ? `RA ${painel.aluno.ra}` : 'Aluno'}
                  {painel.matricula ? ` · ${painel.matricula.turma}` : ''}
                </p>
              </div>
            )}
            {jornada ? (
              <ResumoDoCandidato key={jornada.inscricao.candidateCode} codigo={jornada.inscricao.candidateCode} token={jornada.token}
                podeEditar portalSlug={jornada.portal?.slug} nomeCompleto={eu.nome}
                editando={editando} aoMudarEdicao={setEditando}
                aoSalvar={(novo) => setEu({ ...eu, ...(novo as Eu) })} />
            ) : !painel && (
              <div class="cartao">
                <h2>Olá, {eu.nome.split(' ')[0]} <span aria-hidden="true">👋</span></h2>
                <p class="sub" style="margin:0">{eu.aluno ? `Aluno · RA ${eu.aluno.ra ?? '—'}` : tx('portal.candidato', 'Candidato')}</p>
              </div>
            )}
            {outras.length > 0 && (
              <div class="cartao">
                <h2 style="font-size:17px">{tx('portal.outrasInscricoes', 'Outras inscrições')}</h2>
                {outras.map((i) => (
                  <div class="item-conta" key={i.id}>
                    <span>{i.curso && <>{i.curso}<br /></>}<b>{i.candidateCode}</b></span>
                    <span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
                      <span class={`rc-situacao ${tomDaSituacao(i.status)}`}>{STATUS[i.status] ?? i.status}</span>
                      <button type="button" class="botao-contorno" onClick={() => abrirInscricao(i.candidateCode)}>{tx('portal.abrirInscricao', 'Abrir')}</button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Coluna principal: o que falta (etapas) e, para aluno, a vida acadêmica. */}
          <div class="coluna-principal">
            {painel
              ? <SecoesDoAluno d={painel} jornada={jornada} />
              : jornada && (
                <div class="cartao">
                  {jornada.etapas.length
                    ? <Jornada key={jornada.inscricao.candidateCode} codigo={jornada.inscricao.candidateCode} token={jornada.token} contexto="painel" etapas={jornada.etapas} portalSlug={jornada.portal?.slug} />
                    : <p class="sub" style="margin:0">{tx('portal.nadaPendente', 'Nada pendente por aqui. Avisamos você pelo WhatsApp quando houver novidade.')}</p>}
                </div>
              )}
            {painel === undefined && <div class="esqueleto" style="height:260px" />}
          </div>
        </div>
      )}
    </Moldura>
  )
}
