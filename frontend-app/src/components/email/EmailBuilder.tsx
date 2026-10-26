import { useEffect, useRef, useState } from 'preact/hooks'
import * as Dialog from '@radix-ui/react-dialog'
import { api } from '@/lib/apiClient'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'

/**
 * Editor de e-mail de arrastar e soltar (GrapesJS + MJML), em tela cheia.
 *
 * MJML porque e-mail não é página web: Outlook e Gmail ignoram metade do CSS
 * moderno, e o MJML compila para a tabela aninhada que todos entendem — e já
 * sai responsivo. O GrapesJS e o compilador pesam ~1 MB, por isso só carregam
 * quando alguém abre o editor.
 *
 * Devolve o HTML compilado (é o que sai no e-mail) e o projeto do editor (é o
 * que permite reabrir e continuar editando).
 */

export interface ResultadoDoEditor { html: string; projeto: unknown }

/** O plugin MJML só tem os nomes dos blocos em inglês. */
const BLOCOS_PT: Record<string, string> = {
  '1 Column': '1 coluna', '2 Columns': '2 colunas', '3 Columns': '3 colunas', Text: 'Texto', Button: 'Botão',
  Image: 'Imagem', Divider: 'Divisor', 'Group Social': 'Redes sociais', 'Social Element': 'Rede social',
  Spacer: 'Espaço', Navbar: 'Menu', 'Navbar Link': 'Item do menu', Hero: 'Destaque', Wrapper: 'Grupo', Raw: 'HTML',
}

const MJML_INICIAL = `<mjml>
  <mj-body background-color="#f4f5f7">
    <mj-section background-color="#ffffff" padding="24px 24px 8px">
      <mj-column>
        <mj-text font-size="22px" font-weight="700" color="#111827">Olá, {{nome}}!</mj-text>
        <mj-text font-size="15px" line-height="1.6" color="#374151">Escreva aqui a sua mensagem. Arraste blocos do painel à direita para montar o e-mail: imagens, botões, colunas, divisores.</mj-text>
        <mj-button background-color="#1a73e8" color="#ffffff" border-radius="6px" href="https://">Quero saber mais</mj-button>
      </mj-column>
    </mj-section>
    <mj-section padding="16px 24px">
      <mj-column>
        <mj-text font-size="12px" color="#6b7280" align="center">Você recebeu este e-mail porque tem contato conosco.</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`

export function EmailBuilder({
  projeto, assunto, varKeys, onSalvar, onFechar,
}: {
  projeto: unknown | null
  assunto: string
  varKeys: string[]
  onSalvar: (r: ResultadoDoEditor) => void
  onFechar: () => void
}) {
  const alvo = useRef<HTMLDivElement>(null)
  const editorRef = useRef<any>(null)
  const rteAtivo = useRef<any>(null)
  const [pronto, setPronto] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aparelho, setAparelho] = useState<'desktop' | 'celular'>('desktop')
  const [testeAberto, setTesteAberto] = useState(false)
  const [destino, setDestino] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const [{ default: grapesjs }, { default: mjml }, { default: pt }] = await Promise.all([
          import('grapesjs'), import('grapesjs-mjml'), import('grapesjs/locale/pt'),
        ])
        await import('grapesjs/dist/css/grapes.min.css')
        if (!vivo || !alvo.current) return
        const editor = grapesjs.init({
          container: alvo.current,
          height: '100%',
          storageManager: false,
          fromElement: false,
          plugins: [mjml],
          i18n: { locale: 'pt', detectLocale: false, messages: { pt } },
          assetManager: {
            // Imagem de e-mail precisa de URL pública absoluta — o upload do
            // atendimento devolve exatamente isso (APP_URL/uploads/...).
            uploadFile: async (ev: any) => {
              const arquivos: File[] = Array.from(ev.dataTransfer ? ev.dataTransfer.files : ev.target.files)
              for (const f of arquivos) {
                if (!f.type.startsWith('image/')) { toast(`${f.name}: só imagens`, 'danger'); continue }
                const fd = new FormData()
                fd.append('file', f)
                try {
                  const r = await api.post<{ url: string }>('/atendimento/upload', fd)
                  editorRef.current?.AssetManager.add({ src: r.url, name: f.name })
                } catch (e) { toast((e as Error).message, 'danger') }
              }
            },
          },
          ...(projeto ? { projectData: projeto as any } : { components: MJML_INICIAL }),
        })
        editor.Blocks.getAll().forEach((b: any) => { const pt = BLOCOS_PT[b.get('label')]; if (pt) b.set('label', pt) })
        editor.on('rte:enable', (_v: unknown, rte: unknown) => { rteAtivo.current = rte })
        editor.on('rte:disable', () => { rteAtivo.current = null })
        editorRef.current = editor
        setPronto(true)
      } catch (e) {
        setErro((e as Error).message || 'Não foi possível abrir o editor')
      }
    })()
    return () => { vivo = false; editorRef.current?.destroy(); editorRef.current = null }
  }, [])

  function trocarAparelho(a: 'desktop' | 'celular') {
    const ed = editorRef.current
    if (!ed) return
    const nomes: string[] = ed.Devices.getAll().map((d: any) => d.get('name') || d.id)
    const nome = a === 'celular' ? (nomes.find((n) => /portrait/i.test(n)) ?? nomes.find((n) => /mobile/i.test(n))) : nomes[0]
    if (nome) ed.setDevice(nome)
    setAparelho(a)
  }

  function inserirVariavel(chave: string) {
    if (!chave) return
    if (rteAtivo.current?.insertHTML) rteAtivo.current.insertHTML(`{{${chave}}}`)
    else toast('Clique dentro de um texto do e-mail e escolha a variável de novo.', 'warning')
  }

  /**
   * Fecha a edição de texto em andamento. Sem isto, o que foi digitado por
   * último ainda está só no navegador (o GrapesJS grava no modelo ao sair do
   * texto) e "Aplicar" levaria a versão anterior. Desselecionar NÃO encerra.
   */
  async function encerrarEdicao() {
    const editando = editorRef.current?.getEditing()
    const view = editando?.getView?.() ?? editando?.view
    if (view?.disableEditing) await view.disableEditing()
  }

  /** HTML final: o MJML compilado. Erro de MJML vira aviso, não perda do trabalho. */
  async function compilar(): Promise<string | null> {
    const ed = editorRef.current
    if (!ed) return null
    await encerrarEdicao()
    const r = ed.runCommand('mjml-code-to-html') as { html?: string; errors?: Array<{ formattedMessage?: string }> } | undefined
    if (!r?.html) { toast('Não foi possível gerar o HTML do e-mail.', 'danger'); return null }
    if (r.errors?.length) console.warn('[EmailBuilder] avisos do MJML:', r.errors.map((e) => e.formattedMessage))
    return r.html
  }

  async function salvar() {
    const html = await compilar()
    if (!html) return
    onSalvar({ html, projeto: editorRef.current.getProjectData() })
  }

  async function enviarTeste() {
    const html = await compilar()
    if (!html) return
    setEnviando(true)
    try {
      await api.post('/templates/test-email', { to: destino.trim(), subject: assunto, html })
      toast(`Teste enviado para ${destino.trim()}`, 'success')
      setTesteAberto(false)
    } catch (e) { toast((e as Error).message, 'danger') }
    setEnviando(false)
  }

  const pedirFechar = () => { if (confirm('Fechar sem aplicar as alterações?')) onFechar() }

  // Janela Radix própria, aninhada à do modelo: com um portal comum, o
  // conteúdo ficava preso à caixa do modal (que tem transform) e o clique no
  // editor contava como "fora" do modal do modelo — que fechava e levava o
  // trabalho junto. Aninhada, o Radix sabe que a de cima é a ativa.
  // Clique fora e Esc NÃO fecham: o seletor de cor do GrapesJS abre fora daqui.
  return (
    <Dialog.Root open onOpenChange={(aberto) => { if (!aberto) pedirFechar() }}>
    <Dialog.Portal>
    <Dialog.Content
      class="fixed inset-0 flex flex-col bg-surface outline-none" style={{ zIndex: 1000 }} aria-describedby={undefined}
      onPointerDownOutside={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
      <Dialog.Title class="sr-only">Editor de e-mail</Dialog.Title>
      <div class="flex flex-col h-full" aria-label="Editor de e-mail">
      <div class="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border bg-surface">
        <strong class="text-sm mr-2">Editor de e-mail</strong>
        <div class="inline-flex rounded-md border border-border bg-surface-2 p-0.5" role="group" aria-label="Visualizar como">
          {(['desktop', 'celular'] as const).map((a) => (
            <button key={a} type="button" disabled={!pronto} onClick={() => trocarAparelho(a)} aria-pressed={aparelho === a}
              class={`h-7 px-3 text-xs rounded ${aparelho === a ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg'}`}>
              {a === 'desktop' ? 'Computador' : 'Celular'}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" disabled={!pronto} onClick={() => editorRef.current?.UndoManager.undo()}>Desfazer</Button>
        <Button variant="ghost" size="sm" disabled={!pronto} onClick={() => editorRef.current?.UndoManager.redo()}>Refazer</Button>
        <label class="flex items-center gap-1.5 text-xs text-fg-muted">
          Variável
          {/* A seleção dentro do iframe do editor sobrevive ao foco ir para cá. */}
          <select class="h-7 rounded-md border border-border bg-surface px-2 text-xs text-fg" disabled={!pronto}
            onChange={(e) => { inserirVariavel((e.target as HTMLSelectElement).value); (e.target as HTMLSelectElement).value = '' }}>
            <option value="">inserir…</option>
            {varKeys.map((k) => <option key={k} value={k}>{`{{${k}}}`}</option>)}
          </select>
        </label>
        <div class="ml-auto flex items-center gap-2">
          {testeAberto ? (
            <form class="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); void enviarTeste() }}>
              <input type="email" required value={destino} placeholder="seu@email.com" aria-label="Enviar teste para"
                onInput={(e) => setDestino((e.target as HTMLInputElement).value)}
                class="h-8 w-52 rounded-md border border-border bg-surface px-2 text-sm" />
              <Button size="sm" type="submit" disabled={enviando || !destino.trim()}>{enviando ? 'Enviando…' : 'Enviar'}</Button>
              <Button size="sm" variant="ghost" type="button" onClick={() => setTesteAberto(false)}>×</Button>
            </form>
          ) : (
            <Button variant="secondary" size="sm" disabled={!pronto} onClick={() => setTesteAberto(true)}>Enviar teste</Button>
          )}
          <Button variant="ghost" size="sm" onClick={pedirFechar}>Cancelar</Button>
          <Button size="sm" disabled={!pronto} onClick={() => void salvar()}>Aplicar ao modelo</Button>
        </div>
      </div>
      <div class="relative flex-1 min-h-0">
        {!pronto && !erro && <div class="absolute inset-0 grid place-items-center text-sm text-fg-muted">Carregando o editor…</div>}
        {erro && <div class="absolute inset-0 grid place-items-center text-sm text-danger">{erro}</div>}
        <div ref={alvo} class="h-full" />
      </div>
    </div>
    </Dialog.Content>
    </Dialog.Portal>
    </Dialog.Root>
  )
}
