import { useState } from 'preact/hooks'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Section, Segmented, Switch } from '@/components/ui/PrefControls'
import { useAccountPrefs, DEFAULT_ACCOUNT_PREFS } from '@/hooks/useAccountPrefs'
import { useSidebarStore } from '@/stores/sidebar'
import { playNotificationSound, NOTIFICATION_SOUNDS } from '@/lib/notificationSound'
import { Play } from 'lucide-preact'
import {
  notificationSupport,
  requestNotificationPermission,
  showDesktopNotification,
  type NotifyPermission,
} from '@/lib/desktopNotify'

/**
 * Minhas preferências — o que cada pessoa ajusta na própria conta.
 *
 * Fica no menu do usuário, e não em Configurações, porque nada aqui muda a
 * instalação: são escolhas de quem está usando. Configurações é do
 * administrador, e misturar as duas coisas leva alguém a mexer no que é de
 * todos achando que ajusta o próprio ambiente.
 *
 * Tudo é gravado na conta (User.preferences), então acompanha a pessoa entre
 * navegadores e máquinas.
 */
export function AccountPrefsModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { prefs, setPref } = useAccountPrefs()
  const setSidebarMode = useSidebarStore((s) => s.setMode)
  const [permission, setPermission] = useState<NotifyPermission>(() => notificationSupport())

  // A permissão do navegador só pode ser pedida a partir de um gesto — daí o
  // pedido sair do clique no switch, e não de um efeito ao abrir o painel.
  async function toggleDesktop(next: boolean) {
    if (!next) { setPref({ notifyDesktop: false }); return }
    const p = await requestNotificationPermission()
    setPermission(p)
    setPref({ notifyDesktop: p === 'granted' })
    if (p === 'granted') {
      showDesktopNotification({
        title: 'Avisos ligados',
        body: 'É assim que você será avisado de mensagem nova.',
        tag: 'teste-permissao',
      })
    }
  }

  const desktopLigado = prefs.notifyDesktop && permission === 'granted'

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Minhas preferências"
      description="Valem só para você e acompanham a sua conta em qualquer computador."
      size="lg"
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              setPref(DEFAULT_ACCOUNT_PREFS)
              setSidebarMode(DEFAULT_ACCOUNT_PREFS.sidebarMode)
            }}
          >
            Restaurar padrões
          </Button>
          <Button variant="primary" onClick={() => onOpenChange(false)}>Fechar</Button>
        </>
      }
    >
      <div class="space-y-6">
        <Section title="Menu lateral">
          <Segmented
            label="Como o menu abre"
            help="No automático, o menu acompanha o tamanho da tela: recolhido em telas menores, aberto nas maiores."
            value={prefs.sidebarMode}
            options={[
              { id: 'auto', label: 'Automático' },
              { id: 'expanded', label: 'Sempre aberto' },
              { id: 'rail', label: 'Sempre recolhido' },
            ]}
            onChange={(v) => {
              const modo = v as typeof prefs.sidebarMode
              setPref({ sidebarMode: modo })
              setSidebarMode(modo) // efeito imediato, sem esperar o servidor
            }}
          />
          <Switch
            checked={prefs.showUnreadBadge}
            onChange={(v) => setPref({ showUnreadBadge: v })}
            label="Mostrar quantas conversas esperam resposta"
            help="Contador no item Conversas. Com o menu recolhido, vira um ponto sobre o ícone."
          />
        </Section>

        <Section title="Som" hint="O aviso sonoro vale em qualquer tela do painel.">
          <Switch
            checked={prefs.notifySound}
            onChange={(v) => { setPref({ notifySound: v }); if (v) playNotificationSound(prefs.notifySoundId, prefs.notifyVolume) }}
            label="Tocar som ao chegar mensagem"
            help="Mesmo controle do sino no topo da lista de conversas."
          />
          {prefs.notifySound && (
            <>
              <div class="flex items-end gap-3">
                <Segmented
                  label="Volume"
                  value={prefs.notifyVolume}
                  options={[
                    { id: 'low', label: 'Baixo' },
                    { id: 'medium', label: 'Médio' },
                    { id: 'high', label: 'Alto' },
                  ]}
                  onChange={(v) => {
                    const vol = v as typeof prefs.notifyVolume
                    setPref({ notifyVolume: vol })
                    playNotificationSound(prefs.notifySoundId, vol) // ouvir na hora é o único jeito de escolher
                  }}
                />
                <Button variant="secondary" size="sm" onClick={() => playNotificationSound(prefs.notifySoundId, prefs.notifyVolume)}>
                  Tocar agora
                </Button>
              </div>
              <div>
                <div class="text-sm text-fg mb-1">Som do aviso</div>
                <p class="text-xs text-fg-muted mb-2">
                  Clique para ouvir e escolher. Outros avisos do painel vão usar timbres diferentes deste.
                </p>
                <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {NOTIFICATION_SOUNDS.map((som) => {
                    const ativo = som.id === prefs.notifySoundId
                    return (
                      <button
                        key={som.id}
                        type="button"
                        // Escolher e ouvir são o mesmo gesto: ninguém decide um
                        // som lendo o nome dele.
                        onClick={() => { setPref({ notifySoundId: som.id }); playNotificationSound(som.id, prefs.notifyVolume) }}
                        aria-pressed={ativo}
                        title={som.hint}
                        class={[
                          'flex items-center gap-2 h-9 px-2.5 rounded-md border text-xs font-medium transition-colors text-left',
                          ativo
                            ? 'border-[color:var(--color-accent)] bg-[color:color-mix(in_oklch,var(--color-accent)_12%,transparent)] text-[color:var(--color-accent)]'
                            : 'border-border text-fg hover:bg-surface-3',
                        ].join(' ')}
                      >
                        <Play size={12} class="shrink-0 opacity-70" />
                        <span class="truncate">{som.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
              <Segmented
                label="Quando tocar"
                help="Alguns preferem silêncio enquanto trabalham no painel — o contador do menu continua avisando."
                value={prefs.notifyWhen}
                options={[
                  { id: 'always', label: 'Sempre' },
                  { id: 'away', label: 'Só fora do painel' },
                ]}
                onChange={(v) => setPref({ notifyWhen: v as typeof prefs.notifyWhen })}
              />
            </>
          )}
        </Section>

        <Section title="Avisos quando você não está no painel">
          <Switch
            checked={desktopLigado}
            onChange={(v) => { void toggleDesktop(v) }}
            label="Avisar na área de trabalho"
            help={
              permission === 'unsupported' ? 'Este navegador não oferece avisos do sistema.'
              : permission === 'denied' ? 'O navegador bloqueou os avisos deste site — libere nas permissões do endereço para usar.'
              : 'Mostra o aviso do sistema quando o painel está minimizado ou atrás de outra janela. O navegador vai pedir sua permissão.'
            }
          />
          {desktopLigado && (
            <Switch
              checked={prefs.notifyPreview}
              onChange={(v) => setPref({ notifyPreview: v })}
              label="Mostrar trecho da mensagem no aviso"
              help="Desligue em sala aberta ou ao compartilhar a tela: sem isto o aviso diz só quem mandou."
            />
          )}
          <Switch
            checked={prefs.flashTitle}
            onChange={(v) => setPref({ flashTitle: v })}
            label="Piscar o título da aba"
            help="Alterna para “(N) Nova mensagem!” enquanto a aba está em segundo plano."
          />
        </Section>
      </div>
    </Modal>
  )
}
