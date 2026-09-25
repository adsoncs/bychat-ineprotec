import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

// Importação de dados na virada de sistema: disciplinas, alunos, histórico e
// títulos em aberto. Sempre em duas etapas — analisar (dry-run) e só então
// executar —, porque importar errado num cadastro que já tem gente dentro custa
// mais caro do que qualquer atraso na conferência.
//
// Vivia dentro de useAcaProva.ts; ficou de pé sozinha quando a prova online saiu.

export interface ErroLinha { linha: number; campo?: string; valor?: string; mensagem: string }

export interface ResultadoAnalise {
  tipo: string
  totalLinhas: number
  validas: number
  invalidas: number
  duplicadas: number
  erros: ErroLinha[]
  amostra: Record<string, unknown>[]
  simulacao: boolean
}

export const TIPOS_IMPORT = [
  { id: 'disciplinas', label: 'Disciplinas', ajuda: 'Catálogo de disciplinas do curso.' },
  { id: 'alunos', label: 'Alunos', ajuda: 'Cadastro básico + vínculo. Valida CPF e data de nascimento.' },
  { id: 'notas_historico', label: 'Notas do histórico', ajuda: 'Histórico do sistema legado, para o aluno não perder o que já cursou.' },
  { id: 'titulos', label: 'Títulos financeiros', ajuda: 'Parcelas em aberto na migração.' },
]

export function useImportacao() {
  return {
    analisar: useMutation({
      mutationFn: (b: { tipo: string; csv: string }) => api.post<ResultadoAnalise>('/admin/aca/importacao/analisar', b),
    }),
    executar: useMutation({
      mutationFn: (b: { tipo: string; csv: string }) =>
        api.post<ResultadoAnalise & { gravadas: number; puladas: number }>('/admin/aca/importacao/executar', { ...b, confirmado: true }),
    }),
  }
}
