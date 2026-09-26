// Aparência do formulário limpo — o que vai embutido em outro site (modo
// simplificado e captura de interesse). Bordas, arredondamento, altura dos
// campos, espaçamentos e moldura, com prévia ao vivo. Valores aplicados em
// portal-app/src/App.tsx (estiloDoFormLimpo) como variáveis CSS.
import { Card } from '@/components/ui/Card'
import { Select } from '@/components/ui/Input'
import { ColorPicker } from '@/components/ui/ColorPicker'

export interface FormLimpoEstilo {
  bordaCampo?: 'nenhuma' | 'fina' | 'grossa' | 'linha'
  corBorda?: string
  corFundoCampo?: string
  raioCampo?: number
  alturaCampo?: 'compacta' | 'padrao' | 'ampla'
  espacoCampos?: number
  respiro?: number
  moldura?: boolean
  raioMoldura?: number
  corFundo?: string
}

/** Padrões — iguais aos do portal-app, para a prévia bater com a página. */
export const PADRAO_FORM_LIMPO: Required<Omit<FormLimpoEstilo, 'corFundo'>> & { corFundo: string } = {
  bordaCampo: 'fina', corBorda: '#dcdfe4', corFundoCampo: '#ffffff', raioCampo: 10,
  alturaCampo: 'padrao', espacoCampos: 14, respiro: 4, moldura: false, raioMoldura: 12, corFundo: '',
}

const ALTURA_PX = { compacta: 8, padrao: 12, ampla: 16 } as const
const BORDA_PX = { nenhuma: 0, fina: 1, grossa: 2, linha: 0 } as const

function Faixa(p: { label: string; valor: number; min: number; max: number; onChange: (n: number) => void; sufixo?: string }) {
  return (
    <label class="block">
      <div class="flex items-center justify-between text-xs text-fg-muted mb-1">
        <span>{p.label}</span><span class="tabular-nums text-fg">{p.valor}{p.sufixo ?? 'px'}</span>
      </div>
      <input type="range" class="w-full" min={p.min} max={p.max} value={p.valor}
        onInput={(e) => p.onChange(Number((e.target as HTMLInputElement).value))} />
    </label>
  )
}

export function FormLimpoEditor(p: { valor: FormLimpoEstilo; corMarca: string; onChange: (v: FormLimpoEstilo) => void }) {
  const v = { ...PADRAO_FORM_LIMPO, ...p.valor }
  const set = (patch: Partial<FormLimpoEstilo>) => p.onChange({ ...p.valor, ...patch })

  const bw = BORDA_PX[v.bordaCampo]
  const campoStyle = {
    border: v.bordaCampo === 'linha' ? 'none' : `${bw}px solid ${v.corBorda}`,
    borderBottom: v.bordaCampo === 'linha' ? `1px solid ${v.corBorda}` : undefined,
    borderRadius: v.bordaCampo === 'linha' ? 0 : v.raioCampo,
    background: v.corFundoCampo,
    padding: `${ALTURA_PX[v.alturaCampo]}px 12px`,
    fontSize: 14, color: '#6b7280',
  }

  return (
    <Card>
      <div class="text-xs uppercase tracking-wider text-fg-muted mb-1">Formulário limpo (para embutir)</div>
      <p class="text-xs text-fg-muted mb-3">
        Vale para o modo simplificado e para a captura de interesse — o formulário que vai dentro do site de vocês.
        Bordas, cantos e espaços; a cor do botão e a fonte vêm da marca, acima.
      </p>
      <div class="grid gap-4 lg:grid-cols-2">
        <div class="space-y-3">
          <div class="grid grid-cols-2 gap-3">
            <Select label="Borda dos campos" value={v.bordaCampo} onChange={(e) => set({ bordaCampo: (e.target as HTMLSelectElement).value as NonNullable<FormLimpoEstilo['bordaCampo']> })}>
              <option value="nenhuma">Sem borda</option>
              <option value="fina">Fina</option>
              <option value="grossa">Grossa</option>
              <option value="linha">Só a linha de baixo</option>
            </Select>
            <Select label="Altura dos campos" value={v.alturaCampo} onChange={(e) => set({ alturaCampo: (e.target as HTMLSelectElement).value as NonNullable<FormLimpoEstilo['alturaCampo']> })}>
              <option value="compacta">Compacta</option>
              <option value="padrao">Padrão</option>
              <option value="ampla">Ampla</option>
            </Select>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <ColorPicker label="Cor da borda" value={v.corBorda} onChange={(c: string) => set({ corBorda: c })} />
            <ColorPicker label="Fundo dos campos" value={v.corFundoCampo} onChange={(c: string) => set({ corFundoCampo: c })} />
          </div>
          <Faixa label="Arredondamento dos campos" valor={v.raioCampo} min={0} max={30} onChange={(n) => set({ raioCampo: n })} />
          <Faixa label="Espaço entre os campos" valor={v.espacoCampos} min={0} max={48} onChange={(n) => set({ espacoCampos: n })} />
          <Faixa label="Respiro em volta do formulário" valor={v.respiro} min={0} max={64} onChange={(n) => set({ respiro: n })} />
          <label class="flex items-center gap-2 text-sm text-fg-muted">
            <input type="checkbox" checked={v.moldura} onChange={(e) => set({ moldura: (e.target as HTMLInputElement).checked })} />
            Moldura em volta do formulário (borda na cor acima)
          </label>
          {v.moldura && <Faixa label="Arredondamento da moldura" valor={v.raioMoldura} min={0} max={40} onChange={(n) => set({ raioMoldura: n })} />}
          <div class="flex items-center gap-3">
            <label class="flex items-center gap-2 text-sm text-fg-muted">
              <input type="checkbox" checked={!!v.corFundo} onChange={(e) => set({ corFundo: (e.target as HTMLInputElement).checked ? '#ffffff' : '' })} />
              Fundo próprio (sem isso, transparente — pega o fundo do site)
            </label>
          </div>
          {!!v.corFundo && <ColorPicker label="Cor de fundo do formulário" value={v.corFundo} onChange={(c: string) => set({ corFundo: c })} />}
          <button type="button" class="text-xs text-fg-muted underline" onClick={() => p.onChange({})}>Voltar ao padrão</button>
        </div>

        <div class="rounded-md border border-dashed border-border p-3" style="background:repeating-conic-gradient(#f3f4f6 0 25%, #fff 0 50%) 0 0/16px 16px">
          <div class="text-3xs uppercase tracking-wider text-fg-muted mb-2">Prévia</div>
          <div style={{
            padding: v.respiro, background: v.corFundo || 'transparent',
            border: v.moldura ? `1px solid ${v.corBorda}` : 'none', borderRadius: v.moldura ? v.raioMoldura : 0,
            display: 'grid', gap: v.espacoCampos,
          }}>
            {['Nome completo', 'WhatsApp', 'E-mail'].map((l) => (
              <div key={l}>
                <div style="font-size:12px;font-weight:600;color:#111827;margin-bottom:4px">{l}</div>
                <div style={campoStyle}>&nbsp;</div>
              </div>
            ))}
            <div style={{ background: p.corMarca, color: '#fff', textAlign: 'center', padding: '10px', borderRadius: v.raioCampo, fontWeight: 600, fontSize: 14 }}>Enviar</div>
          </div>
        </div>
      </div>
    </Card>
  )
}
