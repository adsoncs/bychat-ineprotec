import { useState } from 'preact/hooks'
import { ShieldCheck, ShieldOff, KeyRound, Copy, AlertTriangle } from 'lucide-preact'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { toast } from '@/lib/toast'
import { useStatus2fa, use2faMut, type Inicio2fa } from '@/hooks/useTwoFactor'

// Segundo fator da conta do operador (G16 / RN-1401).
//
// Fica dentro de Segurança em vez de virar tela própria: é aqui que quem
// administra o sistema já procura esse tipo de ajuste.

export function TwoFactorSection() {
  const { data, isLoading } = useStatus2fa()
  const mut = use2faMut()

  const [inicio, setInicio] = useState<Inicio2fa | null>(null)
  const [codigo, setCodigo] = useState('')
  const [senha, setSenha] = useState('')
  const [desativando, setDesativando] = useState(false)
  const [codigos, setCodigos] = useState<string[] | null>(null)

  const iniciar = () => {
    mut.iniciar.mutate(undefined, {
      onSuccess: (r) => { setInicio(r); setCodigo(''); setCodigos(null) },
      onError: (e: any) => toast(e?.message ?? 'Não foi possível iniciar o cadastro.', 'danger'),
    })
  }

  const confirmar = () => {
    mut.confirmar.mutate(codigo, {
      onSuccess: (r) => {
        setInicio(null); setCodigo('')
        setCodigos(r.codigosRecuperacao)
        toast('Segundo fator ativado.', 'success')
      },
      onError: (e: any) => toast(e?.message ?? 'Código inválido.', 'danger'),
    })
  }

  const desativar = () => {
    mut.desativar.mutate(senha, {
      onSuccess: () => { setSenha(''); setDesativando(false); setCodigos(null); toast('Segundo fator desativado.', 'success') },
      onError: (e: any) => toast(e?.message ?? 'Não foi possível desativar.', 'danger'),
    })
  }

  const regerar = () => {
    mut.novosCodigos.mutate(senha, {
      onSuccess: (r) => { setSenha(''); setCodigos(r.codigosRecuperacao); toast('Novos códigos gerados — os anteriores deixaram de valer.', 'success') },
      onError: (e: any) => toast(e?.message ?? 'Não foi possível gerar.', 'danger'),
    })
  }

  const copiar = (texto: string) => {
    void navigator.clipboard?.writeText(texto).then(
      () => toast('Copiado.', 'success'),
      () => toast('Não foi possível copiar.', 'danger'),
    )
  }

  if (isLoading) return <Skeleton class="h-32 w-full" />

  return (
    <section class="rounded-xl border border-border bg-surface-2 p-5 space-y-4">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h3 class="text-sm font-semibold text-fg flex items-center gap-2">
            {data?.habilitado ? <ShieldCheck size={16} class="text-success" /> : <ShieldOff size={16} class="text-fg-subtle" />}
            Verificação em duas etapas
          </h3>
          <p class="text-xs text-fg-muted mt-1 max-w-xl">
            Quem altera nota, defere regime especial ou emite diploma faz coisas que não se desfazem.
            Com a verificação ligada, a senha sozinha não abre a conta.
          </p>
        </div>
        {data?.habilitado ? (
          <span class="text-[11px] px-2 py-1 rounded-full bg-success/15 text-success shrink-0">Ativa</span>
        ) : (
          <span class="text-[11px] px-2 py-1 rounded-full bg-surface-3 text-fg-muted shrink-0">Desativada</span>
        )}
      </div>

      {/* Códigos de recuperação recém-gerados — aparecem uma vez só. */}
      {codigos && (
        <div class="rounded-lg border border-warning/40 bg-warning/5 p-3 space-y-2">
          <div class="flex items-center gap-2 text-sm text-fg font-medium">
            <AlertTriangle size={15} class="text-warning" /> Guarde os códigos de recuperação
          </div>
          <p class="text-xs text-fg-muted">
            Eles aparecem <strong class="text-fg">uma única vez</strong> — o sistema guarda só o hash.
            Cada um serve para um login, e são eles que te devolvem a conta se você perder o celular.
          </p>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-1.5 font-mono text-xs">
            {codigos.map((c) => <div key={c} class="rounded bg-surface-3 px-2 py-1 text-center text-fg">{c}</div>)}
          </div>
          <div class="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => copiar(codigos.join('\n'))}>
              <Copy size={14} /> Copiar todos
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCodigos(null)}>Já guardei</Button>
          </div>
        </div>
      )}

      {/* Cadastro em andamento */}
      {inicio && !data?.habilitado && (
        <div class="rounded-lg border border-border p-3 space-y-3">
          <p class="text-xs text-fg-muted">
            Leia o código no aplicativo autenticador (Google Authenticator, Authy, 1Password…) e
            digite o número de 6 dígitos que ele mostrar.
          </p>
          <div class="flex flex-col sm:flex-row gap-4 items-start">
            {inicio.qrDataUrl && (
              <img src={inicio.qrDataUrl} alt="QR do segundo fator" width={180} height={180} class="rounded-lg bg-white p-2 shrink-0" />
            )}
            <div class="space-y-2 flex-1 min-w-0">
              <div>
                <div class="text-[11px] text-fg-muted mb-1">Ou digite este código no aplicativo:</div>
                <div class="flex items-center gap-2">
                  <code class="text-xs font-mono bg-surface-3 rounded px-2 py-1 break-all">{inicio.segredo}</code>
                  <Button size="sm" variant="ghost" iconOnly title="Copiar" onClick={() => copiar(inicio.segredo)}>
                    <Copy size={14} />
                  </Button>
                </div>
              </div>
              <Input
                label="Código do aplicativo" inputMode="numeric" maxLength={6} value={codigo}
                placeholder="000000"
                onInput={(e) => setCodigo((e.target as HTMLInputElement).value)}
              />
              <div class="flex gap-2">
                <Button size="sm" onClick={confirmar} disabled={codigo.length < 6 || mut.confirmar.isPending}>
                  Confirmar e ativar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setInicio(null)}>Cancelar</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Ações */}
      {!data?.habilitado && !inicio && (
        <Button onClick={iniciar} disabled={mut.iniciar.isPending}>
          <KeyRound size={16} /> Ativar verificação em duas etapas
        </Button>
      )}

      {data?.habilitado && (
        <div class="space-y-3">
          <div class="text-xs text-fg-muted">
            Ativa desde {data.confirmadoEm ? new Date(data.confirmadoEm).toLocaleString('pt-BR') : '—'} ·{' '}
            <strong class={data.codigosRecuperacaoRestantes <= 2 ? 'text-warning' : 'text-fg'}>
              {data.codigosRecuperacaoRestantes}
            </strong>{' '}
            código(s) de recuperação restante(s)
            {data.codigosRecuperacaoRestantes <= 2 && ' — vale gerar novos antes de acabar.'}
          </div>

          {desativando ? (
            <div class="rounded-lg border border-danger/40 bg-danger/5 p-3 space-y-2">
              <p class="text-xs text-fg-muted">
                Confirme sua senha. Ela é pedida porque estar com a sessão aberta não deveria bastar
                para desligar a proteção da conta.
              </p>
              <Input
                type="password" label="Senha atual" value={senha}
                onInput={(e) => setSenha((e.target as HTMLInputElement).value)}
              />
              <div class="flex gap-2">
                <Button size="sm" variant="danger" onClick={desativar} disabled={!senha || mut.desativar.isPending}>
                  Desativar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setDesativando(false); setSenha('') }}>Cancelar</Button>
                <Button size="sm" variant="secondary" onClick={regerar} disabled={!senha || mut.novosCodigos.isPending}>
                  Gerar novos códigos
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setDesativando(true)}>
              Desativar ou gerar novos códigos
            </Button>
          )}
        </div>
      )}
    </section>
  )
}
