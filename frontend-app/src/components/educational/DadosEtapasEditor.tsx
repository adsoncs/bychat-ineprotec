// Editor "Dados por etapa": para cada dado da pessoa, em que etapa pedir, se é
// obrigatório ali e se é exigido para matricular. Usado no padrão da instituição
// (Educacional › Dados por etapa) e no ajuste de cada portal (aba Etapas).
import { Fragment } from 'preact'
import { AlertTriangle, CheckCircle2 } from '@/components/ui/icon-set'
import type { DadoCatalogo, DadosConfig, EtapaDados } from '@/hooks/useDadosEtapas'

const MODOS: { valor: DadosConfig['modo']; nome: string; desc: string }[] = [
  { valor: 'completo', nome: 'Completo', desc: 'Passo a passo: a inscrição em etapas, e cada etapa da matrícula pede os seus dados.' },
  { valor: 'simplificado', nome: 'Simplificado', desc: 'Uma página por fase e formulário limpo, pronto para embutir em outro site: só os campos e o botão — sem logo, "Entrar", títulos, resumo, rodapé nem aviso de cookies. O que é pedido depois vem junto em "Completar cadastro".' },
]

export function lacunas(cfg: DadosConfig, catalogo: DadoCatalogo[], cobraNaInscricao = false) {
  const rot = (k: string) => catalogo.find((d) => d.chave === k)?.rotulo ?? k
  const naoPedidos = cfg.exigidosMatricula.filter((k) => !cfg.campos[k]).map(rot)
  const opcionais = cfg.exigidosMatricula.filter((k) => cfg.campos[k] && !cfg.campos[k]!.obrigatorio).map(rot)
  const avisos: string[] = []
  if (cobraNaInscricao && cfg.campos.cpf?.etapa !== 'inscricao') {
    avisos.push('O portal cobra logo após a inscrição e o CPF não é pedido nela — o gateway precisa do CPF para gerar a cobrança.')
  }
  return { naoPedidos, opcionais, avisos }
}

export function DadosEtapasEditor(p: {
  valor: DadosConfig
  catalogo: DadoCatalogo[]
  etapas: { chave: EtapaDados; rotulo: string }[]
  onChange: (v: DadosConfig) => void
  somenteLeitura?: boolean
  cobraNaInscricao?: boolean
}) {
  const v = p.valor
  const grupos = [...new Set(p.catalogo.map((d) => d.grupo))]
  const set = (patch: Partial<DadosConfig>) => p.onChange({ ...v, ...patch })

  const mudarEtapa = (d: DadoCatalogo, etapa: EtapaDados | '') => {
    const campos = { ...v.campos }
    if (!etapa) delete campos[d.chave]
    else campos[d.chave] = { etapa, obrigatorio: campos[d.chave]?.obrigatorio ?? v.exigidosMatricula.includes(d.chave) }
    set({ campos })
  }
  const mudarObrig = (d: DadoCatalogo, obrigatorio: boolean) => {
    const c = v.campos[d.chave]
    if (!c) return
    set({ campos: { ...v.campos, [d.chave]: { ...c, obrigatorio } } })
  }
  const mudarExigido = (d: DadoCatalogo, sim: boolean) => {
    const exig = new Set(v.exigidosMatricula)
    if (sim) exig.add(d.chave); else exig.delete(d.chave)
    set({ exigidosMatricula: [...exig] })
  }

  const l = lacunas(v, p.catalogo, p.cobraNaInscricao)
  const tudoCerto = !l.naoPedidos.length && !l.opcionais.length && !l.avisos.length
  const pedidos = Object.keys(v.campos).length
  const porEtapa = p.etapas.map((e) => ({ ...e, n: Object.values(v.campos).filter((c) => c.etapa === e.chave).length }))

  return (
    <div class={`space-y-4 ${p.somenteLeitura ? 'opacity-70 pointer-events-none select-none' : ''}`}>
      <div class="grid gap-2 sm:grid-cols-2">
        {MODOS.map((m) => (
          <label key={m.valor} class={`rounded-md border p-3 cursor-pointer ${v.modo === m.valor ? 'border-accent bg-accent/5' : 'border-border'}`}>
            <div class="flex items-center gap-2 text-sm font-medium">
              <input type="radio" name="modo-dados" checked={v.modo === m.valor} onChange={() => set({ modo: m.valor })} /> {m.nome}
            </div>
            <div class="text-2xs text-fg-muted mt-1">{m.desc}</div>
          </label>
        ))}
      </div>

      {tudoCerto ? (
        <div class="flex items-center gap-2 rounded-md border border-success/30 bg-success/10 p-3 text-xs text-success">
          <CheckCircle2 size={14} /> Configuração completa: todo dado exigido para matricular é pedido em alguma etapa, como obrigatório.
        </div>
      ) : (
        <div class="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning space-y-1" role="alert">
          <div class="flex items-center gap-2 font-semibold"><AlertTriangle size={14} /> Configuração incompleta</div>
          {l.naoPedidos.length > 0 && <div>Exigido para matricular, mas <b>não é pedido em nenhuma etapa</b>: {l.naoPedidos.join(', ')}. Essas inscrições vão travar na efetivação até a secretaria completar à mão.</div>}
          {l.opcionais.length > 0 && <div>Exigido para matricular, mas <b>opcional</b> onde é pedido: {l.opcionais.join(', ')}.</div>}
          {l.avisos.map((a) => <div key={a}>{a}</div>)}
        </div>
      )}

      <div class="text-2xs text-fg-muted">
        {pedidos} dado(s) pedido(s) · {porEtapa.filter((e) => e.n).map((e) => `${e.rotulo}: ${e.n}`).join(' · ') || 'nenhum'}
        {v.modo === 'simplificado' && ' · no modo simplificado, o que é pedido depois da inscrição aparece junto, numa página, em "Completar cadastro".'}
      </div>

      <div class="overflow-x-auto rounded-md border border-border">
        <table class="w-full text-sm">
          <thead class="bg-surface-2 text-2xs uppercase tracking-wider text-fg-muted">
            <tr>
              <th class="text-left font-semibold px-3 py-2">Dado</th>
              <th class="text-left font-semibold px-3 py-2">Onde pedir</th>
              <th class="text-center font-semibold px-3 py-2">Obrigatório</th>
              <th class="text-center font-semibold px-3 py-2" title="Sem este dado preenchido, a inscrição não vira matrícula">Exigido p/ matricular</th>
            </tr>
          </thead>
          <tbody>
            {grupos.map((g) => (
              <Fragment key={g}>
                <tr class="bg-surface-2/50">
                  <td colSpan={4} class="px-3 py-1.5 text-2xs font-semibold text-fg-muted">{g}</td>
                </tr>
                {p.catalogo.filter((d) => d.grupo === g).map((d) => {
                  const c = v.campos[d.chave]
                  const exigido = v.exigidosMatricula.includes(d.chave)
                  const falha = exigido && (!c || !c.obrigatorio)
                  return (
                    <tr key={d.chave} class="border-t border-border">
                      <td class="px-3 py-1.5">
                        <span class={falha ? 'text-warning font-medium' : ''}>{d.rotulo}</span>
                        {d.essencial && <span class="ml-1 text-3xs text-fg-muted">(sempre na inscrição)</span>}
                      </td>
                      <td class="px-3 py-1.5">
                        <select
                          class="w-full min-w-[170px] rounded border border-border bg-surface px-2 py-1 text-xs"
                          value={c?.etapa ?? ''}
                          disabled={d.essencial}
                          aria-label={`Onde pedir ${d.rotulo}`}
                          onChange={(e) => mudarEtapa(d, (e.target as HTMLSelectElement).value as EtapaDados | '')}
                        >
                          <option value="">Não pedir</option>
                          {p.etapas.map((e) => <option key={e.chave} value={e.chave}>{e.rotulo}</option>)}
                        </select>
                      </td>
                      <td class="px-3 py-1.5 text-center">
                        <input type="checkbox" aria-label={`${d.rotulo} obrigatório`} checked={!!c?.obrigatorio} disabled={!c || d.essencial}
                          onChange={(e) => mudarObrig(d, (e.target as HTMLInputElement).checked)} />
                      </td>
                      <td class="px-3 py-1.5 text-center">
                        <input type="checkbox" aria-label={`${d.rotulo} exigido para matricular`} checked={exigido}
                          onChange={(e) => mudarExigido(d, (e.target as HTMLInputElement).checked)} />
                      </td>
                    </tr>
                  )
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
