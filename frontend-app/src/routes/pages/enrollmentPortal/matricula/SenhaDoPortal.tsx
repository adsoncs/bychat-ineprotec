// Senha do portal do aluno, pela equipe (inscrição › Portal do candidato).
//
// Duas saídas, as duas registradas na timeline do lead com quem fez:
//   - "Enviar link de nova senha": a pessoa recebe um link e cria a senha dela;
//   - "Definir senha": a equipe digita (ou gera) uma senha forte e, se quiser,
//     manda usuário + senha ao aluno por WhatsApp ou e-mail.
import { useState } from 'preact/hooks'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import { formatRelative } from '@/lib/format'
import { Copy, Eye, EyeOff, KeyRound, RefreshCw, Send } from '@/components/ui/icon-set'

type Acesso = {
  temConta: boolean; temSenha: boolean; senhaDefinidaEm: string | null; ultimoLoginEm: string | null
  bloqueadoAte: string | null; ativo: boolean; usuario: 'cpf' | 'email' | null; temWhatsapp: boolean; temEmail: boolean
}
type Canal = 'auto' | 'whatsapp' | 'email'
const NOME_CANAL: Record<string, string> = { whatsapp: 'WhatsApp', email: 'e-mail' }

/** Mesma regra do servidor (validarSenhaForte). */
export function problemaDaSenha(s: string): string | null {
  if (s.length < 10) return 'Ao menos 10 caracteres.'
  if (s.length > 72) return 'No máximo 72 caracteres.'
  if (/\s/.test(s)) return 'Sem espaços.'
  if (!/[a-z]/.test(s) || !/[A-Z]/.test(s)) return 'Use maiúsculas e minúsculas.'
  if (!/[0-9]/.test(s)) return 'Use ao menos um número.'
  if (!/[^A-Za-z0-9]/.test(s)) return 'Use ao menos um símbolo (! @ # $ %).'
  return null
}

/** Senha forte e fácil de ditar: sem 0/O, 1/l/I, e com símbolos comuns. */
export function gerarSenhaForte(tamanho = 12): string {
  const grupos = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%&*?']
  const todos = grupos.join('')
  const rnd = (n: number) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0]! % n }
  const chars = grupos.map((g) => g[rnd(g.length)]!)
  while (chars.length < tamanho) chars.push(todos[rnd(todos.length)]!)
  for (let i = chars.length - 1; i > 0; i--) { const j = rnd(i + 1); [chars[i], chars[j]] = [chars[j]!, chars[i]!] }
  return chars.join('')
}

function SeletorDeCanal({ valor, muda, acesso }: { valor: Canal; muda: (c: Canal) => void; acesso: Acesso | undefined }) {
  return (
    <Select label="Enviar por" value={valor} onChange={(e) => muda((e.target as HTMLSelectElement).value as Canal)}>
      <option value="auto">WhatsApp (se falhar, e-mail)</option>
      <option value="whatsapp" disabled={acesso && !acesso.temWhatsapp}>Só WhatsApp{acesso && !acesso.temWhatsapp ? ' — sem número' : ''}</option>
      <option value="email" disabled={acesso && !acesso.temEmail}>Só e-mail{acesso && !acesso.temEmail ? ' — sem e-mail' : ''}</option>
    </Select>
  )
}

export function SenhaDoPortal({ leadId }: { leadId: number }) {
  const qc = useQueryClient()
  const chave = ['portal-acesso', leadId]
  const { data: acesso } = useQuery({
    queryKey: chave,
    queryFn: () => api.get<Acesso>(`/admin/portal-accounts/${leadId}/acesso`),
    staleTime: 30_000,
  })
  const [modal, setModal] = useState<null | 'link' | 'senha'>(null)

  const situacao = !acesso ? 'Carregando…'
    : !acesso.temConta ? 'Ainda não tem conta no portal (é criada ao gerar link ou senha).'
      : !acesso.temSenha ? 'Conta sem senha: entra só por link.'
        : `Senha definida ${acesso.senhaDefinidaEm ? formatRelative(acesso.senhaDefinidaEm) : ''}` +
          `${acesso.ultimoLoginEm ? ` · último acesso ${formatRelative(acesso.ultimoLoginEm)}` : ' · nunca entrou com senha'}`

  return (
    <div class="mt-3 pt-3 border-t border-border flex items-center justify-between gap-3 flex-wrap">
      <div class="min-w-0">
        <div class="text-xs font-medium text-fg">Senha do portal</div>
        <div class="text-2xs text-fg-muted">
          {situacao}
          {acesso?.bloqueadoAte && <span class="text-warning"> · bloqueada por tentativas até {new Date(acesso.bloqueadoAte).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} (definir senha desbloqueia)</span>}
        </div>
      </div>
      <div class="flex gap-2 shrink-0 flex-wrap">
        <Button variant="secondary" size="sm" onClick={() => setModal('link')} disabled={acesso && !acesso.temWhatsapp && !acesso.temEmail}>
          <Send size={12} /> Enviar link de nova senha
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setModal('senha')}>
          <KeyRound size={12} /> Definir senha
        </Button>
      </div>
      {modal === 'link' && <EnviarLinkModal leadId={leadId} acesso={acesso} onClose={() => { setModal(null); void qc.invalidateQueries({ queryKey: chave }) }} />}
      {modal === 'senha' && <DefinirSenhaModal leadId={leadId} acesso={acesso} onClose={() => { setModal(null); void qc.invalidateQueries({ queryKey: chave }) }} />}
    </div>
  )
}

function EnviarLinkModal({ leadId, acesso, onClose }: { leadId: number; acesso: Acesso | undefined; onClose: () => void }) {
  const [canal, setCanal] = useState<Canal>('auto')
  const [enviando, setEnviando] = useState(false)
  async function enviar() {
    setEnviando(true)
    try {
      const r = await api.post<{ enviadoPor: string; falhas: string[] }>(`/admin/portal-accounts/${leadId}/enviar-nova-senha`, { canal })
      toast(`Link de nova senha enviado por ${NOME_CANAL[r.enviadoPor] ?? r.enviadoPor}${r.falhas.length ? ` (${r.falhas.join(' · ')})` : ''}`, 'success')
      onClose()
    } catch (e) {
      toast((e as Error).message, 'danger')
    } finally { setEnviando(false) }
  }
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title="Enviar link de nova senha" size="sm"
      footer={<>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={enviando}>Cancelar</Button>
        <Button variant="primary" size="sm" onClick={enviar} disabled={enviando}><Send size={12} /> {enviando ? 'Enviando…' : 'Enviar'}</Button>
      </>}
    >
      <div class="space-y-3">
        <p class="text-sm text-fg-muted">O aluno recebe um link que vale uma vez e abre a tela para ele criar a senha nova. A senha atual continua valendo até ele trocar.</p>
        <SeletorDeCanal valor={canal} muda={setCanal} acesso={acesso} />
        <p class="text-2xs text-fg-muted">Na API Oficial do WhatsApp, texto livre só chega se o aluno escreveu nas últimas 24 horas. Fora disso, prefira o e-mail.</p>
      </div>
    </Modal>
  )
}

function DefinirSenhaModal({ leadId, acesso, onClose }: { leadId: number; acesso: Acesso | undefined; onClose: () => void }) {
  const [senha, setSenha] = useState(() => gerarSenhaForte())
  const [ver, setVer] = useState(true)
  const [enviar, setEnviar] = useState(true)
  const [canal, setCanal] = useState<Canal>('auto')
  const [salvando, setSalvando] = useState(false)
  const [feito, setFeito] = useState<{ usuario: string; enviadoPor: string | null; falhas: string[] } | null>(null)
  const problema = problemaDaSenha(senha)
  const semCanal = acesso && !acesso.temWhatsapp && !acesso.temEmail

  function copiar(t: string, rotulo: string) {
    void navigator.clipboard.writeText(t).then(() => toast(`${rotulo} copiado`, 'success')).catch(() => toast('Não foi possível copiar', 'warning'))
  }

  async function salvar() {
    if (problema) return
    if (acesso?.temSenha && !confirm('Trocar a senha atual? O aluno sai de todas as sessões abertas e passa a entrar com a senha nova.')) return
    setSalvando(true)
    try {
      const r = await api.post<{ usuario: string; enviadoPor: string | null; falhas: string[] }>(
        `/admin/portal-accounts/${leadId}/senha`, { senha, enviar: enviar && !semCanal, canal },
      )
      setFeito(r)
      if (enviar && !r.enviadoPor) toast('Senha definida, mas o envio falhou — copie e mande por outro caminho.', 'warning')
      else toast(r.enviadoPor ? `Senha definida e enviada por ${NOME_CANAL[r.enviadoPor]}` : 'Senha definida', 'success')
    } catch (e) {
      toast((e as Error).message, 'danger')
    } finally { setSalvando(false) }
  }

  if (feito) {
    return (
      <Modal open onOpenChange={(o) => { if (!o) onClose() }} title="Senha definida" size="sm"
        footer={<Button variant="primary" size="sm" onClick={onClose}>Fechar</Button>}>
        <div class="space-y-3 text-sm">
          <div class="rounded-md border border-border bg-surface p-3 space-y-1">
            <div>Usuário: <strong>{feito.usuario || '—'}</strong> <span class="text-2xs text-fg-muted">(CPF ou e-mail)</span></div>
            <div class="flex items-center gap-2">Senha: <code class="text-sm">{senha}</code>
              <Button variant="ghost" size="sm" onClick={() => copiar(senha, 'Senha')}><Copy size={12} /></Button>
            </div>
          </div>
          {feito.enviadoPor
            ? <p class="text-success">Enviada ao aluno por {NOME_CANAL[feito.enviadoPor]}.</p>
            : enviar ? <p class="text-warning">O envio falhou: {feito.falhas.join(' · ') || 'sem detalhe'}. Copie e mande pela conversa.</p>
              : <p class="text-fg-muted">Não foi enviada. Copie e entregue ao aluno.</p>}
          <p class="text-2xs text-fg-muted">Esta é a única vez que a senha aparece: ela não fica guardada em lugar nenhum.</p>
        </div>
      </Modal>
    )
  }

  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title="Definir senha do portal" size="sm"
      footer={<>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={salvando}>Cancelar</Button>
        <Button variant="primary" size="sm" onClick={salvar} disabled={salvando || !!problema}>
          <KeyRound size={12} /> {salvando ? 'Salvando…' : enviar && !semCanal ? 'Definir e enviar' : 'Definir senha'}
        </Button>
      </>}
    >
      <div class="space-y-3">
        <div class="flex gap-2 items-end">
          <div class="flex-1">
            <Input label="Nova senha" type={ver ? 'text' : 'password'} value={senha} autoComplete="new-password"
              onInput={(e) => setSenha((e.target as HTMLInputElement).value)} error={problema ?? undefined} />
          </div>
          <Button variant="ghost" size="sm" onClick={() => setVer(!ver)} title={ver ? 'Esconder' : 'Mostrar'}>{ver ? <EyeOff size={14} /> : <Eye size={14} />}</Button>
          <Button variant="secondary" size="sm" onClick={() => { setSenha(gerarSenhaForte()); setVer(true) }} title="Gerar outra senha forte"><RefreshCw size={12} /> Gerar</Button>
        </div>
        <div class={`text-2xs ${problema ? 'text-danger' : 'text-success'}`}>
          {problema ?? 'Senha forte.'} <span class="text-fg-muted">Regra: 10+ caracteres, maiúscula, minúscula, número e símbolo.</span>
        </div>
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enviar && !semCanal} disabled={semCanal} onChange={(e) => setEnviar((e.target as HTMLInputElement).checked)} />
          Enviar usuário e senha ao aluno {semCanal && <span class="text-2xs text-fg-muted">(contato sem WhatsApp e sem e-mail)</span>}
        </label>
        {enviar && !semCanal && <SeletorDeCanal valor={canal} muda={setCanal} acesso={acesso} />}
        <p class="text-2xs text-fg-muted">
          A senha atual deixa de valer e o aluno sai das sessões abertas. Fica registrado na ficha quem definiu e quando; a senha não é guardada.
          {acesso?.usuario === null && ' Atenção: a conta não tem CPF nem e-mail para servir de usuário.'}
        </p>
      </div>
    </Modal>
  )
}
