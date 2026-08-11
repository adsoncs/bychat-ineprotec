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
  avisarTransferenciaTexto: string
}

const PADRAO: IdentityConfig = {
  identificarOperador: false,
  identificarModo: 'ao_mudar',
  incluirSetor: true,
  avisarTransferencia: false,
  avisarTransferenciaTexto: 'Você agora está sendo atendido por {agente}, do setor {setor}.',
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
            <label class="mb-1 block text-sm font-medium">Texto do aviso</label>
            <Textarea
              rows={2}
              value={cfg.avisarTransferenciaTexto}
              onInput={(e) => setCfg({ ...cfg, avisarTransferenciaTexto: (e.target as HTMLTextAreaElement).value })}
            />
            <p class="mt-1 text-xs text-fg-subtle">
              Use <code>{'{agente}'}</code> e <code>{'{setor}'}</code>. Quando o operador não tem
              setor, o trecho do setor sai da frase automaticamente.
            </p>
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
