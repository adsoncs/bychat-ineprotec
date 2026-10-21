// Educacional › Acesso por portal
//
// Quem enxerga cada portal (polos e parceiros). A regra está em
// backend/src/lib/portalAccess.ts; esta tela só monta a matriz:
//   • portal sem nenhuma equipe marcada = aberto, como sempre foi;
//   • portal com equipes = só elas (líder vê o portal inteiro, membro vê só
//     as inscrições dos próprios leads), além de admin e de quem "vê todos";
//   • Ver = acompanha; Operar = também age (aprovar, cobrar, matricular).
// "Ver como" mostra o resultado para uma pessoa antes e depois de salvar.
import { useEffect, useMemo, useState } from 'preact/hooks'
import { Save, Eye, Users, ShieldCheck, Crown, Lock, Info, School } from '@/components/ui/icon-set'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Select, Checkbox } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'
import { useCan } from '@/hooks/usePermissions'
import { SomenteLeitura } from '@/components/auth/SomenteLeitura'
import {
  useMatrizDeAcesso, useSalvarMatrizDeAcesso, useSimularAcesso,
  type NivelAcesso, type LinhaDeAcesso,
} from '@/hooks/useAcessoPortais'

type Celula = '' | NivelAcesso
const chave = (portalId: number, teamId: number) => `${portalId}:${teamId}`

const MODO: Record<string, string> = {
  todos: 'Vê todos os portais',
  aberto: 'Portal aberto',
  lider: 'Líder — vê o portal inteiro',
  membro: 'Membro — só as inscrições dos próprios leads',
  nenhum: 'Não vê',
}

export function EducationalAcessoPortaisPage() {
  const { data, isLoading } = useMatrizDeAcesso()
  const salvar = useSalvarMatrizDeAcesso()
  const podeEditar = useCan('edu_acesso_portais', 'edit')
  const [celulas, setCelulas] = useState<Record<string, Celula>>({})
  const [veTodos, setVeTodos] = useState<Set<number>>(new Set())
  const [donas, setDonas] = useState<Record<number, number | null>>({})
  const [sujo, setSujo] = useState(false)
  const [comoUsuario, setComoUsuario] = useState<number | null>(null)
  const sim = useSimularAcesso(comoUsuario)

  useEffect(() => {
    if (!data || sujo) return
    const c: Record<string, Celula> = {}
    for (const l of data.linhas) c[chave(l.portalId, l.teamId)] = l.nivel
    setCelulas(c)
    setVeTodos(new Set(data.equipes.filter((e) => e.veTodosOsPortais).map((e) => e.id)))
    setDonas(Object.fromEntries(data.portais.map((p) => [p.id, p.equipeDonaId])))
  }, [data, sujo])

  const pessoas = useMemo(() => {
    const m = new Map<number, { id: number; nome: string; papel: string }>()
    for (const e of data?.equipes ?? []) for (const u of e.membros) m.set(u.id, u)
    return [...m.values()].sort((a, b) => a.nome.localeCompare(b.nome))
  }, [data])

  if (isLoading || !data) return <Page title="Acesso por portal"><Skeleton class="h-64" /></Page>

  const equipes = data.equipes.filter((e) => e.ativa)
  const restrito = (portalId: number) => equipes.some((e) => celulas[chave(portalId, e.id)])
  const mudar = (fn: () => void) => { fn(); setSujo(true) }

  const gravar = async () => {
    const linhas: LinhaDeAcesso[] = []
    for (const [k, v] of Object.entries(celulas)) {
      if (!v) continue
      const [portalId = NaN, teamId = NaN] = k.split(':').map(Number)
      linhas.push({ portalId, teamId, nivel: v })
    }
    try {
      await salvar.mutateAsync({
        linhas,
        equipesVeTodos: [...veTodos],
        equipesDonas: Object.fromEntries(Object.entries(donas).map(([k, v]) => [k, v ?? null])),
      })
      setSujo(false)
      toast('Acesso por portal salvo.', 'success')
    } catch (e: any) {
      toast(e?.message || 'Não foi possível salvar.', 'danger')
    }
  }

  return (
    <Page
      title="Acesso por portal"
      description="Separe polos e parceiros: escolha quais equipes enxergam cada portal."
      actions={podeEditar && (
        <Button onClick={gravar} loading={salvar.isPending} disabled={!sujo}>
          <Save size={14} /> Salvar
        </Button>
      )}
    >
      <Card class="flex gap-3 text-sm text-fg-muted">
        <Info size={16} class="mt-0.5 shrink-0" />
        <div class="space-y-1">
          <p><b class="text-fg">Portal sem equipe marcada fica aberto</b>: todos que têm a tela Portal de Matrículas veem, como antes.</p>
          <p><b class="text-fg">Com equipes marcadas</b>, só elas veem: o <b class="text-fg">líder</b> da equipe vê o portal inteiro; o <b class="text-fg">membro</b> vê só as inscrições dos leads dele.</p>
          <p><b class="text-fg">Ver</b> só acompanha. <b class="text-fg">Operar</b> também aprova documentos, cobra e matricula. Administradores e equipes que <b class="text-fg">veem todos os portais</b> não são afetados.</p>
        </div>
      </Card>

      <SomenteLeitura tela="edu_acesso_portais">
        <Card class="overflow-x-auto p-0">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-border text-left text-xs text-fg-muted">
                <th class="p-3 font-semibold">Portal</th>
                <th class="p-3 font-semibold">Equipe dona (recebe o lead)</th>
                {equipes.map((e) => (
                  <th key={e.id} class="p-3 font-semibold whitespace-nowrap">
                    <span class="inline-block h-2 w-2 rounded-full mr-1.5" style={{ background: e.cor }} />{e.nome}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.portais.map((p) => (
                <tr key={p.id} class={cn('border-b border-border last:border-0', !p.ativo && 'opacity-60')}>
                  <td class="p-3 align-top">
                    <div class="flex items-center gap-1.5 font-medium text-fg">
                      <School size={14} /> {p.nome}
                    </div>
                    <div class="mt-1 text-xs text-fg-muted">
                      {restrito(p.id) ? <span class="inline-flex items-center gap-1"><Lock size={12} /> Restrito</span> : 'Aberto'}
                      {' · '}{p.inscricoes} inscrição(ões){!p.ativo && ' · inativo'}
                    </div>
                  </td>
                  <td class="p-3 align-top min-w-[180px]">
                    <Select
                      value={donas[p.id] == null ? '' : String(donas[p.id])}
                      onChange={(ev: any) => mudar(() => setDonas((d) => ({ ...d, [p.id]: ev.currentTarget.value ? Number(ev.currentTarget.value) : null })))}
                    >
                      <option value="">Equipe padrão</option>
                      {equipes.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
                    </Select>
                  </td>
                  {equipes.map((e) => {
                    const k = chave(p.id, e.id)
                    const v = celulas[k] ?? ''
                    return (
                      <td key={e.id} class="p-3 align-top">
                        {veTodos.has(e.id) ? (
                          <span class="text-xs text-fg-muted">vê todos</span>
                        ) : (
                          <Select
                            value={v}
                            aria-label={`${e.nome} no portal ${p.nome}`}
                            onChange={(ev: any) => mudar(() => setCelulas((c) => ({ ...c, [k]: ev.currentTarget.value as Celula })))}
                          >
                            <option value="">—</option>
                            <option value="VER">Ver</option>
                            <option value="OPERAR">Operar</option>
                          </Select>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card>
          <div class="mb-3 flex items-center gap-2 font-semibold text-fg"><ShieldCheck size={16} /> Equipes que veem todos os portais</div>
          <p class="mb-3 text-sm text-fg-muted">Para Secretaria, Financeiro e Coordenação: os membros veem todos os portais, inclusive os restritos a outras equipes.</p>
          <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {equipes.map((e) => (
              <Checkbox
                key={e.id}
                label={e.nome}
                hint={`${e.membros.length} membro(s)`}
                checked={veTodos.has(e.id)}
                onChange={(ev: any) => mudar(() => setVeTodos((s) => {
                  const n = new Set(s)
                  if (ev.currentTarget.checked) n.add(e.id); else n.delete(e.id)
                  return n
                }))}
              />
            ))}
          </div>
        </Card>
      </SomenteLeitura>

      <Card>
        <div class="mb-3 flex items-center gap-2 font-semibold text-fg"><Eye size={16} /> Ver como</div>
        <p class="mb-3 text-sm text-fg-muted">
          Escolha uma pessoa para ver os portais e as inscrições que ela enxerga hoje.
          {sujo && <b class="text-fg"> Salve antes: a simulação usa o que está gravado.</b>}
        </p>
        <div class="max-w-sm">
          <Select value={comoUsuario == null ? '' : String(comoUsuario)} onChange={(ev: any) => setComoUsuario(ev.currentTarget.value ? Number(ev.currentTarget.value) : null)}>
            <option value="">Escolha uma pessoa…</option>
            {pessoas.map((u) => <option key={u.id} value={u.id}>{u.nome} ({u.papel})</option>)}
          </Select>
        </div>
        {sim.data && (
          <div class="mt-4 space-y-2">
            {sim.data.veTodos && (
              <p class="text-sm text-fg">
                <Crown size={14} class="inline mr-1" />
                Vê todos os portais {sim.data.motivo === 'papel' ? 'pelo papel (administrador)' : 'por estar numa equipe que vê todos'}.
              </p>
            )}
            <ul class="divide-y divide-border rounded-md border border-border">
              {sim.data.portais.map((p) => (
                <li key={p.id} class="flex items-center justify-between gap-3 p-2.5 text-sm">
                  <span class={cn('font-medium', p.ve ? 'text-fg' : 'text-fg-muted line-through')}>{p.nome}</span>
                  <span class="flex items-center gap-3 text-xs text-fg-muted">
                    <span>{MODO[p.modo]}</span>
                    {p.ve && <span><Users size={12} class="inline mr-1" />{p.inscricoes} inscrição(ões)</span>}
                    {p.ve && <span class={p.opera ? 'text-success' : ''}>{p.opera ? 'Opera' : 'Só acompanha'}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </Page>
  )
}
