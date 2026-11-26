// Educacional › Dados por etapa — o padrão da instituição: que dados da pessoa
// são pedidos em cada etapa da inscrição e da matrícula, e o que é exigido para
// matricular. Cada portal pode ajustar na aba Etapas.
import { useEffect, useState } from 'preact/hooks'
import { Save, Sparkles } from '@/components/ui/icon-set'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { DadosEtapasEditor, EnderecoCompletoControle } from '@/components/educational/DadosEtapasEditor'
import { useDadosEtapas, useSalvarPadraoDados, useEnderecoPortais, useSalvarEnderecoPortais, type DadosConfig, type DadosEtapasResposta, type EnderecoNaConfig } from '@/hooks/useDadosEtapas'
import { MapPin } from '@/components/ui/icon-set'
import { toast } from '@/lib/toast'
import { SomenteLeitura } from '@/components/auth/SomenteLeitura'
import { useCan } from '@/hooks/usePermissions'

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

  const podeEditar = useCan('edu_dados_etapas', 'edit')
  return (
    <Page
      title="Dados por etapa"
      description="Que dados de cada pessoa são pedidos em cada etapa da inscrição e da matrícula, e o que é indispensável para matricular. Vale para todos os portais; cada portal pode ajustar na aba Etapas."
      actions={cfg && podeEditar ? (
        <Button onClick={gravar} disabled={salvar.isPending || !dirty}>
          <Save size={14} /> {salvar.isPending ? 'Salvando…' : 'Salvar padrão'}
        </Button>
      ) : undefined}
    >
      <SomenteLeitura tela="edu_dados_etapas">
      {data && <EnderecoNosPortais etapas={data.etapas} podeEditar={podeEditar} />}
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
      </SomenteLeitura>
    </Page>
  )
}

/**
 * Endereço completo, portal a portal: onde pedir no portal do aluno, se aparece
 * na ficha do painel (aba Cadastro da matrícula), obrigatório e exigido para
 * matricular. Grava no ajuste de cada portal (o mesmo da aba Etapas).
 */
function EnderecoNosPortais({ etapas, podeEditar }: { etapas: DadosEtapasResposta['etapas']; podeEditar: boolean }) {
  const { data, isLoading } = useEnderecoPortais()
  const salvar = useSalvarEnderecoPortais()
  const [edicao, setEdicao] = useState<Record<number, EnderecoNaConfig>>({})
  useEffect(() => { setEdicao({}) }, [data])
  const portais = data?.portais ?? []
  const alterados = portais.filter((p) => edicao[p.id] && JSON.stringify(edicao[p.id]) !== JSON.stringify(p.endereco))

  function gravar() {
    salvar.mutate(alterados.map((p) => ({ id: p.id, endereco: edicao[p.id]! })), {
      onSuccess: (r) => {
        if (r.pulados.length) toast(`Não salvo em ${r.pulados.length} portal(is): ${r.pulados.map((x) => x.motivo).join('; ')}`, 'warning')
        else toast('Endereço salvo nos portais', 'success')
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Card class="p-4 mb-4 space-y-3">
      <div class="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div class="flex items-center gap-2 font-semibold text-sm"><MapPin size={15} /> Endereço completo</div>
          <p class="text-2xs text-fg-muted mt-1 max-w-3xl">
            Marque, em cada portal, onde o endereço (CEP, rua, número, complemento, bairro, cidade e UF) é pedido: no portal do aluno
            (formulário de inscrição, Completar cadastro, etc.) e/ou na ficha do painel, onde a equipe preenche e edita na aba Cadastro da matrícula.
            O contrato que usa o endereço continua pedindo antes de assinar, como hoje.
          </p>
        </div>
        {podeEditar && (
          <Button size="sm" onClick={gravar} disabled={!alterados.length || salvar.isPending}>
            <Save size={13} /> {salvar.isPending ? 'Salvando…' : alterados.length ? `Salvar (${alterados.length})` : 'Salvar'}
          </Button>
        )}
      </div>
      {isLoading ? <Skeleton class="h-40" /> : (
        <div class="divide-y divide-border rounded-md border border-border">
          {portais.map((p) => {
            const v = edicao[p.id] ?? p.endereco
            return (
              <div key={p.id} class="px-3 py-2.5 grid gap-1.5 lg:grid-cols-[minmax(180px,240px)_1fr] lg:items-center">
                <div class="min-w-0">
                  <div class="text-sm font-medium truncate">{p.nome}{!p.ativo && <span class="ml-1 text-3xs text-fg-muted">(inativo)</span>}</div>
                  <div class="text-3xs text-fg-muted">
                    {p.contratos.length
                      ? p.contratos.map((c) => c.pede ? `Contrato pede antes de assinar (${c.modelo})` : `Termo imprime o endereço, mas não pede (${c.modelo})`).join(' · ')
                      : 'Contrato não usa o endereço'}
                  </div>
                </div>
                {p.configurado ? (
                  <EnderecoCompletoControle valor={v} etapas={etapas} rotulo={p.nome} desabilitado={!podeEditar}
                    onChange={(n) => setEdicao((x) => ({ ...x, [p.id]: n }))} />
                ) : (
                  <div class="text-2xs text-fg-muted">Este portal usa o formulário próprio (sem Dados por etapa). Ajuste na aba Etapas do portal.</div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {alterados.length > 0 && <div class="text-2xs text-warning">{alterados.length} portal(is) com alteração não salva.</div>}
    </Card>
  )
}
