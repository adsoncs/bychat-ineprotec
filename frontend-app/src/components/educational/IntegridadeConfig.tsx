// Integridade da prova: detecção de IA (limite de tolerância 0–100%),
// similaridade, comportamento de escrita e proteções do editor. Espelha
// backend/src/lib/integridadeRedacao.ts — lá está a regra; aqui, a tela.
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { cn } from '@/lib/cn'
import {
  POLITICA_INTEGRIDADE_PADRAO,
  type AcaoIntegridade,
  type PoliticaIntegridade,
} from '@/hooks/useEducational'

export function lerPoliticaIntegridade(raw: unknown): PoliticaIntegridade {
  return { ...POLITICA_INTEGRIDADE_PADRAO, ...(raw && typeof raw === 'object' ? (raw as Partial<PoliticaIntegridade>) : {}) }
}

const PRESETS: Array<{ nome: string; limite: number; dica: string }> = [
  { nome: 'Rigoroso', limite: 50, dica: 'Mais suspeitas, mais revisão humana' },
  { nome: 'Equilibrado', limite: 70, dica: 'Padrão recomendado' },
  { nome: 'Tolerante', limite: 85, dica: 'Só os casos evidentes' },
]

const ACOES: Array<{ v: AcaoIntegridade; titulo: string; texto: string; tom?: 'recomendado' | 'perigo' }> = [
  { v: 'sinalizar', titulo: 'Só sinalizar', texto: 'A nota segue o fluxo normal; o alerta aparece para o avaliador.' },
  { v: 'revisao', titulo: 'Exigir revisão humana', texto: 'Mesmo com aprovação automática ligada, a redação vai para um avaliador decidir.', tom: 'recomendado' },
  { v: 'reprovar', titulo: 'Reprovar automaticamente', texto: 'Reprova sem revisão. Detectores de IA têm falsos positivos — use só com política institucional clara e permita recurso.', tom: 'perigo' },
]

function Interruptor({ checked, onChange, titulo, texto }: { checked: boolean; onChange: (v: boolean) => void; titulo: string; texto?: string }) {
  return (
    <label class="flex items-start gap-2 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} class="mt-1" />
      <span>
        <span class="text-sm font-medium text-fg">{titulo}</span>
        {texto && <span class="block text-xs text-fg-muted">{texto}</span>}
      </span>
    </label>
  )
}

function EscolhaAcao({ valor, onChange, nome }: { valor: AcaoIntegridade; onChange: (v: AcaoIntegridade) => void; nome: string }) {
  return (
    <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
      {ACOES.map((a) => (
        <button key={a.v} type="button" onClick={() => onChange(a.v)} aria-pressed={valor === a.v} name={nome}
          class={cn('text-left rounded-md border p-2.5 transition-colors',
            valor === a.v ? (a.tom === 'perigo' ? 'border-danger bg-danger/10' : 'border-accent bg-accent/10') : 'border-border bg-surface hover:bg-surface-3')}>
          <div class="text-xs font-semibold text-fg flex items-center gap-1.5">
            <input type="radio" checked={valor === a.v} readOnly />
            {a.titulo}
            {a.tom === 'recomendado' && <span class="text-3xs font-normal text-success">recomendado</span>}
          </div>
          <div class={cn('text-2xs mt-1', a.tom === 'perigo' ? 'text-danger' : 'text-fg-muted')}>{a.texto}</div>
        </button>
      ))}
    </div>
  )
}

/** Régua 0–100 com as três faixas: aceitável, atenção e suspeita. */
export function ReguaIa({ limite, margem, valor }: { limite: number; margem: number; valor?: number | null }) {
  const atencao = Math.max(0, limite - margem)
  return (
    <div class="relative h-3 rounded-full overflow-hidden bg-surface-3" aria-hidden>
      <div class="absolute inset-y-0 left-0 bg-success/50" style={{ width: `${atencao}%` }} />
      <div class="absolute inset-y-0 bg-warning/60" style={{ left: `${atencao}%`, width: `${limite - atencao}%` }} />
      <div class="absolute inset-y-0 right-0 bg-danger/60" style={{ left: `${limite}%` }} />
      <div class="absolute inset-y-0 w-0.5 bg-fg" style={{ left: `calc(${limite}% - 1px)` }} title={`Limite ${limite}%`} />
      {valor != null && (
        <div class="absolute -top-0.5 size-4 rounded-full border-2 border-surface bg-fg shadow" style={{ left: `calc(${valor}% - 8px)` }} title={`${valor}%`} />
      )}
    </div>
  )
}

export function IntegridadeConfig({ valor, onChange }: { valor: PoliticaIntegridade; onChange: (v: PoliticaIntegridade) => void }) {
  const set = <K extends keyof PoliticaIntegridade>(k: K, v: PoliticaIntegridade[K]) => onChange({ ...valor, [k]: v })
  const num = (s: string, min: number, max: number) => Math.max(min, Math.min(max, Math.round(Number(s) || 0)))
  const atencao = Math.max(0, valor.limiteIa - valor.margemAtencao)

  return (
    <Card>
      <div class="mb-3">
        <div class="text-sm font-semibold text-fg">🛡 Integridade da prova e detecção de IA</div>
        <div class="text-xs text-fg-muted mt-0.5">
          Analisada junto com a correção: a nota da IA sai acompanhada do percentual estimado de autoria por IA, da similaridade com outras redações
          e de como o texto foi escrito. É <strong>indício, não prova</strong> — o avaliador vê os sinais e registra a decisão. Nada disso aparece para o candidato.
        </div>
      </div>

      {/* ── Detecção de IA ─────────────────────────────── */}
      <div class="rounded-md border border-border p-3 space-y-3">
        <Interruptor checked={valor.detectarIa} onChange={(v) => set('detectarIa', v)} titulo="Detectar texto gerado por IA"
          texto="Estimativa de 0 a 100% combinando análise linguística (calibrada para o estilo ENEM), estatística do texto e marcas de texto copiado de chatbot." />
        {valor.detectarIa && (
          <>
            <div>
              <div class="flex items-end justify-between gap-3 flex-wrap mb-1.5">
                <div>
                  <div class="text-xs font-medium text-fg">Limite de tolerância</div>
                  <div class="text-2xs text-fg-muted">A partir deste percentual a redação é tratada como suspeita.</div>
                </div>
                <div class="flex items-center gap-1.5">
                  {PRESETS.map((p) => (
                    <button key={p.nome} type="button" title={p.dica} onClick={() => set('limiteIa', p.limite)}
                      class={cn('text-2xs px-2 py-1 rounded border', valor.limiteIa === p.limite ? 'border-accent bg-accent/10 text-accent' : 'border-border text-fg-muted hover:text-fg')}>
                      {p.nome} · {p.limite}%
                    </button>
                  ))}
                </div>
              </div>
              <div class="flex items-center gap-3">
                <input type="range" min="0" max="100" step="1" value={valor.limiteIa} class="flex-1 accent-accent"
                  onInput={(e) => set('limiteIa', num((e.target as HTMLInputElement).value, 0, 100))} aria-label="Limite de tolerância de IA" />
                <div class="w-20"><Input type="number" min="0" max="100" value={String(valor.limiteIa)} onInput={(e) => set('limiteIa', num((e.target as HTMLInputElement).value, 0, 100))} class="text-right" /></div>
                <span class="text-sm text-fg-muted">%</span>
              </div>
              <div class="mt-2"><ReguaIa limite={valor.limiteIa} margem={valor.margemAtencao} /></div>
              <div class="flex justify-between text-2xs text-fg-muted mt-1">
                <span class="text-success">0–{Math.max(0, atencao - 1)}% aceitável</span>
                <span class="text-warning">{atencao}–{Math.max(atencao, valor.limiteIa - 1)}% atenção</span>
                <span class="text-danger">{valor.limiteIa}–100% suspeita</span>
              </div>
              {valor.limiteIa === 0 && <div class="text-2xs text-danger mt-1">Com 0%, toda redação analisada será suspeita.</div>}
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-[12rem_1fr] gap-3 items-start">
              <Input label="Faixa de atenção (pontos)" type="number" min="0" max="100" value={String(valor.margemAtencao)}
                onInput={(e) => set('margemAtencao', num((e.target as HTMLInputElement).value, 0, 100))}
                hint="Abaixo do limite, quantos pontos já viram alerta amarelo." />
            </div>
            <div>
              <div class="text-xs font-medium text-fg mb-1.5">Acima do limite</div>
              <EscolhaAcao nome="acaoIa" valor={valor.acaoIa} onChange={(v) => set('acaoIa', v)} />
            </div>
          </>
        )}
      </div>

      {/* ── Similaridade ───────────────────────────────── */}
      <div class="rounded-md border border-border p-3 space-y-3 mt-3">
        <Interruptor checked={valor.verificarSimilaridade} onChange={(v) => set('verificarSimilaridade', v)} titulo="Similaridade (plágio)"
          texto="Compara com as redações dos outros candidatos do processo e com os textos motivadores do tema (cópia de texto motivador)." />
        {valor.verificarSimilaridade && (
          <>
            <div class="w-48">
              <Input label="Limite de texto coincidente (%)" type="number" min="1" max="100" value={String(valor.limiteSimilaridade)}
                onInput={(e) => set('limiteSimilaridade', num((e.target as HTMLInputElement).value, 1, 100))} />
            </div>
            <div>
              <div class="text-xs font-medium text-fg mb-1.5">Acima do limite</div>
              <EscolhaAcao nome="acaoSimilaridade" valor={valor.acaoSimilaridade} onChange={(v) => set('acaoSimilaridade', v)} />
            </div>
          </>
        )}
      </div>

      {/* ── Comportamento ──────────────────────────────── */}
      <div class="rounded-md border border-border p-3 space-y-3 mt-3">
        <Interruptor checked={valor.analisarComportamento} onChange={(v) => set('analisarComportamento', v)} titulo="Comportamento de escrita"
          texto="Mede no editor como o texto nasceu: tempo e ritmo de digitação, trechos que entram de uma vez (colados, ditados ou inseridos por extensão), correções, saídas da aba e a linha do tempo da escrita." />
        {valor.analisarComportamento && (
          <>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Texto inserido de uma vez — limite (%)" type="number" min="1" max="100" value={String(valor.limiteTextoInserido)}
                onInput={(e) => set('limiteTextoInserido', num((e.target as HTMLInputElement).value, 1, 100))}
                hint="Parte do texto final que não foi digitada tecla a tecla." />
              <Input label="Saídas da aba toleradas" type="number" min="0" max="999" value={String(valor.maxSaidasAba)}
                onInput={(e) => set('maxSaidasAba', num((e.target as HTMLInputElement).value, 0, 999))}
                hint="Acima disto vira alerta para o avaliador." />
            </div>
            <div>
              <div class="text-xs font-medium text-fg mb-1.5">Comportamento grave (texto inserido acima do limite, salto brusco ou velocidade não humana)</div>
              <EscolhaAcao nome="acaoComportamento" valor={valor.acaoComportamento} onChange={(v) => set('acaoComportamento', v)} />
            </div>
          </>
        )}
      </div>

      {/* ── Proteções do editor ────────────────────────── */}
      <div class="rounded-md border border-border p-3 space-y-2 mt-3">
        <div class="text-xs font-semibold text-fg">Proteções do editor do candidato</div>
        <Interruptor checked={valor.bloquearArrastar} onChange={(v) => set('bloquearArrastar', v)} titulo="Bloquear arrastar e soltar texto"
          texto="Fecha a brecha de quem arrasta um texto pronto para o campo quando o colar está bloqueado." />
        <Interruptor checked={valor.bloquearCorretorNavegador} onChange={(v) => set('bloquearCorretorNavegador', v)} titulo="Desligar corretor ortográfico e autocompletar do navegador"
          texto="Como na prova em papel: a gramática avaliada é a do candidato. Desligado por padrão." />
      </div>

      <div class="text-2xs text-fg-muted mt-3">
        A detecção de IA faz uma chamada extra ao modelo por redação (custo semelhante ao da correção). Similaridade e comportamento não usam IA.
      </div>
    </Card>
  )
}
