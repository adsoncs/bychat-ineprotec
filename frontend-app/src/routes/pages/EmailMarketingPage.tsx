import { useEffect, useState } from 'preact/hooks'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Mail, Send, Pause, Play, X as XIcon, Trash2, ArrowLeft, Pencil, Users, Clock } from '@/components/ui/icon-set'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { api } from '@/lib/apiClient'
import { toast } from '@/lib/toast'

// ── Tipos (espelham routes/emailCampanhas.ts) ──────────────────────────────

interface Publico {
  funnelId?: number | null; etapas?: string[]; tagIds?: number[]; tagModo?: 'qualquer' | 'todas'
  origens?: string[]; criadoDe?: string | null; criadoAte?: string | null; cidade?: string | null; segmento?: string | null
}
interface Metricas { enviados: number; entregues: number; abertos: number; clicados: number; bounces: number; spam: number }
interface Numeros { andamento: { pendente: number; enviado: number; falhou: number; ignorado: number }; metricas: { total: Metricas; A: Metricas; B: Metricas }; descadastros: number }
interface Campanha {
  id: number; nome: string; status: string; assunto: string; assuntoB: string | null; templateId?: number | null
  publico?: Publico; agendadaPara: string | null; iniciadaEm: string | null; concluidaEm: string | null; total: number
  createdAt: string; numeros: Numeros | null
}
interface Opcoes {
  funis: Array<{ id: number; name: string; stages: Array<{ key: string; name: string }> }>
  tags: Array<{ id: number; name: string }>
  origens: Array<{ valor: string; leads: number }>
  modelos: Array<{ id: number; nome: string; assunto: string | null; temConteudo: boolean }>
}
interface Previa {
  encontrados: number; aEnviar: number
  fora: { semEmail: number; descadastrados: number; bloqueados: number; repetidos: number }
  plano: { usado: number; incluido: number | null; precoExcedente: number | null; contaPropria: boolean }
  excedente: { quantidade: number; valor: number | null } | null
}

const STATUS: Record<string, [string, 'neutral' | 'info' | 'success' | 'warning' | 'danger']> = {
  rascunho: ['Rascunho', 'neutral'], agendada: ['Agendada', 'info'], enviando: ['Enviando', 'info'],
  pausada: ['Pausada', 'warning'], concluida: ['Concluída', 'success'], cancelada: ['Cancelada', 'neutral'],
}
const ORIGENS: Record<string, string> = {
  meta_lead_ads: 'Meta Lead Ads', whatsapp: 'WhatsApp', web_form: 'Formulário do site', web_chat: 'Chat do site',
  api: 'API', manual: 'Cadastro manual', import: 'Importação', instagram: 'Instagram',
}
const n = (v: number) => v.toLocaleString('pt-BR')
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 1000) / 10}%` : '—')
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const quando = (d: string | null) => (d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—')

// ── Página ─────────────────────────────────────────────────────────────────

type Vista = { tipo: 'lista' } | { tipo: 'editar'; id: number | null } | { tipo: 'detalhe'; id: number }

export function EmailMarketingPage() {
  const [vista, setVista] = useState<Vista>({ tipo: 'lista' })
  if (vista.tipo === 'editar') return <EditorDeCampanha id={vista.id} onSair={(id) => setVista(id ? { tipo: 'detalhe', id } : { tipo: 'lista' })} />
  if (vista.tipo === 'detalhe') return <DetalheDaCampanha id={vista.id} onVoltar={() => setVista({ tipo: 'lista' })} onEditar={() => setVista({ tipo: 'editar', id: vista.id })} />
  return <ListaDeCampanhas onNova={() => setVista({ tipo: 'editar', id: null })} onAbrir={(c) => setVista(c.status === 'rascunho' ? { tipo: 'editar', id: c.id } : { tipo: 'detalhe', id: c.id })} />
}

function ListaDeCampanhas({ onNova, onAbrir }: { onNova: () => void; onAbrir: (c: Campanha) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['email-campanhas'],
    queryFn: () => api.get<{ campanhas: Campanha[] }>('/email-campanhas'),
    refetchInterval: (q) => ((q.state.data as { campanhas: Campanha[] } | undefined)?.campanhas.some((c) => c.status === 'enviando') ? 10_000 : false),
  })
  const campanhas = data?.campanhas ?? []
  return (
    <Page title="E-mail Marketing" description="Campanhas de e-mail para a sua base, com acompanhamento de entrega, abertura e clique."
      actions={<Button variant="primary" onClick={onNova}><Mail size={14} /> Nova campanha</Button>}>
      {isLoading ? <div class="text-sm text-fg-muted">Carregando…</div>
        : !campanhas.length ? (
          <EmptyState icon={<Mail size={28} />} title="Nenhuma campanha ainda"
            description="Monte o e-mail em Modelos › E-mail (aba Arrastar e soltar) e crie aqui a campanha: escolha o público, o assunto e envie ou agende."
            action={<Button variant="primary" onClick={onNova}>Criar a primeira campanha</Button>} />
        ) : (
          <div class="grid gap-3">
            {campanhas.map((c) => {
              const m = c.numeros?.metricas.total
              const and = c.numeros?.andamento
              const feitos = and ? and.enviado + and.falhou + and.ignorado : 0
              return (
                <Card key={c.id} class="cursor-pointer hover:border-accent/50 transition-colors" onClick={() => onAbrir(c)}>
                  <div class="flex flex-wrap items-start gap-3">
                    <div class="flex-1 min-w-[220px]">
                      <div class="flex items-center gap-2 flex-wrap">
                        <strong class="text-sm">{c.nome}</strong>
                        <Badge tone={STATUS[c.status]?.[1] ?? 'neutral'}>{STATUS[c.status]?.[0] ?? c.status}</Badge>
                        {c.assuntoB && <Badge tone="info">A/B</Badge>}
                      </div>
                      <div class="text-xs text-fg-muted mt-0.5 truncate">{c.assunto}</div>
                      <div class="text-2xs text-fg-muted mt-1">
                        {c.status === 'agendada' ? `Agendada para ${quando(c.agendadaPara)}` : c.iniciadaEm ? `Iniciada ${quando(c.iniciadaEm)}` : `Criada ${quando(c.createdAt)}`}
                      </div>
                    </div>
                    {m && (
                      <div class="flex gap-5 text-right">
                        <Mini rotulo="Enviados" valor={n(m.enviados)} />
                        <Mini rotulo="Entregues" valor={pct(m.entregues, m.enviados)} />
                        <Mini rotulo="Abertura" valor={pct(m.abertos, m.entregues)} />
                        <Mini rotulo="Cliques" valor={pct(m.clicados, m.entregues)} />
                      </div>
                    )}
                  </div>
                  {c.status === 'enviando' && c.total > 0 && <Barra valor={feitos} total={c.total} />}
                </Card>
              )
            })}
          </div>
        )}
    </Page>
  )
}

function Mini({ rotulo, valor }: { rotulo: string; valor: string }) {
  return <div><div class="text-2xs text-fg-muted">{rotulo}</div><div class="text-sm font-semibold tabular-nums">{valor}</div></div>
}

function Barra({ valor, total }: { valor: number; total: number }) {
  const p = total > 0 ? Math.min(100, Math.round((valor / total) * 100)) : 0
  return (
    <div class="mt-3">
      <div class="h-1.5 rounded-full bg-surface-2 overflow-hidden" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100} aria-label="Andamento do envio">
        <div class="h-full bg-accent transition-all" style={{ width: `${p}%` }} />
      </div>
      <div class="text-2xs text-fg-muted mt-1 tabular-nums">{n(valor)} de {n(total)} ({p}%)</div>
    </div>
  )
}

// ── Criar / editar ─────────────────────────────────────────────────────────

function EditorDeCampanha({ id, onSair }: { id: number | null; onSair: (id?: number) => void }) {
  const qc = useQueryClient()
  const { data: opcoes } = useQuery({ queryKey: ['email-campanhas-opcoes'], queryFn: () => api.get<Opcoes>('/email-campanhas/opcoes') })
  const { data: atual } = useQuery({ queryKey: ['email-campanha', id], queryFn: () => api.get<{ campanha: Campanha }>(`/email-campanhas/${id}`), enabled: !!id })
  const [nome, setNome] = useState('')
  const [templateId, setTemplateId] = useState<number | null>(null)
  const [assunto, setAssunto] = useState('')
  const [comB, setComB] = useState(false)
  const [assuntoB, setAssuntoB] = useState('')
  const [publico, setPublico] = useState<Publico>({ tagModo: 'qualquer' })
  const [agendar, setAgendar] = useState(false)
  const [agendadaPara, setAgendadaPara] = useState('')
  const [destinoTeste, setDestinoTeste] = useState('')
  const [confirmar, setConfirmar] = useState(false)

  useEffect(() => {
    const c = atual?.campanha
    if (!c) return
    setNome(c.nome); setTemplateId(c.templateId ?? null); setAssunto(c.assunto)
    setComB(!!c.assuntoB); setAssuntoB(c.assuntoB ?? ''); setPublico({ tagModo: 'qualquer', ...(c.publico ?? {}) })
    if (c.agendadaPara) { setAgendar(true); setAgendadaPara(c.agendadaPara.slice(0, 16)) }
  }, [atual])

  // Prévia do público: recalcula meio segundo depois da última mudança nos filtros.
  const [previa, setPrevia] = useState<Previa | null>(null)
  useEffect(() => {
    const t = setTimeout(() => {
      api.post<Previa>('/email-campanhas/previa', { publico }).then(setPrevia).catch((e) => toast((e as Error).message, 'danger'))
    }, 500)
    return () => clearTimeout(t)
  }, [JSON.stringify(publico)])

  const corpo = () => ({ nome, templateId, assunto, assuntoB: comB ? assuntoB : null, publico })
  const salvar = useMutation({
    mutationFn: () => (id ? api.put<{ campanha: Campanha }>(`/email-campanhas/${id}`, corpo()) : api.post<{ campanha: Campanha }>('/email-campanhas', corpo())),
    onError: (e: Error) => toast(e.message, 'danger'),
  })
  const enviar = useMutation({
    mutationFn: async () => {
      const r = await salvar.mutateAsync()
      const quandoEnviar = agendar && agendadaPara ? new Date(agendadaPara).toISOString() : null
      await api.post(`/email-campanhas/${r.campanha.id}/enviar`, { agendadaPara: quandoEnviar })
      return r.campanha.id
    },
    onSuccess: (cid) => { qc.invalidateQueries({ queryKey: ['email-campanhas'] }); toast(agendar ? 'Campanha agendada' : 'Envio iniciado', 'success'); onSair(cid) },
    onError: (e: Error) => toast(e.message, 'danger'),
  })
  const teste = useMutation({
    mutationFn: () => api.post<{ enviados: number }>('/email-campanhas/teste', { to: destinoTeste.trim(), templateId, assunto, assuntoB: comB ? assuntoB : '' }),
    onSuccess: (r) => toast(`${r.enviados === 2 ? 'Versões A e B enviadas' : 'Teste enviado'} para ${destinoTeste.trim()}`, 'success'),
    onError: (e: Error) => toast(e.message, 'danger'),
  })

  const funil = opcoes?.funis.find((f) => f.id === publico.funnelId)
  const modelo = opcoes?.modelos.find((m) => m.id === templateId)
  const alternar = (campo: 'etapas' | 'origens', v: string) => setPublico((p) => {
    const atual: string[] = p[campo] ?? []
    return { ...p, [campo]: atual.includes(v) ? atual.filter((x) => x !== v) : [...atual, v] }
  })
  const alternarTag = (tid: number) => setPublico((p) => ({ ...p, tagIds: (p.tagIds ?? []).includes(tid) ? (p.tagIds ?? []).filter((x) => x !== tid) : [...(p.tagIds ?? []), tid] }))
  const pronto = !!nome.trim() && !!templateId && !!assunto.trim() && (!comB || !!assuntoB.trim()) && !!previa?.aEnviar && (!agendar || !!agendadaPara)

  return (
    <Page title={id ? 'Editar campanha' : 'Nova campanha'} description="Conteúdo, público e envio."
      actions={<Button variant="ghost" onClick={() => onSair()}><ArrowLeft size={14} /> Voltar</Button>}>
      <div class="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div class="grid gap-4 min-w-0">
          <Card>
            <h3 class="text-sm font-semibold mb-3">1. Conteúdo</h3>
            <div class="grid gap-3">
              <Input label="Nome da campanha (interno)" value={nome} onInput={(e) => setNome((e.target as HTMLInputElement).value)} placeholder="Ex.: Vestibular de verão — 1º aviso" />
              <Select label="Modelo de e-mail" value={templateId ?? ''} onChange={(e) => {
                const v = Number((e.target as HTMLSelectElement).value) || null
                setTemplateId(v)
                const m = opcoes?.modelos.find((x) => x.id === v)
                if (m?.assunto && !assunto) setAssunto(m.assunto)
              }} hint={modelo && !modelo.temConteudo ? 'Este modelo ainda não tem conteúdo de e-mail.' : 'Crie e edite os modelos em Modelos › E-mail.'}>
                <option value="">Escolha…</option>
                {opcoes?.modelos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
              </Select>
              <Input label={comB ? 'Assunto A' : 'Assunto'} value={assunto} onInput={(e) => setAssunto((e.target as HTMLInputElement).value)} placeholder="Ex.: {{nome}}, sua vaga está garantida" />
              <label class="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={comB} onChange={(e) => setComB((e.target as HTMLInputElement).checked)} />
                Testar dois assuntos (A/B) — metade da lista recebe cada um
              </label>
              {comB && <Input label="Assunto B" value={assuntoB} onInput={(e) => setAssuntoB((e.target as HTMLInputElement).value)} />}
            </div>
          </Card>

          <Card>
            <h3 class="text-sm font-semibold mb-1">2. Público</h3>
            <p class="text-xs text-fg-muted mb-3">Sem filtro = todos os leads com e-mail. O público é recalculado quando o envio começa.</p>
            <div class="grid gap-4">
              <div class="grid gap-3 sm:grid-cols-2">
                <Select label="Funil" value={publico.funnelId ?? ''} onChange={(e) => setPublico((p) => ({ ...p, funnelId: Number((e.target as HTMLSelectElement).value) || null, etapas: [] }))}>
                  <option value="">Todos os funis</option>
                  {opcoes?.funis.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </Select>
                <div class="grid grid-cols-2 gap-2">
                  <Input label="Cadastrados de" type="date" value={publico.criadoDe ?? ''} onInput={(e) => setPublico((p) => ({ ...p, criadoDe: (e.target as HTMLInputElement).value || null }))} />
                  <Input label="até" type="date" value={publico.criadoAte ?? ''} onInput={(e) => setPublico((p) => ({ ...p, criadoAte: (e.target as HTMLInputElement).value || null }))} />
                </div>
              </div>
              {funil && (
                <Fichas titulo="Etapas" vazio="Todas as etapas" itens={funil.stages.map((s) => ({ id: s.key, rotulo: s.name }))} marcados={publico.etapas ?? []} onAlternar={(v) => alternar('etapas', v)} />
              )}
              {!!opcoes?.tags.length && (
                <div>
                  <Fichas titulo="Tags" vazio="Qualquer tag" itens={opcoes.tags.map((t) => ({ id: String(t.id), rotulo: t.name }))} marcados={(publico.tagIds ?? []).map(String)} onAlternar={(v) => alternarTag(Number(v))} />
                  {(publico.tagIds?.length ?? 0) > 1 && (
                    <div class="mt-1.5 flex gap-3 text-xs">
                      {(['qualquer', 'todas'] as const).map((m) => (
                        <label key={m} class="flex items-center gap-1 cursor-pointer">
                          <input type="radio" name="tagModo" checked={publico.tagModo === m} onChange={() => setPublico((p) => ({ ...p, tagModo: m }))} />
                          {m === 'qualquer' ? 'Tem qualquer uma' : 'Tem todas'}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {!!opcoes?.origens.length && (
                <Fichas titulo="Origem" vazio="Qualquer origem" itens={opcoes.origens.map((o) => ({ id: o.valor, rotulo: `${ORIGENS[o.valor] ?? o.valor} (${n(o.leads)})` }))} marcados={publico.origens ?? []} onAlternar={(v) => alternar('origens', v)} />
              )}
              <div class="grid gap-3 sm:grid-cols-2">
                <Input label="Cidade contém" value={publico.cidade ?? ''} onInput={(e) => setPublico((p) => ({ ...p, cidade: (e.target as HTMLInputElement).value || null }))} />
                <Input label="Segmento contém" value={publico.segmento ?? ''} onInput={(e) => setPublico((p) => ({ ...p, segmento: (e.target as HTMLInputElement).value || null }))} />
              </div>
            </div>
          </Card>

          <Card>
            <h3 class="text-sm font-semibold mb-3">3. Envio</h3>
            <div class="grid gap-3">
              <div class="flex flex-wrap gap-4 text-sm">
                <label class="flex items-center gap-1.5 cursor-pointer"><input type="radio" name="quando" checked={!agendar} onChange={() => setAgendar(false)} /> Enviar agora</label>
                <label class="flex items-center gap-1.5 cursor-pointer"><input type="radio" name="quando" checked={agendar} onChange={() => setAgendar(true)} /> Agendar</label>
              </div>
              {agendar && <Input label="Data e hora" type="datetime-local" value={agendadaPara} onInput={(e) => setAgendadaPara((e.target as HTMLInputElement).value)} />}
              <div class="flex flex-wrap items-end gap-2 pt-2 border-t border-border">
                <div class="flex-1 min-w-[200px]"><Input label="Enviar um teste para" type="email" value={destinoTeste} placeholder="seu@email.com" onInput={(e) => setDestinoTeste((e.target as HTMLInputElement).value)} /></div>
                <Button variant="secondary" size="sm" disabled={!templateId || !destinoTeste.trim() || teste.isPending} onClick={() => teste.mutate()}>{teste.isPending ? 'Enviando…' : 'Enviar teste'}</Button>
              </div>
            </div>
          </Card>
        </div>

        <div class="grid gap-4 content-start lg:sticky lg:top-4">
          <Card>
            <h3 class="text-sm font-semibold mb-2 flex items-center gap-1.5"><Users size={14} /> Quem vai receber</h3>
            {!previa ? <div class="text-sm text-fg-muted">Calculando…</div> : (
              <div class="grid gap-2 text-sm">
                <div class="text-3xl font-semibold tabular-nums">{n(previa.aEnviar)}</div>
                <div class="text-xs text-fg-muted">de {n(previa.encontrados)} leads no filtro</div>
                <ul class="text-xs text-fg-muted grid gap-0.5">
                  {previa.fora.repetidos > 0 && <li>{n(previa.fora.repetidos)} com e-mail repetido (recebem uma vez)</li>}
                  {previa.fora.descadastrados > 0 && <li>{n(previa.fora.descadastrados)} descadastrados</li>}
                  {previa.fora.bloqueados > 0 && <li>{n(previa.fora.bloqueados)} bloqueados (bounce ou spam)</li>}
                  {previa.fora.semEmail > 0 && <li>{n(previa.fora.semEmail)} sem e-mail válido</li>}
                </ul>
                {previa.plano.incluido != null && (
                  <div class="mt-2 pt-2 border-t border-border text-xs">
                    <div>Plano do mês: {n(previa.plano.usado)} de {n(previa.plano.incluido)} e-mails usados</div>
                    {previa.excedente && previa.excedente.quantidade > 0 ? (
                      <div class="text-warning mt-1">
                        Este envio passa {n(previa.excedente.quantidade)} e-mails do plano
                        {previa.excedente.valor != null && <> — excedente estimado de <strong>{brl(previa.excedente.valor)}</strong></>}.
                      </div>
                    ) : <div class="text-success mt-1">Cabe no plano do mês.</div>}
                  </div>
                )}
              </div>
            )}
          </Card>
          <div class="grid gap-2">
            <Button variant="primary" disabled={!pronto || enviar.isPending} onClick={() => setConfirmar(true)}>
              {agendar ? <><Clock size={14} /> Agendar envio</> : <><Send size={14} /> Enviar agora</>}
            </Button>
            <Button variant="secondary" disabled={!nome.trim() || !templateId || !assunto.trim() || salvar.isPending}
              onClick={() => salvar.mutate(undefined, { onSuccess: () => { qc.invalidateQueries({ queryKey: ['email-campanhas'] }); toast('Rascunho salvo', 'success'); onSair() } })}>
              Salvar rascunho
            </Button>
          </div>
        </div>
      </div>
      <ConfirmDialog open={confirmar} onOpenChange={setConfirmar}
        title={agendar ? 'Agendar a campanha?' : 'Enviar a campanha agora?'}
        description={`${n(previa?.aEnviar ?? 0)} pessoas vão receber "${assunto}"${comB ? ' ou o assunto B' : ''}${agendar && agendadaPara ? ` em ${new Date(agendadaPara).toLocaleString('pt-BR')}` : ''}. Dá para pausar ou cancelar depois, mas o que já saiu não volta.`}
        confirmLabel={agendar ? 'Agendar' : 'Enviar'} loading={enviar.isPending}
        onConfirm={() => { setConfirmar(false); enviar.mutate() }} />
    </Page>
  )
}

function Fichas({ titulo, vazio, itens, marcados, onAlternar }: { titulo: string; vazio: string; itens: Array<{ id: string; rotulo: string }>; marcados: string[]; onAlternar: (id: string) => void }) {
  return (
    <div>
      <div class="text-xs font-medium text-fg-muted mb-1.5">{titulo} <span class="font-normal">— {marcados.length ? `${marcados.length} escolhida(s)` : vazio}</span></div>
      <div class="flex flex-wrap gap-1.5">
        {itens.map((i) => {
          const on = marcados.includes(i.id)
          return (
            <button key={i.id} type="button" aria-pressed={on} onClick={() => onAlternar(i.id)}
              class={`h-7 px-2.5 rounded-full border text-xs transition-colors ${on ? 'border-accent bg-accent/10 text-accent' : 'border-border text-fg-muted hover:text-fg'}`}>
              {i.rotulo}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Detalhe / acompanhamento ───────────────────────────────────────────────

const ENVIO: Record<string, [string, 'neutral' | 'info' | 'success' | 'warning' | 'danger']> = {
  pendente: ['Na fila', 'neutral'], enviado: ['Enviado', 'success'], falhou: ['Falhou', 'danger'], ignorado: ['Ignorado', 'warning'],
}
const ACOMP: Record<string, string> = { sent: 'aceito', delivered: 'entregue', opened: 'aberto', clicked: 'clicado', bounced: 'devolvido', complained: 'spam', failed: 'falhou' }

function DetalheDaCampanha({ id, onVoltar, onEditar }: { id: number; onVoltar: () => void; onEditar: () => void }) {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['email-campanha', id],
    queryFn: () => api.get<{ campanha: Campanha; numeros: Numeros }>(`/email-campanhas/${id}`),
    refetchInterval: (q) => (['enviando', 'agendada'].includes((q.state.data as any)?.campanha?.status) ? 8_000 : 30_000),
  })
  const [filtro, setFiltro] = useState('')
  const [busca, setBusca] = useState('')
  const [pagina, setPagina] = useState(1)
  const { data: envios } = useQuery({
    queryKey: ['email-campanha-envios', id, filtro, busca, pagina],
    queryFn: () => api.get<{ total: number; itens: Array<{ id: number; email: string; variante: string; status: string; motivo: string | null; enviadoEm: string | null; acompanhamento: { status: string; opens: number; clicks: number } | null }> }>(
      `/email-campanhas/${id}/envios?pagina=${pagina}${filtro ? `&status=${filtro}` : ''}${busca ? `&busca=${encodeURIComponent(busca)}` : ''}`),
  })
  const [confirmar, setConfirmar] = useState<null | 'cancelar' | 'excluir'>(null)
  const acao = useMutation({
    mutationFn: (a: string) => (a === 'excluir' ? api.delete(`/email-campanhas/${id}`) : api.post(`/email-campanhas/${id}/${a}`)),
    onSuccess: (_r, a) => { qc.invalidateQueries({ queryKey: ['email-campanhas'] }); qc.invalidateQueries({ queryKey: ['email-campanha', id] }); if (a === 'excluir') onVoltar() },
    onError: (e: Error) => toast(e.message, 'danger'),
  })
  const c = data?.campanha
  const nums = data?.numeros
  if (!c || !nums) return <Page title="Campanha"><div class="text-sm text-fg-muted">Carregando…</div></Page>
  const m = nums.metricas.total
  const and = nums.andamento
  const feitos = and.enviado + and.falhou + and.ignorado

  return (
    <Page title={c.nome} description={c.assuntoB ? `A: ${c.assunto} · B: ${c.assuntoB}` : c.assunto}
      actions={
        <div class="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={onVoltar}><ArrowLeft size={14} /> Campanhas</Button>
          {c.status === 'agendada' && <Button variant="secondary" onClick={onEditar}><Pencil size={14} /> Editar</Button>}
          {['enviando', 'agendada'].includes(c.status) && <Button variant="secondary" onClick={() => acao.mutate('pausar')}><Pause size={14} /> Pausar</Button>}
          {c.status === 'pausada' && <Button variant="primary" onClick={() => acao.mutate('retomar')}><Play size={14} /> Retomar</Button>}
          {['enviando', 'pausada', 'agendada'].includes(c.status) && <Button variant="ghost" onClick={() => setConfirmar('cancelar')}><XIcon size={14} /> Cancelar</Button>}
          {['concluida', 'cancelada'].includes(c.status) && <Button variant="ghost" onClick={() => setConfirmar('excluir')}><Trash2 size={14} /> Excluir</Button>}
        </div>
      }>
      <div class="grid gap-4">
        <Card>
          <div class="flex flex-wrap items-center gap-2 mb-2">
            <Badge tone={STATUS[c.status]?.[1] ?? 'neutral'}>{STATUS[c.status]?.[0] ?? c.status}</Badge>
            <span class="text-xs text-fg-muted">
              {c.status === 'agendada' ? `Começa ${quando(c.agendadaPara)}` : `Iniciada ${quando(c.iniciadaEm)}`}
              {c.concluidaEm && ` · terminou ${quando(c.concluidaEm)}`}
            </span>
          </div>
          {c.total > 0 && <Barra valor={feitos} total={c.total} />}
          <div class="flex flex-wrap gap-4 mt-2 text-xs text-fg-muted">
            <span>Na fila: {n(and.pendente)}</span><span>Enviados: {n(and.enviado)}</span>
            <span>Ignorados: {n(and.ignorado)}</span><span>Falhas: {n(and.falhou)}</span>
          </div>
        </Card>

        <div class="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          <Kpi rotulo="Entregues" valor={n(m.entregues)} sub={pct(m.entregues, m.enviados)} />
          <Kpi rotulo="Abertos" valor={n(m.abertos)} sub={`${pct(m.abertos, m.entregues)} dos entregues`} />
          <Kpi rotulo="Cliques" valor={n(m.clicados)} sub={`${pct(m.clicados, m.entregues)} dos entregues`} />
          <Kpi rotulo="Devolvidos" valor={n(m.bounces)} sub={pct(m.bounces, m.enviados)} alerta={m.enviados > 0 && m.bounces / m.enviados > 0.04} />
          <Kpi rotulo="Spam" valor={n(m.spam)} sub={pct(m.spam, m.entregues)} alerta={m.spam > 0 && m.entregues > 0 && m.spam / m.entregues > 0.001} />
          <Kpi rotulo="Descadastros" valor={n(nums.descadastros)} sub={pct(nums.descadastros, m.entregues)} />
        </div>
        {(m.bounces / Math.max(1, m.enviados) > 0.04 || m.spam / Math.max(1, m.entregues) > 0.001) && (
          <p class="text-xs text-danger">Taxa alta de devolução ou spam: o domínio de envio é compartilhado, e números assim derrubam a entrega de todos. Revise a lista antes da próxima campanha.</p>
        )}

        {c.assuntoB && (
          <Card>
            <h3 class="text-sm font-semibold mb-2">Teste A/B de assunto</h3>
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead><tr class="text-left text-xs text-fg-muted"><th class="py-1.5 pr-3 font-medium">Versão</th><th class="py-1.5 pr-3 font-medium">Enviados</th><th class="py-1.5 pr-3 font-medium">Abertura</th><th class="py-1.5 font-medium">Cliques</th></tr></thead>
                <tbody>
                  {(['A', 'B'] as const).map((v) => {
                    const x = nums.metricas[v]
                    const outro = nums.metricas[v === 'A' ? 'B' : 'A']
                    const vence = x.entregues > 0 && outro.entregues > 0 && x.abertos / x.entregues > outro.abertos / outro.entregues
                    return (
                      <tr key={v} class="border-t border-border">
                        <td class="py-1.5 pr-3"><strong>{v}</strong> <span class="text-fg-muted">{v === 'A' ? c.assunto : c.assuntoB}</span> {vence && <Badge tone="success">mais aberto</Badge>}</td>
                        <td class="py-1.5 pr-3 tabular-nums">{n(x.enviados)}</td>
                        <td class="py-1.5 pr-3 tabular-nums">{pct(x.abertos, x.entregues)}</td>
                        <td class="py-1.5 tabular-nums">{pct(x.clicados, x.entregues)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <Card>
          <div class="flex flex-wrap items-end gap-2 mb-3">
            <h3 class="text-sm font-semibold mr-auto">Destinatários</h3>
            <Select label="Situação" value={filtro} onChange={(e) => { setFiltro((e.target as HTMLSelectElement).value); setPagina(1) }}>
              <option value="">Todos</option>
              {Object.entries(ENVIO).map(([k, [r]]) => <option key={k} value={k}>{r}</option>)}
            </Select>
            <Input label="Buscar e-mail" value={busca} onInput={(e) => { setBusca((e.target as HTMLInputElement).value); setPagina(1) }} />
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead><tr class="text-left text-xs text-fg-muted"><th class="py-1.5 pr-3 font-medium">E-mail</th>{c.assuntoB && <th class="py-1.5 pr-3 font-medium">Versão</th>}<th class="py-1.5 pr-3 font-medium">Situação</th><th class="py-1.5 pr-3 font-medium">Acompanhamento</th><th class="py-1.5 font-medium">Enviado</th></tr></thead>
              <tbody>
                {envios?.itens.map((e) => (
                  <tr key={e.id} class="border-t border-border">
                    <td class="py-1.5 pr-3 break-all">{e.email}</td>
                    {c.assuntoB && <td class="py-1.5 pr-3">{e.variante}</td>}
                    <td class="py-1.5 pr-3"><Badge tone={ENVIO[e.status]?.[1] ?? 'neutral'}>{ENVIO[e.status]?.[0] ?? e.status}</Badge>{e.motivo && <div class="text-2xs text-fg-muted">{e.motivo}</div>}</td>
                    <td class="py-1.5 pr-3 text-xs">{e.acompanhamento ? `${ACOMP[e.acompanhamento.status] ?? e.acompanhamento.status}${e.acompanhamento.clicks ? ` · ${e.acompanhamento.clicks} clique(s)` : ''}` : '—'}</td>
                    <td class="py-1.5 text-xs text-fg-muted whitespace-nowrap">{quando(e.enviadoEm)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {envios && envios.total > 50 && (
            <div class="flex items-center justify-end gap-2 mt-3 text-xs">
              <Button variant="ghost" size="sm" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>Anterior</Button>
              <span class="tabular-nums">{pagina} de {Math.ceil(envios.total / 50)}</span>
              <Button variant="ghost" size="sm" disabled={pagina >= Math.ceil(envios.total / 50)} onClick={() => setPagina((p) => p + 1)}>Próxima</Button>
            </div>
          )}
        </Card>
      </div>
      <ConfirmDialog open={!!confirmar} onOpenChange={(o) => !o && setConfirmar(null)} destructive
        title={confirmar === 'excluir' ? 'Excluir a campanha?' : 'Cancelar a campanha?'}
        description={confirmar === 'excluir' ? 'A campanha e o histórico dos destinatários somem desta tela. Os e-mails já enviados continuam no histórico de cada lead.' : 'Quem ainda está na fila não recebe mais. O que já foi enviado não volta.'}
        confirmLabel={confirmar === 'excluir' ? 'Excluir' : 'Cancelar campanha'}
        onConfirm={() => { const a = confirmar!; setConfirmar(null); acao.mutate(a) }} />
    </Page>
  )
}

function Kpi({ rotulo, valor, sub, alerta }: { rotulo: string; valor: string; sub: string; alerta?: boolean }) {
  return (
    <Card class={alerta ? 'border-danger/60' : ''}>
      <div class="text-2xs text-fg-muted">{rotulo}</div>
      <div class={`text-xl font-semibold tabular-nums ${alerta ? 'text-danger' : ''}`}>{valor}</div>
      <div class="text-2xs text-fg-muted">{sub}</div>
    </Card>
  )
}
