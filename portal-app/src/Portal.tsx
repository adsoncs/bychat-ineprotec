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
import { carregarJornadaDoPortal, carregarPainelAluno, type PainelAluno } from './api'
import { t as tx } from './textos'

interface Eu {
  nome: string; email: string | null; whatsapp: string | null; temSenha: boolean
  aluno: { id: number; ra: string | null } | null
  inscricoes: Array<{ id: number; candidateCode: string; status: string }>
}

const STATUS: Record<string, string> = {
  draft: 'Rascunho', pending: 'Em andamento', submitted: 'Enviada', paid: 'Paga',
  docs_uploaded: 'Documentos enviados', docs_reviewing: 'Documentos em análise', docs_approved: 'Documentos aprovados',
  docs_rejected: 'Documentos recusados', reviewing: 'Em análise', approved: 'Aprovada', enrolled: 'Matriculado',
  rejected: 'Não aprovada', cancelled: 'Cancelada', expired: 'Expirada',
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

  useEffect(() => {
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
    carregarJornadaDoPortal().then(setJornada).catch(() => {})
  }, [])

  const ativas = (eu?.inscricoes ?? []).filter((i) => i.status !== 'merged')
  const outras = ativas.filter((i) => i.candidateCode !== jornada?.inscricao.candidateCode)
  // Mesmo visual do "Fazer agora" das etapas (estilo.css › .botao-contorno).

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
              <ResumoDoCandidato codigo={jornada.inscricao.candidateCode} token={jornada.token}
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
                  <div class="item-conta" key={i.id}><span><b>{i.candidateCode}</b></span><span class={`rc-situacao ${tomDaSituacao(i.status)}`}>{STATUS[i.status] ?? i.status}</span></div>
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
                    ? <Jornada codigo={jornada.inscricao.candidateCode} token={jornada.token} contexto="painel" etapas={jornada.etapas} portalSlug={jornada.portal?.slug} />
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
