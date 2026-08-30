import { AlertTriangle, CheckCircle } from '@/components/ui/icon-set'
import {
  useDefaultTeam, useSetDefaultTeam, useTeams,
  useTeamsOrphans, useApplyFallbackToOrphans,
} from '@/hooks/useTeams'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Input'
import { toast } from '@/lib/toast'

export function DefaultTeamCard() {
  const { data, isLoading } = useDefaultTeam()
  const { data: teamsData } = useTeams()
  const { data: orphans } = useTeamsOrphans()
  const setTeam = useSetDefaultTeam()
  const apply = useApplyFallbackToOrphans()

  const teams = teamsData?.teams ?? []
  const orphanCount = orphans?.count ?? 0
  const team = data?.team

  function handleChange(v: string) {
    const id = v ? Number(v) : null
    setTeam.mutate(id, {
      onSuccess: () => toast('Setor fallback atualizado', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleApply() {
    if (!team) return
    if (!window.confirm(`Aplicar o setor "${team.name}" em ${orphanCount} lead(s) órfãos?\n\nLeads criados antes da configuração do fallback serão atribuídos a este setor.`)) return
    apply.mutate(undefined, {
      onSuccess: (r) => toast(`${r.affected} lead(s) atualizado(s)`, 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Card class={team ? 'border-success/40' : 'border-danger/40'}>
      <div class="space-y-3">
        <div>
          <h2 class="text-sm font-semibold text-fg">Setor padrão (fallback global)</h2>
          <p class="text-xs text-fg-muted mt-0.5 leading-relaxed">
            Para onde vão leads que entram sem roteamento explícito (formulários, Meta Ads, chat web,
            criação manual). Garante que nenhum lead fica órfão.
          </p>
        </div>

        {isLoading ? (
          <Skeleton class="h-9 w-full" />
        ) : (
          <div class="flex flex-wrap items-center gap-2">
            {team ? (
              <span class="inline-flex items-center gap-1.5 text-xs font-medium text-success">
                <CheckCircle size={12} />
                Configurado: <strong class="text-fg">{team.name}</strong>
                <span class="size-2.5 rounded-full" style={{ background: team.color ?? 'var(--color-accent)' }} />
              </span>
            ) : (
              <span class="inline-flex items-center gap-1.5 text-xs font-medium text-danger">
                <AlertTriangle size={12} />
                Não configurado — leads sem roteamento explícito ficam invisíveis para gerentes
              </span>
            )}
            <div class="ml-auto flex items-center gap-2">
              <Select
                value={data?.teamId ? String(data.teamId) : ''}
                onChange={(e) => handleChange((e.target as HTMLSelectElement).value)}
                disabled={setTeam.isPending}
                class="min-w-[14rem]"
              >
                <option value="">— Sem fallback —</option>
                {teams.filter((t) => t.active).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </Select>
            </div>
          </div>
        )}

        {orphanCount > 0 && team && (
          <div class="rounded-md border border-warning/30 bg-warning/10 p-3 flex items-start gap-3">
            <AlertTriangle size={16} class="mt-0.5 shrink-0 text-warning" />
            <div class="flex-1 min-w-0 text-xs">
              <div class="font-semibold text-warning">{orphanCount} lead(s) sem setor detectado(s)</div>
              <div class="text-fg-muted mt-0.5">
                Criados antes da configuração do fallback. Gerentes não veem estes leads.
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={handleApply} disabled={apply.isPending}>
              {apply.isPending ? 'Aplicando…' : `Aplicar "${team.name}" em ${orphanCount} lead(s)`}
            </Button>
          </div>
        )}
      </div>
    </Card>
  )
}
