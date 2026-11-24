// Exportar com escolha de formato (Excel / PDF / CSV). A rota recebe
// ?formato=xlsx|pdf|csv e devolve os mesmos dados (backend lib/exportarTabela.ts).
// O último formato escolhido fica lembrado no navegador.
import { useState } from 'preact/hooks'
import { Button } from '@/components/ui/Button'
import { Download } from '@/components/ui/icon-set'
import { baixarCsv } from '@/lib/baixarCsv'
import { toast } from '@/lib/toast'

type Formato = 'xlsx' | 'pdf' | 'csv'
const ROTULO: Record<Formato, string> = { xlsx: 'Excel', pdf: 'PDF', csv: 'CSV' }
const CHAVE = 'exportar:formato:v1'

function lembrado(): Formato {
  try { const v = localStorage.getItem(CHAVE); return v === 'pdf' || v === 'csv' || v === 'xlsx' ? v : 'xlsx' } catch { return 'xlsx' }
}

/** `url`: caminho da API (com a query dos filtros); `nome`: arquivo sem extensão. */
export function ExportarDados({ url, nome, rotulo = 'Exportar' }: { url: string; nome: string; rotulo?: string }) {
  const [formato, setFormato] = useState<Formato>(lembrado)
  const [baixando, setBaixando] = useState(false)
  const escolher = (f: Formato) => { setFormato(f); try { localStorage.setItem(CHAVE, f) } catch { /* sem storage */ } }
  const baixar = async () => {
    setBaixando(true)
    try {
      await baixarCsv(`${url}${url.includes('?') ? '&' : '?'}formato=${formato}`, `${nome}.${formato}`)
    } catch (e) {
      toast((e as Error).message, 'danger')
    } finally {
      setBaixando(false)
    }
  }
  return (
    <div class="inline-flex items-stretch rounded-md border border-border overflow-hidden">
      <select
        class="h-8 bg-surface px-2 text-xs text-fg border-r border-border"
        value={formato}
        onChange={(e) => escolher((e.target as HTMLSelectElement).value as Formato)}
        aria-label="Formato da exportação"
      >
        {(Object.keys(ROTULO) as Formato[]).map((f) => <option key={f} value={f}>{ROTULO[f]}</option>)}
      </select>
      <Button variant="secondary" size="sm" class="rounded-none border-0" disabled={baixando} onClick={() => void baixar()}>
        <Download size={13} /> {baixando ? 'Gerando…' : rotulo}
      </Button>
    </div>
  )
}
