import { useEffect, useState } from 'preact/hooks'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useAuth, useUpdateProfile } from '@/hooks/useAuth'
import { ApiError } from '@/lib/apiClient'

interface ProfileModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Msg = { tone: 'success' | 'danger'; text: string } | null

export function ProfileModal({ open, onOpenChange }: ProfileModalProps) {
  const { user } = useAuth()
  const update = useUpdateProfile()

  const [name, setName] = useState(user?.name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [msg, setMsg] = useState<Msg>(null)

  useEffect(() => {
    if (open) {
      setName(user?.name ?? '')
      setEmail(user?.email ?? '')
      setCurrentPassword('')
      setNewPassword('')
      setMsg(null)
    }
  }, [open, user?.name, user?.email])

  async function handleSave() {
    setMsg(null)
    const trimmedName = name.trim()
    const trimmedEmail = email.trim()
    if (!trimmedName && !trimmedEmail) {
      setMsg({ tone: 'danger', text: 'Preencha ao menos nome ou email.' })
      return
    }
    const body: Record<string, string> = { name: trimmedName, email: trimmedEmail }
    if (currentPassword) body.currentPassword = currentPassword
    if (newPassword) body.password = newPassword

    try {
      await update.mutateAsync(body)
      setMsg({ tone: 'success', text: 'Perfil atualizado com sucesso!' })
      setCurrentPassword('')
      setNewPassword('')
      window.setTimeout(() => onOpenChange(false), 1200)
    } catch (err) {
      const text =
        err instanceof ApiError
          ? err.message || 'Erro ao salvar.'
          : 'Erro de conexão.'
      setMsg({ tone: 'danger', text })
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Meu perfil"
      description="Edite seus dados pessoais"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={update.isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={update.isPending}>
            {update.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div class="flex flex-col gap-4">
        <Input
          label="Nome"
          type="text"
          placeholder="Seu nome"
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          autoComplete="name"
        />
        <Input
          label="Email"
          type="email"
          value={email}
          onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
          autoComplete="email"
        />
        <div class="border-t border-border pt-4 flex flex-col gap-3">
          <div class="text-sm font-medium text-fg">Alterar senha</div>
          <Input
            label="Senha atual"
            type="password"
            placeholder="Necessária para alterar email ou senha"
            value={currentPassword}
            onInput={(e) => setCurrentPassword((e.target as HTMLInputElement).value)}
            autoComplete="current-password"
          />
          <Input
            label="Nova senha"
            type="password"
            placeholder="Min. 6 caracteres (deixe vazio para manter)"
            value={newPassword}
            onInput={(e) => setNewPassword((e.target as HTMLInputElement).value)}
            autoComplete="new-password"
          />
        </div>
        <div
          class={
            msg
              ? msg.tone === 'success'
                ? 'text-xs text-success min-h-[1.125rem]'
                : 'text-xs text-danger min-h-[1.125rem]'
              : 'text-xs min-h-[1.125rem]'
          }
          role={msg?.tone === 'danger' ? 'alert' : 'status'}
          aria-live="polite"
        >
          {msg?.text ?? ''}
        </div>
      </div>
    </Modal>
  )
}
