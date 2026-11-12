// Aba AVA do Meu Portal: andamento do aluno no Moodle (11/11/2026).
// Progresso, requisitos para concluir o curso, avaliações (nota, aprovado,
// tentativas, prazo) e o conteúdo por disciplina. Backend:
// services/moodleProgresso.ts (GET /api/public/portal/area/ava/progresso).
import { useEffect, useState } from 'preact/hooks'

type SituacaoAvaliacao = 'aprovado' | 'reprovado' | 'feita' | 'pendente' | 'bloqueada'
interface Avaliacao {
  cmid: number; nome: string; tipo: 'final' | 'modulo' | 'disciplina' | 'simulado'; requisito: boolean
  situacao: SituacaoAvaliacao; nota: number | null; notaMax: number | null; notaMinima: number | null; enviadaEm: string | null
  tentativasUsadas: number | null; tentativasMax: number | null; abre: string | null; fecha: string | null; regra: string | null
}
export interface ProgressoAva {
  curso: { id: number; nome: string; url: string }
  progresso: number | null
  atividades: { feitas: number; total: number }
  ultimoAcesso: string | null
  concluido: boolean
  concluidoEm: string | null
  regraConclusao: 'todos' | 'qualquer' | null
  requisitos: Array<{ titulo: string; detalhe: string; cumprido: boolean; em: string | null }>
  avaliacoes: Avaliacao[]
  disciplinas: Array<{ nome: string; feitas: number; total: number }>
  atualizadoEm: string
}

const dia = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '')
const nota = (n: number | null) => (n == null ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }))
const nomeLimpo = (s: string) => s.replace(/^avalia[cç][aã]o\s*[-–:]\s*/i, '').replace(/\s*\(copiado\)/gi, '').trim()

const SITUACAO: Record<SituacaoAvaliacao, { rotulo: string; tom: string }> = {
  aprovado: { rotulo: 'Aprovado', tom: 'ok' },
  reprovado: { rotulo: 'Não atingiu a nota', tom: 'erro' },
  feita: { rotulo: 'Feita', tom: 'marca' },
  pendente: { rotulo: 'Disponível', tom: 'pendente' },
  bloqueada: { rotulo: 'Ainda não liberada', tom: 'neutro' },
}

function restantes(a: Avaliacao): string | null {
  if (a.tentativasMax == null || a.tentativasUsadas == null) return null
  if (a.tentativasMax === 0) return `${a.tentativasUsadas} tentativa(s) feita(s) · sem limite`
  const r = Math.max(0, a.tentativasMax - a.tentativasUsadas)
  return `${a.tentativasUsadas} de ${a.tentativasMax} tentativas · ${r === 0 ? 'nenhuma restante' : r === 1 ? '1 restante' : `${r} restantes`}`
}

export function AvaProgresso({ registro, url }: { registro: number; url?: string | null }) {
  const [p, setP] = useState<ProgressoAva | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [abertas, setAbertas] = useState(false)

  async function carregar(forcar = false) {
    setCarregando(true); setErro(null)
    try {
      const r = await fetch(`/api/public/portal/area/ava/progresso?registro=${registro}${forcar ? '&forcar=1' : ''}`, { credentials: 'same-origin' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.error || 'Não foi possível ler o seu andamento agora.')
      setP(j.progresso ?? null)
    } catch (e) { setErro((e as Error).message) } finally { setCarregando(false) }
  }
  useEffect(() => { void carregar() }, [registro])

  if (carregando && !p) return <div class="cartao"><p class="ada-sub">Carregando seu andamento no curso…</p></div>
  if (erro && !p) return <div class="cartao"><p class="ada-erro">{erro}</p><button class="ada-link" onClick={() => carregar(true)}>Tentar de novo</button><p class="ada-nota">Você pode entrar no curso normalmente pelo botão "Acessar meu curso" acima.</p></div>
  if (!p) return null

  // Etapa final: a avaliação que conclui o curso; sem ela, a última de módulo.
  const final = p.avaliacoes.find((a) => a.tipo === 'final' && a.requisito) ?? p.avaliacoes.find((a) => a.tipo === 'final')
    ?? [...p.avaliacoes].reverse().find((a) => a.tipo === 'modulo')
  const simulados = p.avaliacoes.filter((a) => a.tipo === 'simulado')
  const lista = p.avaliacoes.filter((a) => a !== final && a.tipo !== 'simulado')
  const pct = p.progresso ?? (p.atividades.total ? Math.round((p.atividades.feitas / p.atividades.total) * 100) : 0)

  return (
    <>
      {/* Progresso */}
      <div class="cartao ada-ava-topo">
        <div class="ada-titulo-linha">
          <h2 class="ada-titulo">{p.curso.nome}</h2>
          {p.concluido ? <span class="ada-selo ok">Curso concluído{p.concluidoEm ? ` em ${dia(p.concluidoEm)}` : ''}</span> : <span class="ada-selo marca">Em andamento</span>}
        </div>
        <div class="ada-progresso" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso no curso">
          <div class="ada-progresso-barra" style={{ width: `${pct}%` }} />
        </div>
        <div class="ada-progresso-legenda">
          <b>{pct}%</b>
          <span>{p.atividades.feitas} de {p.atividades.total} atividades concluídas</span>
          {p.ultimoAcesso && <span>Último acesso em {dia(p.ultimoAcesso)}</span>}
        </div>
      </div>

      {/* Para concluir */}
      {p.requisitos.length > 0 && (
        <div class="cartao">
          <h3 class="ada-titulo">Para concluir o curso</h3>
          <p class="ada-sub">{p.regraConclusao === 'qualquer' ? 'Basta cumprir um destes requisitos.' : 'É preciso cumprir todos os requisitos abaixo.'}</p>
          <ul class="ada-requisitos">
            {p.requisitos.map((r, i) => (
              <li key={i} class={r.cumprido ? 'feito' : ''}>
                <span class="ada-check" aria-hidden="true">{r.cumprido ? '✓' : ''}</span>
                <span class="ada-req-texto"><b>{r.titulo}</b><span>{r.detalhe}</span></span>
                <span class={`ada-selo ${r.cumprido ? 'ok' : 'pendente'}`}>{r.cumprido ? `Cumprido${r.em ? ` em ${dia(r.em)}` : ''}` : 'Pendente'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Avaliação final em destaque */}
      {final && (
        <div class={`cartao ada-final sit-${final.situacao}`}>
          <span class="ada-sobre">{final.tipo === 'final' ? 'Etapa final do curso' : 'Última avaliação'}</span>
          <div class="ada-titulo-linha">
            <h3 class="ada-titulo">{nomeLimpo(final.nome)}</h3>
            <span class={`ada-selo ${SITUACAO[final.situacao].tom}`}>{SITUACAO[final.situacao].rotulo}</span>
          </div>
          <div class="ada-final-dados">
            <span>Nota <b>{nota(final.nota)}</b>{final.notaMax ? ` de ${nota(final.notaMax)}` : ''}</span>
            {final.notaMinima != null && <span>Para aprovar: <b>{nota(final.notaMinima)}</b></span>}
            {restantes(final) && <span>{restantes(final)}</span>}
            {final.fecha && <span>Aberta {final.abre ? `de ${dia(final.abre)} ` : ''}até <b>{dia(final.fecha)}</b></span>}
          </div>
          {final.regra && final.situacao === 'bloqueada' && <p class="ada-nota">{final.regra}.</p>}
        </div>
      )}

      {/* Avaliações */}
      {lista.length > 0 && (
        <div class="cartao">
          <h3 class="ada-titulo">Avaliações</h3>
          {simulados.length > 0 && <p class="ada-sub">Simulados para treinar: {simulados.filter((a) => a.situacao !== 'pendente' && a.situacao !== 'bloqueada').length} de {simulados.length} feitos.</p>}
          <ul class="ada-avaliacoes">
            {lista.map((a) => (
              <li key={a.cmid} class={`sit-${a.situacao}${a.tipo !== 'disciplina' ? ' destaque' : ''}`}>
                <div class="ada-av-desc">
                  <b>{nomeLimpo(a.nome)}</b>
                  <span>
                    {a.tipo === 'modulo' ? 'Avaliação de módulo' : a.tipo === 'final' ? 'Avaliação final do curso' : 'Avaliação da disciplina'}
                    {a.notaMinima != null ? ` · mínimo ${nota(a.notaMinima)}` : ''}
                    {a.enviadaEm ? ` · enviada em ${dia(a.enviadaEm)}` : ''}
                    {restantes(a) && a.situacao !== 'aprovado' ? ` · ${restantes(a)}` : ''}
                    {a.regra && (a.situacao === 'bloqueada') ? ` · ${a.regra}` : ''}
                  </span>
                </div>
                <div class="ada-av-nota">
                  <b>{nota(a.nota)}</b>
                  <span class={`ada-selo ${SITUACAO[a.situacao].tom}`}>{SITUACAO[a.situacao].rotulo}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Conteúdo por disciplina */}
      {p.disciplinas.length > 0 && (
        <div class="cartao">
          <div class="ada-titulo-linha">
            <h3 class="ada-titulo">Conteúdo por disciplina</h3>
            <button class="ada-link" onClick={() => setAbertas((x) => !x)} aria-expanded={abertas}>{abertas ? 'Recolher' : 'Ver tudo'}</button>
          </div>
          <ul class="ada-disciplinas">
            {(abertas ? p.disciplinas : p.disciplinas.slice(0, 4)).map((d, i) => {
              const v = d.total ? Math.round((d.feitas / d.total) * 100) : 0
              return (
                <li key={i}>
                  <span class="ada-disc-nome">{d.nome}</span>
                  <span class="ada-disc-barra" aria-hidden="true"><span style={{ width: `${v}%` }} /></span>
                  <span class="ada-disc-num">{d.feitas}/{d.total}</span>
                </li>
              )
            })}
          </ul>
          {!abertas && p.disciplinas.length > 4 && <p class="ada-nota">+ {p.disciplinas.length - 4} disciplina(s)</p>}
        </div>
      )}

      {url && <div class="ada-ava-fim"><a class="ada-botao ada-botao-grande" href={url} target="_blank" rel="noopener">Acessar meu curso</a></div>}
      <p class="ada-rodape-ava">
        Atualizado em {new Date(p.atualizadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })} ·{' '}
        <button class="ada-link" onClick={() => carregar(true)} disabled={carregando}>{carregando ? 'Atualizando…' : 'Atualizar'}</button>
      </p>
    </>
  )
}
