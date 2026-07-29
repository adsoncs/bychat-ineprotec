import { useState } from 'preact/hooks'
import { Upload, Download, PlayCircle, CheckCircle2, AlertTriangle, FileSpreadsheet } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Select, Textarea } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import { api } from '@/lib/apiClient'
import { useImportacao, TIPOS_IMPORT, type ResultadoAnalise } from '@/hooks/useAcaProva'

// Migração de sistema legado. A simulação não é conveniência: é ela que separa
// uma migração que dá certo de uma base inconsistente que ninguém consegue
// desfazer depois. Por isso "Importar" só habilita depois de simular.

export function AcademicoImportacaoPage() {
  const [tipo, setTipo] = useState('alunos')
  const [csv, setCsv] = useState('')
  const [analise, setAnalise] = useState<ResultadoAnalise | null>(null)
  const [resultado, setResultado] = useState<(ResultadoAnalise & { gravadas: number; puladas: number }) | null>(null)
  const mut = useImportacao()

  const tipoAtual = TIPOS_IMPORT.find((t) => t.id === tipo)
  // Trocar o tipo ou o conteúdo invalida a simulação — importar com base numa
  // análise de outro arquivo é exatamente o erro que este fluxo evita.
  const limpar = () => { setAnalise(null); setResultado(null) }

  const lerArquivo = (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return
    const fr = new FileReader()
    fr.onload = () => { setCsv(String(fr.result ?? '')); limpar() }
    fr.readAsText(file, 'utf-8')
  }

  const baixarModelo = async () => {
    try {
      const conteudo = await api.get<string>(`/admin/aca/importacao/modelo?tipo=${tipo}`)
      const blob = new Blob([String(conteudo)], { type: 'text/csv;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `modelo-${tipo}.csv`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (e: any) {
      toast(e?.message ?? 'Não foi possível baixar o modelo.', 'danger')
    }
  }

  const simular = () => {
    mut.analisar.mutate({ tipo, csv }, {
      onSuccess: (r) => { setAnalise(r); setResultado(null) },
      onError: (e: any) => toast(e?.message ?? 'Falha na simulação.', 'danger'),
    })
  }

  const importar = () => {
    mut.executar.mutate({ tipo, csv }, {
      onSuccess: (r) => { setResultado(r); toast(`${r.gravadas} registro(s) gravado(s).`, 'success') },
      onError: (e: any) => toast(e?.message ?? 'Falha na importação.', 'danger'),
    })
  }

  const rel = resultado ?? analise

  return (
    <Page
      title="Importação de dados"
      description="Migração do sistema legado com simulação obrigatória antes de gravar."
      actions={
        <Button variant="secondary" onClick={baixarModelo}>
          <Download size={16} /> Modelo CSV
        </Button>
      }
    >
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div class="lg:col-span-2 space-y-4">
          <Card class="space-y-3">
            <Select label="O que importar" value={tipo} onChange={(e) => { setTipo((e.target as HTMLSelectElement).value); limpar() }}>
              {TIPOS_IMPORT.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </Select>
            {tipoAtual?.ajuda && <p class="text-xs text-fg-subtle -mt-1">{tipoAtual.ajuda}</p>}

            <div>
              <label class="text-sm text-fg-muted block mb-1.5">Arquivo CSV</label>
              <input
                type="file" accept=".csv,text/csv"
                onChange={lerArquivo}
                class="block w-full text-sm text-fg-muted file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-border file:bg-surface-2 file:text-fg file:text-sm hover:file:bg-surface-3"
              />
              <p class="text-[11px] text-fg-subtle mt-1">Aceita separador <code>;</code> ou <code>,</code> — planilha brasileira usa os dois.</p>
            </div>

            <Textarea
              label="…ou cole o conteúdo" rows={8} value={csv}
              placeholder="nome;cpf;data_nascimento;…"
              onInput={(e) => { setCsv((e.target as HTMLTextAreaElement).value); limpar() }}
            />

            <div class="flex items-center gap-2">
              <Button onClick={simular} disabled={!csv.trim() || mut.analisar.isPending}>
                <PlayCircle size={16} /> Simular
              </Button>
              <Button
                variant="success"
                onClick={importar}
                disabled={!analise || analise.validas === 0 || mut.executar.isPending || !!resultado}
              >
                <Upload size={16} /> Importar {analise ? `${analise.validas} registro(s)` : ''}
              </Button>
            </div>
            {!analise && csv.trim() && (
              <p class="text-xs text-fg-subtle">Simule primeiro — a importação só habilita depois que você vir o relatório.</p>
            )}
          </Card>
        </div>

        <div class="space-y-4">
          {rel ? (
            <>
              <Card class="space-y-3">
                <h2 class="text-sm font-semibold text-fg flex items-center gap-2">
                  {resultado ? <CheckCircle2 size={15} class="text-success" /> : <PlayCircle size={15} />}
                  {resultado ? 'Importação concluída' : 'Resultado da simulação'}
                </h2>
                <div class="space-y-1.5 text-sm">
                  <div class="flex items-center justify-between">
                    <span class="text-fg-muted">Linhas no arquivo</span><span class="text-fg font-medium">{rel.totalLinhas}</span>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-fg-muted">Válidas</span><span class="text-success font-medium">{rel.validas}</span>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-fg-muted">Inválidas</span>
                    <span class={rel.invalidas > 0 ? 'text-danger font-medium' : 'text-fg'}>{rel.invalidas}</span>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-fg-muted">Já existentes</span><span class="text-fg-muted">{rel.duplicadas}</span>
                  </div>
                  {resultado && (
                    <>
                      <div class="flex items-center justify-between border-t border-border pt-1.5">
                        <span class="text-fg-muted">Gravadas</span><span class="text-success font-semibold">{resultado.gravadas}</span>
                      </div>
                      <div class="flex items-center justify-between">
                        <span class="text-fg-muted">Puladas</span><span class="text-fg-muted">{resultado.puladas}</span>
                      </div>
                    </>
                  )}
                </div>
                {!resultado && rel.invalidas > 0 && (
                  <p class="text-xs text-fg-muted border-t border-border pt-2">
                    As linhas inválidas são <strong class="text-fg">ignoradas</strong>, não corrigidas. Se elas
                    importam, ajuste o arquivo e simule de novo antes de gravar.
                  </p>
                )}
              </Card>

              {rel.erros.length > 0 && (
                <Card class="space-y-2">
                  <h2 class="text-sm font-semibold text-fg flex items-center gap-2">
                    <AlertTriangle size={15} class="text-danger" /> Erros por linha
                  </h2>
                  <div class="max-h-64 overflow-auto space-y-1.5">
                    {rel.erros.slice(0, 100).map((e, i) => (
                      <div key={i} class="text-xs flex gap-2">
                        <Badge tone="danger">L{e.linha}</Badge>
                        <span class="text-fg-muted flex-1">
                          {e.campo && <span class="text-fg-subtle">{e.campo}: </span>}
                          {e.mensagem}
                          {e.valor && <span class="text-fg-subtle"> ({e.valor})</span>}
                        </span>
                      </div>
                    ))}
                    {rel.erros.length > 100 && (
                      <p class="text-[11px] text-fg-subtle">…e mais {rel.erros.length - 100} erro(s).</p>
                    )}
                  </div>
                </Card>
              )}

              {!resultado && rel.amostra.length > 0 && (
                <Card class="space-y-2">
                  <h2 class="text-sm font-semibold text-fg flex items-center gap-2"><FileSpreadsheet size={15} /> Amostra do que será gravado</h2>
                  <div class="max-h-64 overflow-auto text-[11px] font-mono text-fg-muted space-y-1">
                    {rel.amostra.slice(0, 10).map((linha, i) => (
                      <div key={i} class="border-b border-border pb-1">
                        {Object.entries(linha).map(([k, v]) => (
                          <div key={k}><span class="text-fg-subtle">{k}:</span> {String(v ?? '—')}</div>
                        ))}
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </>
          ) : (
            <Card class="!p-4 text-xs text-fg-muted space-y-1.5">
              <div class="flex items-center gap-2 text-fg font-medium"><PlayCircle size={15} /> Por que simular antes</div>
              <p>
                A simulação valida linha a linha <strong class="text-fg">sem gravar nada</strong>: CPF, datas,
                referências que não existem e registros duplicados. É a única chance de ver o problema enquanto
                desfazer ainda é fácil.
              </p>
              <p>
                Data como <code>31/02/2005</code> é recusada aqui — em JavaScript ela viraria 3 de março
                silenciosamente, e o aluno chegaria à base com a data errada.
              </p>
            </Card>
          )}
        </div>
      </div>
    </Page>
  )
}
