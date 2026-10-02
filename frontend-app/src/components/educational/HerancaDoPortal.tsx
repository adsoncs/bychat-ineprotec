// O que um portal segue das Configurações Gerais (Educacional › Configurações
// Gerais). Ligado: o que está preenchido nas Gerais vale por cima do portal.
// Desligado (personalizado): o portal usa o dele, e as Gerais só completam o
// que ficou vazio. Salva na hora — é uma chave, não um formulário.
import { Link } from 'wouter-preact'
import { Switch } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import { useEduGeral, useSalvarHeranca, SEM_HERANCA, type Heranca } from '@/hooks/useEduGeral'

export const SECOES_HERANCA: Array<{ chave: keyof Heranca; titulo: string; texto: string }> = [
  { chave: 'marca', titulo: 'Aparência', texto: 'Logo, ícone, rodapé, cores, fonte e botões.' },
  { chave: 'textos', titulo: 'Textos', texto: 'Textos do formulário e das telas do portal.' },
  { chave: 'seo', titulo: 'SEO e medição', texto: 'Imagem de compartilhamento e pixels.' },
]

export function useHerancaDoPortal(portalId: number): { heranca: Heranca; carregando: boolean } {
  const { data, isLoading } = useEduGeral()
  return { heranca: data?.geral.heranca[String(portalId)] ?? SEM_HERANCA, carregando: isLoading }
}

/** As três chaves de um portal. `compacto` = só as chaves (linha de tabela). */
export function ChavesDeHeranca({ portalId, compacto }: { portalId: number; compacto?: boolean }) {
  const { heranca, carregando } = useHerancaDoPortal(portalId)
  const salvar = useSalvarHeranca()
  function mudar(chave: keyof Heranca, v: boolean) {
    salvar.mutate({ portalId, [chave]: v }, {
      onSuccess: () => toast(v ? 'Agora segue as Configurações Gerais' : 'Agora usa a configuração própria do portal', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }
  if (compacto) {
    return (
      <>
        {SECOES_HERANCA.map((s) => (
          <Switch key={s.chave} checked={heranca[s.chave]} disabled={carregando || salvar.isPending}
            ariaLabel={`${s.titulo}: seguir as Configurações Gerais`} onChange={(v) => mudar(s.chave, v)} />
        ))}
      </>
    )
  }
  return (
    <div class="space-y-3">
      {SECOES_HERANCA.map((s) => (
        <Switch key={s.chave} checked={heranca[s.chave]} disabled={carregando || salvar.isPending}
          label={`${s.titulo}: seguir as Configurações Gerais`}
          hint={heranca[s.chave] ? `${s.texto} O que estiver preenchido nas Gerais vale por cima deste portal.` : `${s.texto} Usa o deste portal; as Gerais só completam o que estiver vazio.`}
          onChange={(v) => mudar(s.chave, v)} />
      ))}
      <div class="text-2xs text-fg-muted">
        Edite os valores em <Link href="/app/educational/configuracoes" class="text-accent hover:underline">Educacional › Configurações Gerais</Link>.
      </div>
    </div>
  )
}
