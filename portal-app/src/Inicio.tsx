// /portal — início do portal logado, com a moldura e a marca do portal de
// inscrição. A inscrição em andamento mostra a jornada (etapas na ordem do
// portal) já interativa: "Fazer agora" abre a etapa aqui mesmo.
import { useEffect, useState } from 'preact/hooks'
import { carregarMarca, type MarcaDoPortal } from './marca'
import { Moldura, AcessoSair } from './Moldura'
import { Jornada } from './Jornada'
import { ResumoDoCandidato } from './ResumoDoCandidato'
import { carregarJornadaDoPortal } from './api'

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

export function Inicio() {
  const [marca, setMarca] = useState<MarcaDoPortal | null>(null)
  const [eu, setEu] = useState<Eu | null>(null)
  const [jornada, setJornada] = useState<Awaited<ReturnType<typeof carregarJornadaDoPortal>> | null>(null)
  const [falha, setFalha] = useState<string | null>(null)

  useEffect(() => {
    void carregarMarca().then(setMarca)
    fetch('/api/public/portal/eu', { credentials: 'same-origin' })
      .then(async (r) => {
        if (r.status === 401) { location.href = '/portal/login'; return }
        setEu((await r.json()).eu)
      })
      .catch(() => setFalha('Não foi possível abrir o seu portal. Verifique a conexão e tente de novo.'))
    carregarJornadaDoPortal().then(setJornada).catch(() => {})
  }, [])

  const ativas = (eu?.inscricoes ?? []).filter((i) => i.status !== 'merged')
  const outras = ativas.filter((i) => i.candidateCode !== jornada?.inscricao.candidateCode)

  return (
    <Moldura marca={marca} acesso={eu ? <AcessoSair /> : undefined}>
      {falha && <div class="aviso erro">{falha}</div>}
      {q.get('aviso') && <div class="aviso info">{q.get('aviso')}</div>}
      {!eu ? <div class="esqueleto" style="height:220px" /> : (
        <>
          {/* Bloco de cima: tudo do candidato num cartão só (anonimizado). */}
          {jornada ? (
            <ResumoDoCandidato codigo={jornada.inscricao.candidateCode} token={jornada.token}>
              {!eu.temSenha && <span class="sub" style="margin:0;flex-basis:100%">Você está entrando com a senha padrão (o seu CPF). Crie uma senha só sua.</span>}
              <a href="/portal/senha">{eu.temSenha ? 'Trocar senha' : 'Criar minha senha'}</a>
            </ResumoDoCandidato>
          ) : (
            <div class="cartao">
              <h2>Olá, {eu.nome.split(' ')[0]}</h2>
              <p class="sub" style="margin:0">{eu.aluno ? `Aluno · RA ${eu.aluno.ra ?? '—'}` : 'Candidato'}</p>
              <div class="rc-acoes"><a href="/portal/senha">{eu.temSenha ? 'Trocar senha' : 'Criar minha senha'}</a></div>
            </div>
          )}

          {eu.aluno && (
            <div class="cartao">
              <h2 style="font-size:17px">Vida acadêmica</h2>
              <p class="sub">Situação da matrícula, financeiro, documentos e contrato.</p>
              <button class="principal" type="button" onClick={() => { location.href = '/portal/aluno' }}>Abrir meu portal</button>
            </div>
          )}

          {jornada && (
            <div class="cartao">
              {jornada.etapas.length
                ? <Jornada codigo={jornada.inscricao.candidateCode} token={jornada.token} contexto="painel" etapas={jornada.etapas} />
                : <p class="sub" style="margin:0">Nada pendente por aqui. Avisamos você pelo WhatsApp quando houver novidade.</p>}
            </div>
          )}

          {outras.length > 0 && (
            <div class="cartao">
              <h2 style="font-size:17px">Outras inscrições</h2>
              {outras.map((i) => (
                <div class="item-conta" key={i.id}><span><b>{i.candidateCode}</b></span><span class="rotulo">{STATUS[i.status] ?? i.status}</span></div>
              ))}
            </div>
          )}

        </>
      )}
    </Moldura>
  )
}
