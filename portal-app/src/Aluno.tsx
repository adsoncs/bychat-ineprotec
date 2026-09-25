import { useEffect, useState } from 'preact/hooks'
import { carregarMarca, TopoDaMarca, type MarcaDoPortal } from './marca'
import { carregarPainelAluno, gerarCobrancaDaParcela, type PainelAluno, type Parcela } from './api'

const dinheiro = (centavos: number) =>
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const data = (v: string | Date) => new Date(v).toLocaleDateString('pt-BR')

const SITUACAO_PARCELA: Record<string, { rotulo: string; classe: string }> = {
  ABERTA: { rotulo: 'Em aberto', classe: 'analise' },
  PAGA: { rotulo: 'Paga', classe: 'ok' },
  CANCELADA: { rotulo: 'Cancelada', classe: 'analise' },
  RENEGOCIADA: { rotulo: 'Renegociada', classe: 'analise' },
}

export function Aluno() {
  const [d, setD] = useState<PainelAluno | null>(null)
  const [falha, setFalha] = useState<string | null>(null)
  const [marca, setMarca] = useState<MarcaDoPortal | null>(null)

  useEffect(() => {
    // Branding completo do portal (cores, fonte, cantos, fundo, logo).
    void carregarMarca().then(setMarca)
    carregarPainelAluno()
      .then((p) => {
        setD(p)
        if (p.marca && !marca) {
          document.documentElement.style.setProperty('--marca', p.marca)
          document.documentElement.style.setProperty('--marca-suave', `color-mix(in srgb, ${p.marca} 12%, transparent)`)
        }
      })
      .catch((e) => {
        if (/Entre no portal|expirad/i.test(e.message)) { location.href = '/portal/login'; return }
        setFalha(e.message)
      })
  }, [])

  if (falha) {
    return (
      <div class="pagina">
        <div class="cartao" style="margin-top:40px">
          <h2>Não foi possível abrir seu portal</h2>
          <p class="sub">{falha}</p>
          <button class="principal" onClick={() => location.reload()}>Tentar de novo</button>
        </div>
      </div>
    )
  }
  if (!d) {
    return (
      <div class="pagina" aria-busy="true">
        <div class="topo"><div class="esqueleto" style="width:170px;height:26px" /></div>
        <div class="esqueleto" style="height:130px;margin-bottom:14px" />
        <div class="esqueleto" style="height:260px" />
      </div>
    )
  }

  const pendentes = d.passos.filter((p) => p.situacao !== 'feito')
  const semCobranca = d.financeiro.parcelas.filter(
    (p) => p.situacao === 'ABERTA' && !p.pix && !p.linhaDigitavel,
  ).length

  return (
    <div class="pagina">
      <TopoDaMarca marca={marca} />
      <div class="cartao" style="margin-bottom:14px">
        <h2>{d.aluno.nome}</h2>
        <p class="sub" style="margin:0">
          {d.aluno.ra ? `RA ${d.aluno.ra}` : 'Candidato'}
          {d.matricula ? ` · ${d.matricula.turma}` : ''}
        </p>
      </div>

      {d.bloqueio?.bloqueado && (
        <div class="aviso erro" role="alert" style="margin-bottom:14px">
          <b>Acesso acadêmico suspenso por pendência financeira.</b>
          <div style="margin-top:4px">{d.bloqueio.motivo} — regularize abaixo para liberar o boletim.</div>
        </div>
      )}

      {/* O coração da tela: o que falta, em ordem, com o caminho de resolver. */}
      <div class="cartao" style="margin-bottom:14px">
        <h2 style="font-size:17px">
          {pendentes.length === 0
            ? 'Está tudo em dia'
            : pendentes.length === 1 ? 'Falta 1 passo' : `Faltam ${pendentes.length} passos`}
        </h2>
        <p class="sub">
          {pendentes.length === 0
            ? 'Nada pendente da sua parte.'
            : 'O que ainda depende de você ou da secretaria.'}
        </p>
        <ol class="passos">
          {d.passos.map((p) => (
            <li class={`passo ${p.situacao}`} key={p.chave}>
              <span class="passo-marca" aria-hidden="true">
                {p.situacao === 'feito' ? '✓' : p.situacao === 'travado' ? '…' : '!'}
              </span>
              <span class="passo-corpo">
                <b>{p.titulo}</b>
                <span>{p.detalhe}</span>
                {p.acao && (
                  <a class="passo-acao" href={p.acao.href}>{p.acao.rotulo}</a>
                )}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {d.financeiro.parcelas.length > 0 && (
        <div class="cartao" style="margin-bottom:14px" id="financeiro">
          <h2 style="font-size:17px">Financeiro</h2>
          <p class="sub">
            {d.financeiro.vencidas > 0
              ? `${d.financeiro.vencidas} parcela(s) vencida(s).`
              : 'Nenhuma parcela vencida.'}
            {' '}Em aberto: <b>{dinheiro(d.financeiro.totalAbertoCentavos)}</b>
          </p>
          {semCobranca > 0 && (
            <div class="aviso info" style="margin-bottom:12px">
              {semCobranca === 1
                ? 'Uma parcela ainda não tem boleto. Use "Gerar boleto e PIX" na parcela para emitir na hora.'
                : `${semCobranca} parcelas ainda não têm boleto. Use "Gerar boleto e PIX" na parcela que quiser pagar.`}
            </div>
          )}
          {d.financeiro.parcelas.map((p) => <LinhaDeParcela key={p.id} parcela={p} />)}
        </div>
      )}

      {/* ── Vida acadêmica (Fase 7) ──
          As quatro seções que existiam só no portal SSR do ERP. Aparecem quando
          há conteúdo: um cartão vazio "Horário das aulas" não informa nada. */}

      {d.grade.length > 0 && (
        <div class="cartao" style="margin-bottom:14px">
          <h2 style="font-size:17px">Horário das aulas</h2>
          <div class="grade">
            {DIAS_SEMANA.map((nome, dia) => {
              const doDia = d.grade.filter((h) => h.diaSemana === dia)
              if (doDia.length === 0) return null
              return (
                <div key={dia} class="grade-dia">
                  <span class="grade-nome">{nome}</span>
                  <div>
                    {doDia.map((h, i) => (
                      <div key={i} class="grade-aula">
                        <b>{h.horaInicio}–{h.horaFim}</b> {h.disciplinaNome}
                        {h.sala ? <span class="grade-extra"> · sala {h.sala}</span> : null}
                        {h.professorNome ? <span class="grade-extra"> · {h.professorNome}</span> : null}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {d.eventos.length > 0 && (
        <div class="cartao" style="margin-bottom:14px">
          <h2 style="font-size:17px">Próximas datas</h2>
          {d.eventos.map((e, i) => (
            <div key={i} class="evento">
              <span class="evento-data">
                {data(e.dataInicio)}{e.dataFim ? ` – ${data(e.dataFim)}` : ''}
              </span>
              <span>
                {e.titulo}
                {e.descricao ? <span class="evento-desc">{e.descricao}</span> : null}
              </span>
            </div>
          ))}
        </div>
      )}

      {d.materiais.length > 0 && (
        <div class="cartao" style="margin-bottom:14px">
          <h2 style="font-size:17px">Materiais de estudo</h2>
          {d.materiais.map((g) => (
            <div key={g.disciplina} class="material-grupo">
              <div class="material-disc">{g.disciplina}</div>
              {g.itens.map((m, i) => (
                <a key={i} class="material-item" href={m.url} target="_blank" rel="noopener noreferrer">
                  {m.titulo}
                  {m.descricao ? <span class="material-desc"> — {m.descricao}</span> : null}
                </a>
              ))}
            </div>
          ))}
        </div>
      )}

      {d.horas && (d.horas.estagio.meta > 0 || d.horas.atividades.meta > 0) && (
        <div class="cartao" style="margin-bottom:14px">
          <h2 style="font-size:17px">Estágio e atividades</h2>
          {d.horas.estagio.meta > 0 && (
            <BarraDeHoras rotulo="Estágio" atual={d.horas.estagio.horas} meta={d.horas.estagio.meta} cumprido={d.horas.estagio.cumprido} />
          )}
          {d.horas.atividades.meta > 0 && (
            <BarraDeHoras
              rotulo="Atividades complementares"
              atual={d.horas.atividades.horas}
              meta={d.horas.atividades.meta}
              cumprido={d.horas.atividades.cumprido}
              nota={d.horas.atividades.pendentes > 0 ? `${d.horas.atividades.pendentes} em análise` : null}
            />
          )}
        </div>
      )}

      {d.boletim.length > 0 && (
        <div class="cartao" style="margin-bottom:14px">
          <h2 style="font-size:17px">Boletim</h2>
          {d.bloqueio?.bloqueado ? (
            <p class="sub">Indisponível enquanto houver pendência financeira.</p>
          ) : d.boletim.map((t) => (
            <div key={t.turma} style="margin-top:10px">
              <h3 style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--tinta-3);margin:0 0 6px">{t.turma}</h3>
              {t.disciplinas.map((disc) => (
                <div class="item" key={disc.nome}>
                  <span>{disc.nome}</span>
                  <b>{disc.media != null ? disc.media.toFixed(1) : '—'} · {disc.freqPct}%</b>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {d.rematricula?.disponivel && (
        <div class="cartao" style="margin-bottom:14px">
          <h2 style="font-size:17px">Rematrícula aberta</h2>
          <p class="sub">Há turma disponível para você continuar no próximo período.</p>
          {d.rematricula.ofertas.slice(0, 3).map((o) => (
            <div class="item" key={o.turmaId}><span>{o.nome}</span></div>
          ))}
          <a href="/portal/aca/aluno/rematricula">
            <button class="secundario" style="width:100%;margin-top:12px">Fazer rematrícula</button>
          </a>
        </div>
      )}

      {(d.requerimentos?.lista.length > 0 || d.requerimentos?.tipos.length > 0) && (
        <div class="cartao" style="margin-bottom:14px">
          <h2 style="font-size:17px">Requerimentos</h2>
          <p class="sub">
            {d.requerimentos.abertos > 0
              ? `${d.requerimentos.abertos} em andamento.`
              : 'Declarações, histórico e outros pedidos à secretaria.'}
          </p>
          {d.requerimentos.lista.slice(0, 5).map((r) => (
            <div class="item" key={r.id}>
              <span>{r.tipoNome} · <span class="tag">{r.protocolo}</span></span>
              <b>{r.status.toLowerCase().replace('_', ' ')}</b>
            </div>
          ))}
          {d.requerimentos.tipos.length > 0 && (
            <a href="/portal/aca/aluno#requerimentos">
              <button class="secundario" style="width:100%;margin-top:12px">Abrir requerimento</button>
            </a>
          )}
        </div>
      )}

      <div class="cartao">
        <h2 style="font-size:17px">Sua conta</h2>
        <div class="item"><span>{d.aluno.email ?? '—'}</span><span class="tag">e-mail</span></div>
        <div class="item"><span>{d.aluno.whatsapp ?? '—'}</span><span class="tag">WhatsApp</span></div>
        <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
          <a href="/portal/documentos" style="flex:1"><button class="secundario" style="width:100%">Documentos</button></a>
          <a href="/portal/senha" style="flex:1"><button class="secundario" style="width:100%">Trocar senha</button></a>
        </div>
        <form method="post" action="/api/public/portal/sair" style="margin-top:8px">
          <button class="secundario" type="submit" style="width:100%">Sair do portal</button>
        </form>
      </div>
    </div>
  )
}

function LinhaDeParcela({ parcela }: { parcela: Parcela }) {
  const [copiado, setCopiado] = useState<string | null>(null)
  // A cobrança pode nascer nesta tela: guardamos o que voltou em vez de recarregar
  // o painel inteiro, que reposicionaria a página e perderia a parcela de vista.
  const [pix, setPix] = useState<string | null>(parcela.pix ?? null)
  const [linha, setLinha] = useState<string | null>(parcela.linhaDigitavel ?? null)
  const [gerando, setGerando] = useState(false)
  const [erroGerar, setErroGerar] = useState<string | null>(null)
  const sit = SITUACAO_PARCELA[parcela.situacao] ?? { rotulo: parcela.situacao, classe: 'analise' }
  const vencida = parcela.situacao === 'ABERTA' && new Date(parcela.vencimento) < new Date()

  async function gerar() {
    if (gerando) return
    setGerando(true); setErroGerar(null)
    try {
      const r = await gerarCobrancaDaParcela(parcela.id)
      setPix(r.pix ?? null)
      setLinha(r.linhaDigitavel ?? null)
      if (!r.pix && !r.linhaDigitavel) {
        setErroGerar('A cobrança foi criada, mas o boleto ainda não ficou pronto. Recarregue em instantes.')
      }
    } catch (e: any) {
      setErroGerar(e.message)
    } finally {
      setGerando(false)
    }
  }

  async function copiar(texto: string, rotulo: string) {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(rotulo)
      setTimeout(() => setCopiado(null), 2500)
    } catch {
      // Sem permissão de área de transferência: mostra o código para copiar à mão.
      setCopiado('erro')
    }
  }

  return (
    <div class="parcela">
      <div class="parcela-topo">
        <span>
          <b>{parcela.numero}. {parcela.tipo === 'MATRICULA' ? 'Matrícula' : 'Mensalidade'}</b>
          <span class="parcela-venc">
            {parcela.situacao === 'PAGA' && parcela.pagoEm
              ? `paga em ${data(parcela.pagoEm)}`
              : `vence ${data(parcela.vencimento)}`}
          </span>
        </span>
        <span style="text-align:right">
          <b class="parcela-valor">{dinheiro(parcela.valorCentavos)}</b>
          <span class={`selo ${vencida ? 'ruim' : sit.classe}`}>{vencida ? 'Vencida' : sit.rotulo}</span>
        </span>
      </div>

      {parcela.situacao === 'ABERTA' && (pix || linha) && (
        <div class="parcela-acoes">
          {pix && (
            <button class="secundario" onClick={() => copiar(pix, 'PIX')}>
              {copiado === 'PIX' ? 'PIX copiado' : 'Copiar PIX'}
            </button>
          )}
          {linha && (
            <button class="secundario" onClick={() => copiar(linha, 'boleto')}>
              {copiado === 'boleto' ? 'Linha copiada' : 'Copiar linha digitável'}
            </button>
          )}
        </div>
      )}

      {/* Sem cobrança criada não havia o que copiar, e a tela mandava esperar um
          aviso que ninguém envia. O aluno emite na hora. */}
      {parcela.situacao === 'ABERTA' && !pix && !linha && (
        <div class="parcela-acoes">
          <button class="secundario" disabled={gerando} onClick={gerar}>
            {gerando ? 'Gerando…' : 'Gerar boleto e PIX'}
          </button>
          {erroGerar && <span class="parcela-erro">{erroGerar}</span>}
        </div>
      )}

    </div>
  )
}

const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

/** Progresso de horas cumpridas contra a meta do curso. */
function BarraDeHoras(
  { rotulo, atual, meta, cumprido, nota }:
  { rotulo: string; atual: number; meta: number; cumprido: boolean; nota?: string | null },
) {
  const pct = meta > 0 ? Math.min(100, Math.round((atual / meta) * 100)) : 0
  return (
    <div class="horas">
      <div class="horas-topo">
        <span>{rotulo}</span>
        <span class={cumprido ? 'horas-ok' : undefined}>
          {atual}h de {meta}h{cumprido ? ' · cumprido' : ''}
        </span>
      </div>
      <div class="horas-trilho"><div class={`horas-barra${cumprido ? ' ok' : ''}`} style={`width:${pct}%`} /></div>
      {nota ? <span class="horas-nota">{nota}</span> : null}
    </div>
  )
}
