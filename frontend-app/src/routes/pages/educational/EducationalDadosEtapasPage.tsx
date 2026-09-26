// Educacional › Dados por etapa — o padrão da instituição: que dados da pessoa
// são pedidos em cada etapa da inscrição e da matrícula, e o que é exigido para
// matricular. Cada portal pode ajustar na aba Etapas.
import { useEffect, useState } from 'preact/hooks'
import { Save, Sparkles } from '@/components/ui/icon-set'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { DadosEtapasEditor } from '@/components/educational/DadosEtapasEditor'
import { useDadosEtapas, useSalvarPadraoDados, type DadosConfig } from '@/hooks/useDadosEtapas'
import { toast } from '@/lib/toast'

export function EducationalDadosEtapasPage() {
  const { data, isLoading } = useDadosEtapas()
  const salvar = useSalvarPadraoDados()
  const [cfg, setCfg] = useState<DadosConfig | null>(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (data && !dirty) setCfg(data.padrao ?? null)
  }, [data])

  const mudar = (v: DadosConfig) => { setCfg(v); setDirty(true) }

  function gravar() {
    if (!cfg) return
    salvar.mutate(cfg, {
      onSuccess: () => { toast('Padrão salvo — vale para todos os portais que não têm ajuste próprio', 'success'); setDirty(false) },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Page
      title="Dados por etapa"
      description="Que dados de cada pessoa são pedidos em cada etapa da inscrição e da matrícula, e o que é indispensável para matricular. Vale para todos os portais; cada portal pode ajustar na aba Etapas."
      actions={cfg ? (
        <Button onClick={gravar} disabled={salvar.isPending || !dirty}>
          <Save size={14} /> {salvar.isPending ? 'Salvando…' : 'Salvar padrão'}
        </Button>
      ) : undefined}
    >
      {isLoading || !data ? (
        <Skeleton class="h-96" />
      ) : !cfg ? (
        <Card class="p-6 text-sm space-y-3">
          <div class="font-semibold">Nenhum padrão definido ainda</div>
          <p class="text-fg-muted text-xs">
            Hoje cada portal pede os dados do próprio formulário, e o que falta é digitado pela secretaria em Acadêmico › Pessoas — sem nada que
            impeça matricular com a ficha incompleta. Comece pela sugestão (formulário de sempre na inscrição, e os dados do Censo em "Completar
            cadastro") e ajuste.
          </p>
          <Button onClick={() => mudar(JSON.parse(JSON.stringify(data.sugestao)))}><Sparkles size={14} /> Começar pela sugestão</Button>
        </Card>
      ) : (
        <>
          {dirty && <div class="text-xs text-warning mb-2">Alterações não salvas.</div>}
          <DadosEtapasEditor valor={cfg} catalogo={data.catalogo} etapas={data.etapas} onChange={mudar} />
          <p class="text-2xs text-fg-muted mt-3">
            "Exigido p/ matricular" trava a efetivação em Funil de matrículas enquanto o dado estiver em branco — a mensagem diz o que falta.
            Etapas que o portal não usa (aba Etapas) não aparecem para o candidato; o que estiver nelas fica para a secretaria.
          </p>
        </>
      )}
    </Page>
  )
}
