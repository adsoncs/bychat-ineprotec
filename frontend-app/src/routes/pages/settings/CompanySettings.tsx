// CompanySettings — cadastro da empresa + Dados de Notificações.
// Os "Dados de Notificações" (listas de e-mails e WhatsApps) são a fonte única
// que o backend consome em getNotificationTargets() para os avisos internos:
// novo lead, agendamento e LGPD. Razão social/CNPJ são compartilhados com a
// aba LGPD (mesmos campos legal.company_name / legal.cnpj).

import { useEffect, useState } from 'preact/hooks'
import { Building2, Bell, Mail, Plus, Trash2, MessageCircle } from 'lucide-preact'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { Input } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import {
  useCompanySettings, useUpdateCompanySettings, type CompanyConfig,
} from '@/hooks/useSettings'

const EMPTY: CompanyConfig = {
  companyName: '', cnpj: '', notifyEmails: [], notifyWhatsapps: [], ccAgents: true,
}

// Editor de lista (e-mails ou telefones): linhas com remover + botão adicionar.
function ListEditor(props: {
  icon: preact.JSX.Element
  label: string
  hint: string
  placeholder: string
  type?: string
  values: string[]
  onChange: (v: string[]) => void
}) {
  const { values, onChange } = props
  const rows = values.length === 0 ? [''] : values

  function setAt(i: number, v: string) {
    const next = [...rows]
    next[i] = v
    onChange(next)
  }
  function removeAt(i: number) {
    const next = rows.filter((_, idx) => idx !== i)
    onChange(next)
  }
  function add() {
    onChange([...rows, ''])
  }

  return (
    <div>
      <div class="flex items-center gap-2 mb-1">
        {props.icon}
        <span class="text-sm font-medium text-fg">{props.label}</span>
      </div>
      <p class="text-xs text-fg-muted mb-2">{props.hint}</p>
      <div class="space-y-2">
        {rows.map((v, i) => (
          <div key={i} class="flex items-center gap-2">
            <Input
              type={props.type}
              value={v}
              placeholder={props.placeholder}
              class="flex-1"
              onInput={(e) => setAt(i, (e.target as HTMLInputElement).value)}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => removeAt(i)}
              disabled={rows.length === 1 && !v.trim()}
              aria-label="Remover"
            >
              <Trash2 size={15} />
            </Button>
          </div>
        ))}
      </div>
      <Button type="button" variant="ghost" size="sm" class="mt-2" onClick={add}>
        <Plus size={14} class="mr-1" /> Adicionar
      </Button>
    </div>
  )
}

export function CompanySettings() {
  const { data, isLoading } = useCompanySettings()
  const update = useUpdateCompanySettings()
  const [draft, setDraft] = useState<CompanyConfig>(EMPTY)

  useEffect(() => {
    if (data) setDraft({ ...EMPTY, ...data })
  }, [data])

  function set<K extends keyof CompanyConfig>(k: K, v: CompanyConfig[K]) {
    setDraft((d) => ({ ...d, [k]: v }))
  }

  function handleSave() {
    // Limpa vazios antes de enviar.
    const payload: CompanyConfig = {
      ...draft,
      notifyEmails: draft.notifyEmails.map((e) => e.trim()).filter(Boolean),
      notifyWhatsapps: draft.notifyWhatsapps.map((e) => e.trim()).filter(Boolean),
    }
    update.mutate(payload, {
      onSuccess: () => toast('Dados da empresa salvos', 'success'),
      onError: (e: unknown) => toast((e as Error).message || 'Erro ao salvar', 'danger'),
    })
  }

  if (isLoading) return <Skeleton class="h-96 w-full" />

  return (
    <div class="space-y-4">
      <Card>
        <div class="flex items-start gap-3 mb-4">
          <Building2 size={18} class="text-info shrink-0 mt-0.5" />
          <div class="min-w-0">
            <div class="text-sm font-semibold text-fg">Dados da empresa</div>
            <p class="text-xs text-fg-muted mt-0.5">
              Identificação da empresa. Razão social e CNPJ são compartilhados com a aba
              LGPD / Legal (mesmos dados nas páginas públicas).
            </p>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input
            label="Razão social"
            value={draft.companyName}
            placeholder="Minha Empresa Educacional LTDA"
            onInput={(e) => set('companyName', (e.target as HTMLInputElement).value)}
          />
          <Input
            label="CNPJ"
            value={draft.cnpj}
            placeholder="00.000.000/0001-00"
            onInput={(e) => set('cnpj', (e.target as HTMLInputElement).value)}
          />
        </div>
      </Card>

      <Card>
        <div class="flex items-start gap-3 mb-4">
          <Bell size={18} class="text-info shrink-0 mt-0.5" />
          <div class="min-w-0">
            <div class="text-sm font-semibold text-fg">Dados de Notificações</div>
            <p class="text-xs text-fg-muted mt-0.5">
              Quem recebe os avisos internos do sistema: <strong>novo lead</strong>,
              <strong> agendamento</strong> e <strong>solicitações LGPD</strong>. Pode informar
              vários destinos — todos recebem. O WhatsApp dos avisos sai pelo número conectado
              da sua instância.
            </p>
          </div>
        </div>

        <div class="space-y-5">
          <ListEditor
            icon={<Mail size={15} class="text-fg-muted" />}
            label="E-mails que recebem notificações"
            hint="Um ou mais e-mails. Deixe vazio para usar o destino legado do .env (compatibilidade)."
            placeholder="avisos@suaempresa.com.br"
            type="email"
            values={draft.notifyEmails}
            onChange={(v) => set('notifyEmails', v)}
          />

          <ListEditor
            icon={<MessageCircle size={15} class="text-fg-muted" />}
            label="WhatsApps que recebem notificações"
            hint="Número com DDI + DDD, só dígitos (ex.: 5562999990000). Um ou mais."
            placeholder="5562999990000"
            values={draft.notifyWhatsapps}
            onChange={(v) => set('notifyWhatsapps', v)}
          />

          <label class="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              class="mt-0.5"
              checked={draft.ccAgents}
              onChange={(e) => set('ccAgents', (e.target as HTMLInputElement).checked)}
            />
            <span class="text-sm text-fg">
              Copiar agentes ativos (CC) nos avisos por e-mail de novo lead
              <span class="block text-xs text-fg-muted">
                Quando ligado, todos os operadores marcados como agente recebem cópia do e-mail.
              </span>
            </span>
          </label>
        </div>
      </Card>

      <div class="flex justify-end">
        <Button onClick={handleSave} disabled={update.isPending}>
          {update.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </div>
  )
}
