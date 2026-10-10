// Caixa de escrita da Equipe: Enter envia (Shift+Enter quebra a linha), "@"
// abre pessoas e equipes, "+" cria cartão (lead, indicação, transferência,
// negociação, tarefa) ou anexa arquivo. Responder e editar usam a mesma caixa.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input, Select } from '@/components/ui/Input'
import { Avatar } from '@/components/ui/Avatar'
import { toast } from '@/lib/toast'
import { ApiError } from '@/lib/apiClient'
import {
  Send, Plus, Paperclip, X, Users2, UserPlus, ArrowRightLeft, Briefcase, CheckSquare, Pencil, CornerUpLeft, Search,
} from '@/components/ui/icon-set'
import {
  buscarReferencias, enviarAnexo, useAcoesDaEquipe, usePessoasDaEquipe,
  type AnexoEquipe, type DetalhesDaConversa, type MensagemEquipe,
} from '@/hooks/useEquipe'

type TipoCartao = 'lead' | 'indicacao' | 'transferencia' | 'negociacao' | 'tarefa'
type Mencao = { rotulo: string; token: string }

const semTokens = (s: string) => s.replace(/@\[([^\]]+)\]\([ut]:\d+\)/g, '@$1')

export function EscreverNaEquipe(props: {
  conversa: DetalhesDaConversa
  meuId: number
  respondendo: MensagemEquipe | null
  editando: MensagemEquipe | null
  onCancelar: () => void
  onEnviou: () => void
}) {
  const { conversa } = props
  const { enviar, editar } = useAcoesDaEquipe()
  const pessoasQ = usePessoasDaEquipe()
  const [texto, setTexto] = useState('')
  const [mencoes, setMencoes] = useState<Mencao[]>([])
  const [anexos, setAnexos] = useState<AnexoEquipe[]>([])
  const [subindo, setSubindo] = useState(false)
  const [menu, setMenu] = useState(false)
  const [cartao, setCartao] = useState<TipoCartao | null>(null)
  const [busca, setBusca] = useState<{ termo: string; inicio: number } | null>(null)
  const [sel, setSel] = useState(0)
  const area = useRef<HTMLTextAreaElement | null>(null)
  const arquivo = useRef<HTMLInputElement | null>(null)
  // Onde o cursor deve ficar depois que o texto mudou por código (menção):
  // aplicado logo após a renderização, antes da próxima tecla.
  const cursorAlvo = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (cursorAlvo.current === null || !area.current) return
    const p = cursorAlvo.current
    cursorAlvo.current = null
    area.current.focus()
    area.current.setSelectionRange(p, p)
  }, [texto])

  // Editar: o texto volta sem os códigos das menções (e as menções guardadas).
  useEffect(() => {
    if (props.editando?.corpo) {
      const ms: Mencao[] = []
      for (const m of props.editando.corpo.matchAll(/@\[([^\]]+)\]\(([ut]:\d+)\)/g)) ms.push({ rotulo: m[1]!, token: m[0] })
      setMencoes(ms)
      setTexto(semTokens(props.editando.corpo))
      setTimeout(() => area.current?.focus(), 0)
    }
  }, [props.editando?.id])
  useEffect(() => { if (props.respondendo) setTimeout(() => area.current?.focus(), 0) }, [props.respondendo?.id])

  // Ajusta a altura da caixa ao texto (até ~6 linhas).
  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`
  }, [texto])

  const candidatos = useMemo(() => {
    if (!busca) return []
    const t = busca.termo.toLowerCase()
    const membros = conversa.membros.filter((m) => m.id !== props.meuId).map((m) => ({ tipo: 'u' as const, id: m.id, nome: m.nome, sub: m.online ? 'online' : '' }))
    const equipes = (pessoasQ.data?.equipes ?? []).map((e) => ({ tipo: 't' as const, id: e.id, nome: e.name, sub: 'equipe' }))
    return [...membros, ...equipes].filter((c) => c.nome.toLowerCase().includes(t)).slice(0, 8)
  }, [busca, conversa.membros, pessoasQ.data])

  function aoDigitar(v: string, cursor: number) {
    setTexto(v)
    const antes = v.slice(0, cursor)
    const m = /(^|\s)@([\p{L}\p{N} ]{0,30})$/u.exec(antes)
    if (m) { setBusca({ termo: m[2]!, inicio: cursor - m[2]!.length - 1 }); setSel(0) } else setBusca(null)
  }

  function escolherMencao(c: { tipo: 'u' | 't'; id: number; nome: string }) {
    if (!busca) return
    const rotulo = c.nome
    const antes = texto.slice(0, busca.inicio)
    const depois = texto.slice(busca.inicio + 1 + busca.termo.length)
    const novo = `${antes}@${rotulo} ${depois}`
    setTexto(novo)
    setMencoes((ms) => [...ms.filter((x) => x.rotulo !== rotulo), { rotulo, token: `@[${rotulo}](${c.tipo}:${c.id})` }])
    setBusca(null)
    cursorAlvo.current = antes.length + rotulo.length + 2
  }

  /** "@Nome" escolhido na lista vira o código da menção, só no envio. */
  function comTokens(s: string) {
    let out = s
    for (const m of mencoes) out = out.split(`@${m.rotulo}`).join(m.token)
    return out
  }

  async function mandar() {
    const corpo = comTokens(texto.trim())
    if (!corpo && !anexos.length) return
    try {
      if (props.editando) {
        await editar.mutateAsync({ id: props.editando.id, corpo, conversaId: conversa.id })
      } else {
        await enviar.mutateAsync({ conversaId: conversa.id, corpo, anexos, respostaAId: props.respondendo?.id ?? null })
      }
      setTexto(''); setMencoes([]); setAnexos([])
      props.onEnviou()
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Não foi possível enviar.', 'danger')
    }
  }

  async function anexar(arquivos: FileList | null) {
    if (!arquivos?.length) return
    setSubindo(true)
    try {
      for (const f of [...arquivos].slice(0, 5)) {
        if (f.size > 25 * 1024 * 1024) { toast(`${f.name}: máximo 25 MB`, 'danger'); continue }
        const a = await enviarAnexo(f)
        setAnexos((xs) => [...xs, a])
      }
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Falha ao enviar o arquivo.', 'danger')
    } finally {
      setSubindo(false)
      if (arquivo.current) arquivo.current.value = ''
    }
  }

  function teclas(e: KeyboardEvent) {
    if (busca && candidatos.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (s + 1) % candidatos.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (s - 1 + candidatos.length) % candidatos.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); escolherMencao(candidatos[sel]!); return }
      if (e.key === 'Escape') { setBusca(null); return }
    }
    if (e.key === 'Enter' && !e.shiftKey && !(e as any).isComposing) { e.preventDefault(); void mandar() }
    if (e.key === 'Escape' && (props.editando || props.respondendo)) { props.onCancelar(); setTexto(''); setMencoes([]) }
  }

  const ocupado = enviar.isPending || editar.isPending || subindo
  const ITENS: Array<{ tipo: TipoCartao; rotulo: string; desc: string; Icone: any }> = [
    { tipo: 'lead', rotulo: 'Lead', desc: 'Compartilhar um lead', Icone: Users2 },
    { tipo: 'indicacao', rotulo: 'Indicar lead', desc: 'Indicar um lead para alguém', Icone: UserPlus },
    { tipo: 'transferencia', rotulo: 'Transferência', desc: 'Pedir transferência de um lead seu', Icone: ArrowRightLeft },
    { tipo: 'negociacao', rotulo: 'Negociação', desc: 'Compartilhar uma negociação', Icone: Briefcase },
    { tipo: 'tarefa', rotulo: 'Tarefa / pedido de ajuda', desc: 'Pedir algo com prazo', Icone: CheckSquare },
  ]

  return (
    <div class="border-t border-border bg-surface p-2 relative">
      {(props.respondendo || props.editando) && (
        <div class="flex items-center gap-2 rounded-md bg-surface-2 px-2 py-1 mb-1.5 text-2xs">
          {props.editando ? <Pencil size={12} class="text-accent" /> : <CornerUpLeft size={12} class="text-accent" />}
          <div class="min-w-0 flex-1 truncate">
            {props.editando ? 'Editando mensagem' : <>Respondendo <b>{props.respondendo!.autor?.nome}</b>: {semTokens(props.respondendo!.corpo ?? '') || 'cartão/anexo'}</>}
          </div>
          <button type="button" aria-label="Cancelar" class="text-fg-muted hover:text-fg" onClick={() => { props.onCancelar(); if (props.editando) { setTexto(''); setMencoes([]) } }}><X size={12} /></button>
        </div>
      )}
      {anexos.length > 0 && (
        <div class="flex flex-wrap gap-1 mb-1.5">
          {anexos.map((a) => (
            <span key={a.url} class="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-0.5 text-2xs">
              <Paperclip size={11} /> {a.nome}
              <button type="button" aria-label="Remover anexo" onClick={() => setAnexos((xs) => xs.filter((x) => x.url !== a.url))}><X size={11} /></button>
            </span>
          ))}
        </div>
      )}
      {busca && candidatos.length > 0 && (
        <div class="absolute bottom-full left-2 right-2 mb-1 z-30 rounded-md border border-border bg-surface-2 shadow-lg p-1 max-h-60 overflow-y-auto">
          {candidatos.map((c, i) => (
            <button key={`${c.tipo}${c.id}`} type="button" class={cn('flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-left', i === sel ? 'bg-accent/15' : 'hover:bg-surface-3')} onMouseDown={(e) => { e.preventDefault(); escolherMencao(c) }}>
              {c.tipo === 'u' ? <Avatar name={c.nome} seed={c.id} size="sm" round /> : <span class="size-6 grid place-items-center rounded-md bg-warning/15 text-warning"><Users2 size={12} /></span>}
              <span class="flex-1 truncate">{c.nome}</span>
              {c.sub && <span class="text-2xs text-fg-muted">{c.sub}</span>}
            </button>
          ))}
        </div>
      )}
      {menu && (
        <div class="absolute bottom-full left-2 mb-1 z-30 w-64 rounded-md border border-border bg-surface-2 shadow-lg p-1">
          {ITENS.map((it) => (
            <button key={it.tipo} type="button" class="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-surface-3" onClick={() => { setMenu(false); setCartao(it.tipo) }}>
              <it.Icone size={14} class="mt-0.5 text-accent" />
              <span><span class="block text-sm">{it.rotulo}</span><span class="block text-2xs text-fg-muted">{it.desc}</span></span>
            </button>
          ))}
          <button type="button" class="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-surface-3" onClick={() => { setMenu(false); arquivo.current?.click() }}>
            <Paperclip size={14} class="mt-0.5 text-accent" />
            <span><span class="block text-sm">Arquivo</span><span class="block text-2xs text-fg-muted">Imagem, PDF, planilha… (até 25 MB)</span></span>
          </button>
        </div>
      )}
      <div class="flex items-end gap-1.5">
        {!props.editando && (
          <button type="button" class={cn('size-9 shrink-0 grid place-items-center rounded-full hover:bg-surface-3', menu ? 'text-accent' : 'text-fg-muted')} aria-label="Cartões e anexos" title="Cartões e anexos" onClick={() => setMenu((v) => !v)}>
            <Plus size={18} />
          </button>
        )}
        <textarea
          ref={area}
          rows={1}
          value={texto}
          placeholder={props.editando ? 'Editar mensagem' : 'Mensagem — use @ para mencionar'}
          class="flex-1 resize-none rounded-2xl border border-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 max-h-[150px]"
          onInput={(e) => { const el = e.target as HTMLTextAreaElement; aoDigitar(el.value, el.selectionStart ?? el.value.length) }}
          onKeyDown={teclas as any}
          onBlur={() => setTimeout(() => setBusca(null), 150)}
        />
        <button type="button" class="size-9 shrink-0 grid place-items-center rounded-full bg-accent text-fg-on-brand disabled:opacity-50" aria-label="Enviar" title="Enviar (Enter)" disabled={ocupado || (!texto.trim() && !anexos.length)} onClick={() => void mandar()}>
          <Send size={16} />
        </button>
      </div>
      <input ref={arquivo} type="file" multiple class="hidden" onChange={(e) => void anexar((e.target as HTMLInputElement).files)} />
      {cartao && (
        <NovoCartao
          tipo={cartao}
          conversa={conversa}
          meuId={props.meuId}
          onClose={() => setCartao(null)}
          onEnviar={async (dados) => {
            await enviar.mutateAsync({ conversaId: conversa.id, cartao: dados, respostaAId: props.respondendo?.id ?? null })
            setCartao(null)
            props.onEnviou()
          }}
        />
      )}
    </div>
  )
}

// ─── Criar cartão ───────────────────────────────────────────────────────────

function Seletor(props: { tipo: 'lead' | 'negociacao'; valor: any; onChange: (v: any) => void }) {
  const [q, setQ] = useState('')
  const [itens, setItens] = useState<any[]>([])
  const [carregando, setCarregando] = useState(false)
  useEffect(() => {
    let vivo = true
    setCarregando(true)
    const t = setTimeout(() => {
      buscarReferencias(props.tipo, q).then((r) => { if (vivo) setItens(r.itens) }).catch(() => {}).finally(() => { if (vivo) setCarregando(false) })
    }, 250)
    return () => { vivo = false; clearTimeout(t) }
  }, [q, props.tipo])
  if (props.valor) {
    return (
      <div class="flex items-center gap-2 rounded-md border border-accent/40 bg-accent/5 px-2 py-1.5 text-sm">
        <span class="flex-1 truncate">{props.tipo === 'lead' ? props.valor.nome : props.valor.titulo}</span>
        <button type="button" class="text-2xs text-accent" onClick={() => props.onChange(null)}>trocar</button>
      </div>
    )
  }
  return (
    <div class="space-y-1.5">
      <div class="relative">
        <Search size={14} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
        <input
          value={q}
          autoFocus
          placeholder={props.tipo === 'lead' ? 'Buscar lead por nome, telefone ou nº' : 'Buscar negociação ou lead'}
          class="w-full rounded-md border border-border bg-surface-2 pl-8 pr-2 py-1.5 text-sm"
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
        />
      </div>
      <div class="max-h-52 overflow-y-auto rounded-md border border-border divide-y divide-border">
        {carregando && !itens.length ? <div class="p-2 text-xs text-fg-muted">Buscando…</div>
          : !itens.length ? <div class="p-2 text-xs text-fg-muted">Nada encontrado no seu alcance.</div>
          : itens.map((it) => (
            <button key={it.id} type="button" class="block w-full px-2 py-1.5 text-left hover:bg-surface-3" onClick={() => props.onChange(it)}>
              <div class="text-sm truncate">{props.tipo === 'lead' ? it.nome : it.titulo}</div>
              <div class="text-2xs text-fg-muted truncate">
                {props.tipo === 'lead' ? `${it.whatsapp ?? ''}${it.atendente ? ` · ${it.atendente}` : ' · sem atendente'}` : `${it.lead ?? ''}${it.valor != null ? ` · ${it.valor.toLocaleString('pt-BR', { style: 'currency', currency: it.moeda || 'BRL' })}` : ''}`}
              </div>
            </button>
          ))}
      </div>
    </div>
  )
}

function NovoCartao(props: {
  tipo: TipoCartao
  conversa: DetalhesDaConversa
  meuId: number
  onClose: () => void
  onEnviar: (dados: any) => Promise<void>
}) {
  const { tipo, conversa } = props
  const outros = conversa.membros.filter((m) => m.id !== props.meuId)
  const padrao = conversa.tipo === 'direta' ? outros[0]?.id ?? '' : ''
  const [lead, setLead] = useState<any>(null)
  const [neg, setNeg] = useState<any>(null)
  const [para, setPara] = useState<number | ''>(padrao)
  const [motivo, setMotivo] = useState('')
  const [titulo, setTitulo] = useState('')
  const [detalhe, setDetalhe] = useState('')
  const [prazo, setPrazo] = useState('')
  const [comLead, setComLead] = useState(false)
  const [enviando, setEnviando] = useState(false)
  // Conversa de lead: o lead já é este.
  const leadFixo = conversa.tipo === 'lead' && conversa.lead ? conversa.lead : null

  const TITULOS: Record<TipoCartao, string> = {
    lead: 'Compartilhar lead', indicacao: 'Indicar lead', transferencia: 'Pedir transferência',
    negociacao: 'Compartilhar negociação', tarefa: 'Tarefa / pedido de ajuda',
  }
  const leadEscolhido = leadFixo ?? lead
  const precisaPara = tipo === 'transferencia'
  const pronto = tipo === 'negociacao' ? !!neg
    : tipo === 'tarefa' ? !!titulo.trim() && (!comLead || !!leadEscolhido)
    : !!leadEscolhido && (!precisaPara || !!para)

  async function confirmar() {
    const dados: any = { tipo }
    if (tipo === 'negociacao') dados.negociacaoId = neg.id
    else if (tipo === 'tarefa') {
      Object.assign(dados, { titulo: titulo.trim(), detalhe: detalhe.trim() || undefined, prazo: prazo ? new Date(prazo).toISOString() : undefined, paraUserId: para || undefined })
      if (comLead || leadFixo) dados.leadId = leadEscolhido?.id
    } else {
      dados.leadId = leadEscolhido.id
      if (tipo !== 'lead') { dados.paraUserId = para || undefined; dados.motivo = motivo.trim() || undefined }
    }
    setEnviando(true)
    try {
      await props.onEnviar(dados)
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Não foi possível enviar o cartão.', 'danger')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) props.onClose() }}
      title={TITULOS[tipo]}
      size="md"
      footer={(
        <div class="flex justify-end gap-2">
          <Button variant="secondary" onClick={props.onClose}>Cancelar</Button>
          <Button onClick={() => void confirmar()} disabled={!pronto} loading={enviando}>Enviar</Button>
        </div>
      )}
    >
      <div class="space-y-3">
        {tipo === 'negociacao' && <Seletor tipo="negociacao" valor={neg} onChange={setNeg} />}
        {tipo !== 'negociacao' && tipo !== 'tarefa' && (leadFixo
          ? <div class="text-sm">Lead: <b>{leadFixo.nome}</b></div>
          : <Seletor tipo="lead" valor={lead} onChange={setLead} />)}
        {tipo === 'tarefa' && (
          <>
            <Input label="O que precisa ser feito *" value={titulo} placeholder="Ex.: confirmar o pagamento do boleto" onInput={(e) => setTitulo((e.target as HTMLInputElement).value)} />
            <label class="block text-xs text-fg-muted">Detalhes
              <textarea rows={2} value={detalhe} class="mt-1 w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-fg" onInput={(e) => setDetalhe((e.target as HTMLTextAreaElement).value)} />
            </label>
            <Input label="Prazo" type="datetime-local" value={prazo} onInput={(e) => setPrazo((e.target as HTMLInputElement).value)} />
            {!leadFixo && (
              <label class="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={comLead} onChange={(e) => setComLead((e.target as HTMLInputElement).checked)} />
                Sobre um lead (vira atividade em Atividades)
              </label>
            )}
            {comLead && !leadFixo && <Seletor tipo="lead" valor={lead} onChange={setLead} />}
          </>
        )}
        {(tipo === 'indicacao' || tipo === 'transferencia' || tipo === 'tarefa') && conversa.tipo !== 'direta' && (
          <Select label={tipo === 'transferencia' ? 'Transferir para *' : tipo === 'tarefa' ? 'Responsável' : 'Indicar para'} value={String(para)} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; setPara(v ? Number(v) : '') }}>
            <option value="">{tipo === 'transferencia' ? 'Escolha a pessoa' : 'Qualquer pessoa da conversa'}</option>
            {outros.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </Select>
        )}
        {(tipo === 'indicacao' || tipo === 'transferencia') && (
          <Input label={tipo === 'transferencia' ? 'Motivo' : 'Por que você está indicando?'} value={motivo} onInput={(e) => setMotivo((e.target as HTMLInputElement).value)} />
        )}
        {tipo === 'transferencia' && <p class="text-2xs text-fg-muted">Cria um pedido de transferência de verdade: quem recebe aceita ou recusa no próprio cartão. Só o atendente atual do lead (ou um admin) pode pedir.</p>}
        {tipo === 'indicacao' && <p class="text-2xs text-fg-muted">Se o lead estiver sem atendente, quem foi indicado pode assumi-lo direto pelo cartão.</p>}
      </div>
    </Modal>
  )
}
