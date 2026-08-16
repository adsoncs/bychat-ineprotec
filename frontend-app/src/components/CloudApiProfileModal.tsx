import { useEffect, useRef, useState } from 'preact/hooks'
import { Image as ImageIcon, Loader2, MessageSquarePlus, Plus, ShieldCheck, Trash2, Upload } from 'lucide-preact'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  useCloudApiProfile,
  useUpdateCloudApiProfile,
  useUpdateCloudApiAutomation,
  useUploadCloudApiProfilePicture,
  useSetCloudApiTwoStepPin,
  type CloudApiConnection,
  type UpdateCloudApiProfileInput,
} from '@/hooks/useCloudApi'
import { cloudApiQualityLabel } from '@/lib/statusLabels'
import { toast } from '@/lib/toast'

/** Setores aceitos pela Meta. O valor vai cru para a Graph; o rótulo é só a
 *  tradução do que o Gerenciador do WhatsApp mostra. `UNDEFINED` fica de fora
 *  da escrita de propósito: a Meta só o devolve na leitura de quem nunca
 *  definiu setor e recusa recebê-lo de volta. */
const VERTICAIS: Record<string, string> = {
  AUTO: 'Automotivo',
  BEAUTY: 'Beleza, spa e salão',
  APPAREL: 'Roupas e acessórios',
  EDU: 'Educação',
  ENTERTAIN: 'Entretenimento',
  EVENT_PLAN: 'Eventos e serviços',
  FINANCE: 'Finanças e bancos',
  GROCERY: 'Alimentos e mercados',
  GOVT: 'Serviço público',
  HOTEL: 'Hotelaria e hospedagem',
  HEALTH: 'Saúde e bem-estar',
  NONPROFIT: 'Organização sem fins lucrativos',
  PROF_SERVICES: 'Serviços profissionais',
  RETAIL: 'Compras e varejo',
  TRAVEL: 'Viagens e transporte',
  RESTAURANT: 'Restaurantes',
  ALCOHOL: 'Bebidas alcoólicas',
  ONLINE_GAMBLING: 'Apostas online',
  PHYSICAL_GAMBLING: 'Apostas presenciais',
  OTC_DRUGS: 'Medicamentos sem receita',
  MATRIMONY_SERVICE: 'Serviços matrimoniais',
  OTHER: 'Outro',
}

const NAME_STATUS: Record<string, string> = {
  APPROVED: 'Aprovado',
  AVAILABLE_WITHOUT_REVIEW: 'Liberado sem revisão',
  DECLINED: 'Recusado pela Meta',
  EXPIRED: 'Expirado',
  PENDING_REVIEW: 'Em revisão pela Meta',
  NONE: 'Sem nome cadastrado',
}

const SEARCH_VISIBILITY: Record<string, string> = {
  VISIBLE: 'Aparece na busca do WhatsApp',
  NON_VISIBLE: 'Não aparece na busca',
}

interface ComandoEdit { name: string; description: string }

export function CloudApiProfileModal({
  connection, onClose,
}: {
  connection: CloudApiConnection
  onClose: () => void
}) {
  const { data, isLoading, error } = useCloudApiProfile(connection.id)
  const salvar = useUpdateCloudApiProfile(connection.id)
  const salvarAutomacao = useUpdateCloudApiAutomation(connection.id)
  const enviarFoto = useUploadCloudApiProfilePicture(connection.id)

  const [sobre, setSobre] = useState('')
  const [descricao, setDescricao] = useState('')
  const [endereco, setEndereco] = useState('')
  const [email, setEmail] = useState('')
  const [setor, setSetor] = useState('')
  const [site1, setSite1] = useState('')
  const [site2, setSite2] = useState('')
  const [boasVindas, setBoasVindas] = useState(false)
  const [perguntas, setPerguntas] = useState<string[]>([])
  const [comandos, setComandos] = useState<ComandoEdit[]>([])
  // A automação é outro endpoint da Meta: só é enviada se o operador mexeu nela.
  const [automacaoTocada, setAutomacaoTocada] = useState(false)
  // O que a Meta se recusou a alterar no último salvamento.
  const [avisos, setAvisos] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  // O formulário só é preenchido quando o perfil chega da Meta — antes disso
  // salvar mandaria campos vazios e apagaria o perfil de verdade.
  useEffect(() => {
    if (!data) return
    const p = data.profile
    setSobre(p.about)
    setDescricao(p.description)
    setEndereco(p.address)
    setEmail(p.email)
    setSetor(p.vertical && p.vertical !== 'UNDEFINED' ? p.vertical : '')
    setSite1(p.websites[0] ?? '')
    setSite2(p.websites[1] ?? '')
    setBoasVindas(data.automation?.enable_welcome_message ?? false)
    setPerguntas(data.automation?.prompts ?? [])
    setComandos((data.automation?.commands ?? []).map((c) => ({
      name: c.command_name, description: c.command_description,
    })))
    setAutomacaoTocada(false)
    setAvisos([])
  }, [data])

  const limites = data?.limits ?? {
    about: 139, address: 256, description: 512, email: 128, website: 256,
    prompts: 4, prompt: 80, commands: 30, commandName: 32, commandDescription: 256,
  }
  const verticais = data?.verticals ?? Object.keys(VERTICAIS)
  const salvando = salvar.isPending || salvarAutomacao.isPending

  function mexeuNaAutomacao<T>(setter: (v: T) => void) {
    return (v: T) => { setAutomacaoTocada(true); setter(v) }
  }

  async function handleSalvar() {
    if (!data) return
    const atual = data.profile
    const websites = [site1, site2].map((s) => s.trim()).filter(Boolean)

    // Só o que o operador realmente mexeu. Reenviar o formulário inteiro fazia
    // uma leitura incompleta da Meta virar apagamento do que estava lá.
    const input: UpdateCloudApiProfileInput = {}
    if (sobre.trim() !== atual.about.trim()) input.about = sobre
    if (descricao.trim() !== atual.description.trim()) input.description = descricao
    if (endereco.trim() !== atual.address.trim()) input.address = endereco
    if (email.trim() !== atual.email.trim()) input.email = email
    // `vertical` vai vazio quando é "Não informado" — o servidor omite o campo.
    // Mandar 'UNDEFINED' faz a Meta recusar o perfil inteiro com (#100).
    if (setor !== (atual.vertical === 'UNDEFINED' ? '' : atual.vertical)) input.vertical = setor
    if (websites.join('|') !== atual.websites.join('|')) input.websites = websites

    if (!Object.keys(input).length && !automacaoTocada) {
      toast('Nada foi alterado no perfil', 'info')
      onClose()
      return
    }

    try {
      const r = Object.keys(input).length
        ? await salvar.mutateAsync(input)
        : { warnings: [] as string[] }
      if (automacaoTocada) {
        await salvarAutomacao.mutateAsync({
          enableWelcomeMessage: boasVindas,
          prompts: perguntas.map((p) => p.trim()).filter(Boolean),
          commands: comandosValidos(comandos),
        })
      }
      // Salvou, mas a Meta barrou parte do que foi pedido: o operador precisa
      // ler o motivo antes da tela fechar e ele achar que ficou tudo gravado.
      if (r.warnings?.length) {
        setAvisos(r.warnings)
        toast('Perfil salvo, mas a Meta não aceitou tudo', 'warning')
        return
      }
      toast('Perfil atualizado no WhatsApp', 'success')
      onClose()
    } catch (e) {
      toast((e as Error).message, 'danger')
    }
  }

  function handleFoto(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return
    enviarFoto.mutate(file, {
      onSuccess: () => toast('Foto do perfil atualizada', 'success'),
      onError: (err: unknown) => toast((err as Error).message, 'danger'),
    })
    if (fileRef.current) fileRef.current.value = ''
  }

  const num = data?.number
  const foto = data?.profile.profilePictureUrl
  const preenchidos = data?.filled

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      size="xl"
      title="Perfil da empresa no WhatsApp"
      description={`É o que o cliente vê ao abrir a conversa com ${connection.displayName ?? connection.displayPhone}`}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={salvando}>Fechar</Button>
          <Button variant="primary" size="sm" onClick={() => void handleSalvar()} disabled={salvando || isLoading || !data}>
            {salvando ? 'Salvando…' : 'Salvar perfil'}
          </Button>
        </>
      }
    >
      {isLoading && <div class="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} class="h-10 w-full" />)}</div>}

      {!!error && !isLoading && (
        <div class="rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">{(error as Error).message}</div>
      )}

      {avisos.length > 0 && (
        <div class="mb-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
          <div class="text-xs font-medium text-warning">O que a Meta não aceitou</div>
          <ul class="mt-1 list-disc space-y-0.5 pl-4 text-xs text-fg-muted">
            {avisos.map((a) => <li key={a}>{a}</li>)}
          </ul>
        </div>
      )}

      {data && (
        <div class="space-y-4">
          {/* O que a conta já tem preenchido na Meta hoje. O perfil da API é
              separado do app do celular: campo vazio aqui é campo vazio lá. */}
          {preenchidos && (
            <div class="rounded-md border border-border bg-surface px-3 py-2">
              <div class="text-xs uppercase tracking-wider text-fg-subtle mb-1.5">Já configurado nesta conta</div>
              <div class="flex flex-wrap gap-1.5">
                <Preenchido on={preenchidos.profilePicture} label="Foto" />
                <Preenchido on={preenchidos.about} label="Recado" />
                <Preenchido on={preenchidos.description} label="Descrição" />
                <Preenchido on={preenchidos.vertical} label="Setor" />
                <Preenchido on={preenchidos.websites} label="Site" />
                <Preenchido on={preenchidos.address} label="Endereço" />
                <Preenchido on={preenchidos.email} label="E-mail" />
                <Preenchido on={(data.automation?.prompts.length ?? 0) > 0} label="Perguntas frequentes" />
                <Preenchido on={(data.automation?.commands.length ?? 0) > 0} label="Comandos" />
              </div>
            </div>
          )}

          {/* Foto — a Meta só aceita arquivo novo (não dá para apontar uma URL) */}
          <div class="flex items-center gap-4">
            <div class="size-20 shrink-0 overflow-hidden rounded-full border border-border bg-surface-3 grid place-items-center">
              {foto
                ? <img src={foto} alt="Foto do perfil" class="size-full object-cover" />
                : <ImageIcon size={22} class="text-fg-subtle" />}
            </div>
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium text-fg">Foto do perfil</div>
              <p class="text-xs text-fg-muted">
                {foto
                  ? 'É a foto que a Meta tem hoje para este número.'
                  : 'Nenhuma foto definida na Meta para este número ainda.'}
                {' '}JPG ou PNG, quadrada, até 5 MB.
              </p>
              <div class="mt-2">
                <input ref={fileRef} type="file" accept="image/jpeg,image/png" class="hidden" onChange={handleFoto} />
                <Button variant="secondary" size="sm" disabled={enviarFoto.isPending} onClick={() => fileRef.current?.click()}>
                  {enviarFoto.isPending
                    ? <><Loader2 size={13} class="animate-spin" /> Enviando…</>
                    : <><Upload size={13} /> {foto ? 'Trocar foto' : 'Enviar foto'}</>}
                </Button>
              </div>
            </div>
          </div>

          <div class="border-t border-border pt-4 space-y-3">
            <Input
              label="Recado (status)"
              value={sobre}
              maxLength={limites.about}
              hint={`Frase curta abaixo do nome no perfil. A Meta não deixa apagar depois de preenchido. ${sobre.length}/${limites.about}`}
              onInput={(e) => setSobre((e.target as HTMLInputElement).value)}
            />
            <Textarea
              label="Descrição"
              value={descricao}
              rows={3}
              maxLength={limites.description}
              hint={`O que a empresa faz, como o cliente vê no perfil. ${descricao.length}/${limites.description}`}
              onInput={(e) => setDescricao((e.target as HTMLTextAreaElement).value)}
            />
            <div class="grid gap-3 sm:grid-cols-2">
              <Input
                label="Endereço"
                value={endereco}
                maxLength={limites.address}
                onInput={(e) => setEndereco((e.target as HTMLInputElement).value)}
              />
              <Input
                label="E-mail"
                type="email"
                value={email}
                maxLength={limites.email}
                onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
              />
              <Input
                label="Site"
                value={site1}
                maxLength={limites.website}
                placeholder="https://…"
                onInput={(e) => setSite1((e.target as HTMLInputElement).value)}
              />
              <Input
                label="Site alternativo"
                value={site2}
                maxLength={limites.website}
                placeholder="https://…"
                hint="A Meta aceita no máximo 2 sites."
                onInput={(e) => setSite2((e.target as HTMLInputElement).value)}
              />
              <Select
                label="Setor"
                value={setor}
                hint={preenchidos?.vertical ? 'A Meta não permite voltar para "Não informado".' : undefined}
                onChange={(e) => setSetor((e.target as HTMLSelectElement).value)}
              >
                <option value="">Não informado</option>
                {verticais.filter((v) => v !== 'UNDEFINED').map((v) => (
                  <option key={v} value={v}>{VERTICAIS[v] ?? v}</option>
                ))}
              </Select>
            </div>
          </div>

          {/* Automação conversacional — aparece na conversa antes de o cliente escrever */}
          <div class="border-t border-border pt-4">
            <div class="flex items-center gap-2 mb-2">
              <MessageSquarePlus size={15} class="text-fg-subtle" />
              <div class="text-sm font-medium text-fg">Atalhos na abertura da conversa</div>
            </div>

            <label class="flex items-center gap-2 text-sm text-fg-muted mb-3">
              <input
                type="checkbox"
                checked={boasVindas}
                onChange={(e) => mexeuNaAutomacao(setBoasVindas)((e.target as HTMLInputElement).checked)}
              />
              Avisar quando um cliente abre a conversa pela primeira vez
            </label>
            <p class="-mt-2 mb-3 text-xs text-fg-subtle">
              Com isso ligado, a Meta manda um evento de boas-vindas no webhook — quem responde é o
              chatbot ou o fluxo vinculado a esta conexão.
            </p>

            <ListaEditavel
              titulo="Perguntas frequentes"
              descricao={`Botões que o cliente toca ao abrir a conversa. Até ${limites.prompts}, ${limites.prompt} caracteres cada.`}
              itens={perguntas}
              max={limites.prompts}
              maxLen={limites.prompt}
              placeholder="Ex.: Quero falar com um consultor"
              onChange={mexeuNaAutomacao(setPerguntas)}
            />

            <ListaComandos
              comandos={comandos}
              max={limites.commands}
              maxNome={limites.commandName}
              maxDescricao={limites.commandDescription}
              onChange={mexeuNaAutomacao(setComandos)}
            />
          </div>

          {/* Só leitura: o nome de exibição passa por revisão da Meta e não muda por API */}
          {num && (
            <div class="border-t border-border pt-4">
              <div class="text-sm font-medium text-fg mb-2">Dados do número (definidos pela Meta)</div>
              <div class="grid gap-2 text-xs sm:grid-cols-3">
                <ReadOnly label="Nome de exibição" value={num.verifiedName ?? '—'} />
                <ReadOnly label="Status do nome" value={num.nameStatus ? (NAME_STATUS[num.nameStatus] ?? num.nameStatus) : '—'} />
                <ReadOnly label="Qualidade" value={num.qualityRating ? cloudApiQualityLabel(num.qualityRating) : '—'} />
                <ReadOnly label="Limite de disparo" value={num.messagingLimitTier ?? num.throughputLevel ?? '—'} />
                <ReadOnly label="Situação" value={num.status ?? '—'} />
                <ReadOnly label="Modo da conta" value={num.accountMode ?? '—'} />
                <ReadOnly label="Modo" value={num.platformType ?? '—'} />
                <ReadOnly label="Busca do WhatsApp" value={num.searchVisibility ? (SEARCH_VISIBILITY[num.searchVisibility] ?? num.searchVisibility) : '—'} />
                <ReadOnly label="Conta oficial" value={num.isOfficialBusinessAccount ? 'Sim (selo verde)' : 'Não'} />
              </div>
              {num.webhookUrl && (
                <div class="mt-2">
                  <ReadOnly label="Webhook em uso na Meta" value={num.webhookUrl} />
                </div>
              )}
              <p class="mt-2 text-xs text-fg-subtle">
                O nome de exibição e o selo verde não mudam por aqui: são pedidos no
                Gerenciador do WhatsApp da Meta e passam por revisão.
              </p>
            </div>
          )}

          <TwoStepPin connectionId={connection.id} />
        </div>
      )}
    </Modal>
  )
}

/** Comandos incompletos fazem a Meta recusar a lista inteira — some com eles. */
function comandosValidos(comandos: ComandoEdit[]) {
  return comandos
    .map((c) => ({ name: c.name.trim(), description: c.description.trim() }))
    .filter((c) => c.name && c.description)
}

function Preenchido({ on, label }: { on: boolean; label: string }) {
  return <Badge tone={on ? 'success' : 'neutral'}>{on ? label : `${label}: vazio`}</Badge>
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div class="text-[0.625rem] uppercase tracking-wider text-fg-subtle">{label}</div>
      <div class="truncate text-sm text-fg" title={value}>{value}</div>
    </div>
  )
}

function ListaEditavel({
  titulo, descricao, itens, max, maxLen, placeholder, onChange,
}: {
  titulo: string
  descricao: string
  itens: string[]
  max: number
  maxLen: number
  placeholder: string
  onChange: (v: string[]) => void
}) {
  return (
    <div class="mb-4">
      <div class="text-sm font-medium text-fg">{titulo}</div>
      <p class="mb-2 text-xs text-fg-subtle">{descricao}</p>
      <div class="space-y-2">
        {itens.map((item, i) => (
          <div key={i} class="flex items-center gap-2">
            <div class="flex-1">
              <Input
                value={item}
                maxLength={maxLen}
                placeholder={placeholder}
                onInput={(e) => {
                  const next = [...itens]
                  next[i] = (e.target as HTMLInputElement).value
                  onChange(next)
                }}
              />
            </div>
            <button
              type="button"
              class="size-8 shrink-0 grid place-items-center rounded-md text-fg-muted hover:text-danger hover:bg-surface-3"
              aria-label="Remover"
              onClick={() => onChange(itens.filter((_, idx) => idx !== i))}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      {itens.length < max && (
        <Button variant="ghost" size="sm" class="mt-1" onClick={() => onChange([...itens, ''])}>
          <Plus size={13} /> Adicionar
        </Button>
      )}
    </div>
  )
}

function ListaComandos({
  comandos, max, maxNome, maxDescricao, onChange,
}: {
  comandos: ComandoEdit[]
  max: number
  maxNome: number
  maxDescricao: number
  onChange: (v: ComandoEdit[]) => void
}) {
  return (
    <div>
      <div class="text-sm font-medium text-fg">Comandos</div>
      <p class="mb-2 text-xs text-fg-subtle">
        O cliente digita "/" e vê a lista. Até {max} comandos; a resposta é do chatbot ou do fluxo.
      </p>
      <div class="space-y-2">
        {comandos.map((cmd, i) => (
          <div key={i} class="flex items-start gap-2">
            <div class="w-32 shrink-0">
              <Input
                value={cmd.name}
                maxLength={maxNome}
                placeholder="precos"
                onInput={(e) => {
                  const next = [...comandos]
                  // A Meta guarda o nome sem a barra e sem espaço.
                  next[i] = { ...cmd, name: (e.target as HTMLInputElement).value.replace(/[^\w-]/g, '').toLowerCase() }
                  onChange(next)
                }}
              />
            </div>
            <div class="flex-1">
              <Input
                value={cmd.description}
                maxLength={maxDescricao}
                placeholder="Ver a tabela de preços"
                onInput={(e) => {
                  const next = [...comandos]
                  next[i] = { ...cmd, description: (e.target as HTMLInputElement).value }
                  onChange(next)
                }}
              />
            </div>
            <button
              type="button"
              class="size-8 shrink-0 grid place-items-center rounded-md text-fg-muted hover:text-danger hover:bg-surface-3"
              aria-label="Remover comando"
              onClick={() => onChange(comandos.filter((_, idx) => idx !== i))}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      {comandos.length < max && (
        <Button variant="ghost" size="sm" class="mt-1" onClick={() => onChange([...comandos, { name: '', description: '' }])}>
          <Plus size={13} /> Adicionar comando
        </Button>
      )}
    </div>
  )
}

/** O PIN vale para re-registrar o número na Meta. Não é armazenado aqui — quem
 *  esquecer precisa esperar 7 dias para desbloquear pela Meta. */
function TwoStepPin({ connectionId }: { connectionId: number }) {
  const [pin, setPin] = useState('')
  const salvar = useSetCloudApiTwoStepPin(connectionId)

  return (
    <div class="border-t border-border pt-4">
      <div class="flex items-center gap-2 mb-2">
        <ShieldCheck size={15} class="text-fg-subtle" />
        <div class="text-sm font-medium text-fg">Verificação em duas etapas</div>
        <Badge tone="neutral">Opcional</Badge>
      </div>
      <div class="flex flex-wrap items-end gap-2">
        <div class="w-40">
          <Input
            label="Novo PIN (6 dígitos)"
            value={pin}
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            onInput={(e) => setPin((e.target as HTMLInputElement).value.replace(/\D/g, ''))}
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={pin.length !== 6 || salvar.isPending}
          onClick={() => salvar.mutate(pin, {
            onSuccess: () => { toast('PIN atualizado na Meta', 'success'); setPin('') },
            onError: (e: unknown) => toast((e as Error).message, 'danger'),
          })}
        >
          {salvar.isPending ? 'Salvando…' : 'Definir PIN'}
        </Button>
      </div>
      <p class="mt-1 text-xs text-fg-subtle">
        Guarde o PIN fora do sistema: ele é exigido para registrar o número de novo na Meta
        e não fica salvo aqui.
      </p>
    </div>
  )
}
