import { useEffect, useState } from 'preact/hooks'
import { Save, UserCircle } from 'lucide-preact'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { toast } from '@/lib/toast'

interface IdentityConfig {
  identificarOperador: boolean
  identificarModo: 'sempre' | 'ao_mudar'
  incluirSetor: boolean
  avisarTransferencia: boolean
  avisarTransferenciaModo: 'agente' | 'agente_setor' | 'setor'
  avisarTransferenciaTexto: string
}

const PADRAO: IdentityConfig = {
  identificarOperador: false,
  identificarModo: 'ao_mudar',
  incluirSetor: true,
  avisarTransferencia: false,
  avisarTransferenciaModo: 'agente_setor',
  avisarTransferenciaTexto: '{quem} vai continuar o seu atendimento a partir de agora. Todo o histórico da conversa já foi repassado.',
}

/**
 * Preview do aviso com dados de exemplo.
 *
 * Espelha a mesma lógica do servidor (montarTextoAviso): o cliente precisa ver o
 * resultado ANTES de salvar — texto de transferência errado só aparece na frente
 * do contato, quando já é tarde.
 */
function previewAviso(cfg: IdentityConfig): string {
  const agente = 'Rafael'
  const setor = 'Suporte'
  const quem = cfg.avisarTransferenciaModo === 'setor'
    ? `A equipe de ${setor}`
    : cfg.avisarTransferenciaModo === 'agente'
      ? agente
      : `${agente}, da equipe ${setor},`
  let t = (cfg.avisarTransferenciaTexto || '').replace(/\{quem\}/g, quem)
  t = t.replace(/\{agente\}/g, cfg.avisarTransferenciaModo === 'setor' ? `a equipe de ${setor}` : agente)
  if (cfg.avisarTransferenciaModo === 'agente') {
    t = t
      .replace(/,[^,]*\{setor\}[^,]*,/gi, ' ')
      .replace(/[,\s]*\(\s*\{setor\}\s*\)/gi, '')
      .replace(/[,\s]*\b(d[aoe]s?|no|na)\s+(equipe|setor|time|departamento)\s+\{setor\}/gi, '')
      .replace(/\{setor\}/g, '')
  } else {
    t = t.replace(/\{setor\}/g, setor)
  }
  return t.replace(/\s{2,}/g, ' ').replace(/\s+([,.;!?])/g, '$1').replace(/[\s,;:—–-]+$/g, '').trim()
}

function useIdentity() {
  return useQuery({
    queryKey: ['conversation-identity'],
    queryFn: () => api.get<{ config: IdentityConfig }>('/admin/conversation-identity'),
  })
}

export function OperatorIdentitySettings() {
  const { data, isLoading } = useIdentity()
  const qc = useQueryClient()
  const [cfg, setCfg] = useState<IdentityConfig>(PADRAO)

  useEffect(() => {
    if (data?.config) setCfg({ ...PADRAO, ...data.config })
  }, [data])

  const salvar = useMutation({
    mutationFn: (c: IdentityConfig) => api.put<{ ok: true }>('/admin/conversation-identity', c),
    onSuccess: () => {
      toast('Configuração salva', 'success')
      void qc.invalidateQueries({ queryKey: ['conversation-identity'] })
    },
    onError: (e: unknown) => toast((e as Error).message, 'danger'),
  })

  if (isLoading) return <Skeleton class="h-64 w-full" />

  const exemplo = cfg.incluirSetor ? '*Rafael · Suporte*' : '*Rafael*'

  return (
    <div class="space-y-6">
      <section class="rounded-lg border border-border bg-surface p-4">
        <header class="mb-3 flex items-center gap-2">
          <UserCircle size={16} class="text-fg-muted" />
          <h3 class="font-medium">Identificação do operador</h3>
        </header>
        <p class="mb-4 text-sm text-fg-muted">
          Mostra ao contato quem está falando com ele. Útil quando a empresa atende por um número
          único e genérico — do lado de lá, todas as mensagens parecem vir da mesma pessoa.
        </p>

        <label class="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            class="mt-0.5"
            checked={cfg.identificarOperador}
            onChange={(e) => setCfg({ ...cfg, identificarOperador: (e.target as HTMLInputElement).checked })}
          />
          <span>
            Identificar quem está atendendo
            <span class="block text-xs text-fg-subtle">
              O nome entra na primeira linha da mensagem — o WhatsApp não tem cabeçalho de remetente
              dentro da conversa.
            </span>
          </span>
        </label>

        {cfg.identificarOperador && (
          <div class="mt-4 space-y-4 border-l-2 border-border pl-4">
            <div>
              <label class="mb-1 block text-sm font-medium">Quando identificar</label>
              <Select
                value={cfg.identificarModo}
                onChange={(e) => setCfg({ ...cfg, identificarModo: (e.target as HTMLSelectElement).value as IdentityConfig['identificarModo'] })}
              >
                <option value="ao_mudar">Só quando o operador muda</option>
                <option value="sempre">Em todas as mensagens</option>
              </Select>
              <p class="mt-1 text-xs text-fg-subtle">
                {cfg.identificarModo === 'ao_mudar'
                  ? 'O nome aparece na primeira mensagem e sempre que outra pessoa assumir a conversa.'
                  : 'O nome aparece em toda mensagem enviada. Pode ficar repetitivo numa conversa longa com a mesma pessoa.'}
              </p>
            </div>

            <label class="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                class="mt-0.5"
                checked={cfg.incluirSetor}
                onChange={(e) => setCfg({ ...cfg, incluirSetor: (e.target as HTMLInputElement).checked })}
              />
              <span>Incluir o setor junto do nome</span>
            </label>

            <div class="rounded-md border border-border bg-surface-2 p-3">
              <div class="mb-1 text-xs font-medium text-fg-subtle">Como o contato vê</div>
              <div class="text-sm">
                <strong>{exemplo.replace(/\*/g, '')}</strong>
                <br />
                Bom dia! Já verifiquei aqui e consigo te ajudar com isso.
              </div>
            </div>

            <p class="text-xs text-fg-subtle">
              O nome exibido vem de <strong>Nome de exibição</strong>, no perfil de cada operador.
              Sem ele, usa o primeiro nome do cadastro. Áudios e figurinhas não são identificados —
              não têm legenda onde escrever.
            </p>
          </div>
        )}
      </section>

      <section class="rounded-lg border border-border bg-surface p-4">
        <h3 class="mb-3 font-medium">Aviso de transferência</h3>
        <label class="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            class="mt-0.5"
            checked={cfg.avisarTransferencia}
            onChange={(e) => setCfg({ ...cfg, avisarTransferencia: (e.target as HTMLInputElement).checked })}
          />
          <span>
            Avisar o contato quando outra pessoa assumir a conversa
            <span class="block text-xs text-fg-subtle">
              Enviado só em conversa já em andamento e dentro do horário de atendimento. Atribuir um
              lead novo da fila não dispara aviso.
            </span>
          </span>
        </label>

        {cfg.avisarTransferencia && (
          <div class="mt-4 border-l-2 border-border pl-4">
            <label class="mb-1 block text-sm font-medium">Como identificar quem assumiu</label>
            <Select
              value={cfg.avisarTransferenciaModo}
              onChange={(e) => setCfg({ ...cfg, avisarTransferenciaModo: (e.target as HTMLSelectElement).value as IdentityConfig['avisarTransferenciaModo'] })}
            >
              <option value="agente">Só o nome de quem vai atender</option>
              <option value="agente_setor">Nome e equipe</option>
              <option value="setor">Só a equipe (sem expor o nome)</option>
            </Select>
            <p class="mb-3 mt-1 text-xs text-fg-subtle">
              {cfg.avisarTransferenciaModo === 'setor'
                ? 'Nenhum nome de operador é enviado ao contato — útil em operação com muita gente ou quando a relação é com a empresa, não com a pessoa.'
                : cfg.avisarTransferenciaModo === 'agente'
                  ? 'A equipe não é mencionada. Bom para consultório e atendimento consultivo, onde a relação é com a pessoa.'
                  : 'Nome e equipe juntos. Se o operador não estiver em equipe nenhuma, sai só o nome.'}
            </p>

            <label class="mb-1 block text-sm font-medium">Texto do aviso</label>
            <Textarea
              rows={2}
              value={cfg.avisarTransferenciaTexto}
              onInput={(e) => setCfg({ ...cfg, avisarTransferenciaTexto: (e.target as HTMLTextAreaElement).value })}
            />
            <p class="mt-1 text-xs text-fg-subtle">
              <code>{'{quem}'}</code> preenche conforme a opção acima. Para controle fino, use
              <code>{' {agente}'}</code> e <code>{'{setor}'}</code> — quando o operador não tem
              equipe, o trecho do setor sai da frase sem deixar vírgula solta.
            </p>

            <div class="mt-3 rounded-md border border-border bg-surface-2 p-3">
              <div class="mb-1 text-xs uppercase tracking-wider text-fg-subtle">Como o contato vê</div>
              <div class="rounded-md bg-surface p-3 text-sm">{previewAviso(cfg)}</div>
            </div>

            <div class="mt-2">
              <div class="mb-1 text-xs text-fg-subtle">Sugestões:</div>
              <div class="flex flex-wrap gap-1.5">
                {[
                  ['Padrão', '{quem} vai continuar o seu atendimento a partir de agora. Todo o histórico da conversa já foi repassado.'],
                  ['Curto', 'A partir de agora, quem continua o seu atendimento é {quem}.'],
                  ['Formal', 'Informamos que o seu atendimento foi transferido para {quem}. Todo o histórico da conversa já está disponível.'],
                  ['Cordial', 'A partir de agora {quem} segue com você por aqui — já passamos tudo o que conversamos até agora.'],
                ].map(([nome, txt]) => (
                  <button
                    key={nome}
                    type="button"
                    class="rounded-md border border-border px-2 py-1 text-xs text-fg-muted hover:bg-surface-3 hover:text-fg"
                    onClick={() => setCfg({ ...cfg, avisarTransferenciaTexto: txt! })}
                  >
                    {nome}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      <div class="flex justify-end">
        <Button variant="primary" size="md" onClick={() => salvar.mutate(cfg)} disabled={salvar.isPending}>
          <Save size={14} />
          {salvar.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </div>
  )
}
