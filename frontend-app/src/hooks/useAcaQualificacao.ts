import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

// Educação profissional: módulos com terminalidade, certificação intermediária
// e conformidade com o SISTEC.

export interface MatrizModulo {
  id: number
  matrizId: number
  numero: number
  nome: string
  tituloQualificacao: string | null
  codigoCbo: string | null
  cargaHoraria: number | null
  descricao: string | null
  _count?: { componentes: number }
}

export interface ModuloProgresso {
  moduloId: number
  numero: number
  nome: string
  tituloQualificacao: string | null
  codigoCbo: string | null
  temTerminalidade: boolean
  cargaHoraria: number
  componentes: number
  cumpridos: number
  pendentes: string[]
  concluido: boolean
  certificadoId: number | null
  certificadoNumero: string | null
}

export interface QualificacaoPendente {
  vinculoId: number
  nome: string
  ra: string | null
  situacao: string
  moduloId: number
  modulo: string
  titulo: string
  cargaHoraria: number
}

export const useModulosMatriz = (matrizId: number | null) =>
  useQuery({
    queryKey: ['aca-modulos', matrizId],
    queryFn: () => api.get<{ modulos: MatrizModulo[]; componentesSemModulo: number }>(`/admin/aca/matrizes/${matrizId}/modulos`),
    enabled: matrizId !== null,
    staleTime: 5_000,
  })

export const useModulosDoVinculo = (vinculoId: number | null) =>
  useQuery({
    queryKey: ['aca-modulos-vinculo', vinculoId],
    queryFn: () => api.get<{ modulos: ModuloProgresso[]; semModulos: boolean }>(`/admin/aca/vinculos/${vinculoId}/modulos`),
    enabled: vinculoId !== null,
    staleTime: 10_000,
  })

export const useQualificacoesAEmitir = (courseId?: number | null) =>
  useQuery({
    queryKey: ['aca-qualificacoes-emitir', courseId ?? null],
    // A fila varre vínculo por vínculo; staleTime maior evita recalcular a cada foco.
    queryFn: () => api.get<{ lista: QualificacaoPendente[]; total: number }>(
      `/admin/aca/qualificacoes/a-emitir${courseId ? `?courseId=${courseId}` : ''}`,
    ),
    staleTime: 60_000,
  })

export function useQualificacaoMut() {
  const qc = useQueryClient()
  const inval = () => {
    void qc.invalidateQueries({ queryKey: ['aca-qualificacoes-emitir'] })
    void qc.invalidateQueries({ queryKey: ['aca-modulos-vinculo'] })
    void qc.invalidateQueries({ queryKey: ['aca-modulos'] })
  }
  return {
    criarModulo: useMutation({
      mutationFn: ({ matrizId, ...b }: { matrizId: number } & Record<string, unknown>) =>
        api.post<{ modulo: MatrizModulo }>(`/admin/aca/matrizes/${matrizId}/modulos`, b),
      onSuccess: inval,
    }),
    editarModulo: useMutation({
      mutationFn: ({ id, ...b }: { id: number } & Record<string, unknown>) =>
        api.put<{ modulo: MatrizModulo }>(`/admin/aca/modulos/${id}`, b),
      onSuccess: inval,
    }),
    excluirModulo: useMutation({
      mutationFn: (id: number) => api.delete(`/admin/aca/modulos/${id}`),
      onSuccess: inval,
    }),
    vincularComponentes: useMutation({
      mutationFn: (b: { componenteIds: number[]; moduloId: number | null }) =>
        api.post<{ atualizados: number }>('/admin/aca/modulos/vincular-componentes', b),
      onSuccess: inval,
    }),
    emitir: useMutation({
      mutationFn: (b: { vinculoId: number; moduloId: number }) =>
        api.post<{ documento: { id: number; numero: string; titulo: string } }>('/admin/aca/qualificacoes/emitir', b),
      onSuccess: inval,
    }),
    emitirLote: useMutation({
      mutationFn: (itens: Array<{ vinculoId: number; moduloId: number }>) =>
        api.post<{ emitidos: number; erros: string[] }>('/admin/aca/qualificacoes/emitir-lote', { itens }),
      onSuccess: inval,
    }),
  }
}

// ─────────── Conformidade SISTEC ───────────

export interface ConformidadeSistec {
  prazo: {
    competencia: string
    limite: string
    diasRestantes: number
    vencido: boolean
    alerta: boolean
  }
  integralizandoEmFaseEscolar: {
    registrados: number
    aAjustar: Array<{ vinculoId: number; nome: string; ra: string | null; pendencias: string[] }>
  }
  pendencias: { alunosSemCpf: number; cursosTecnicosSemEixo: number }
  rotulos: Record<string, string>
}

export const useConformidadeSistec = () =>
  useQuery({
    queryKey: ['aca-sistec-conformidade'],
    queryFn: () => api.get<ConformidadeSistec>('/admin/aca/sistec/conformidade'),
    staleTime: 60_000,
  })

export function useSistecMut() {
  const qc = useQueryClient()
  return {
    aplicarIntegralizando: useMutation({
      mutationFn: (vinculoIds: number[]) =>
        api.post<{ ajustados: number; erros: string[] }>('/admin/aca/sistec/aplicar-integralizando', { vinculoIds }),
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: ['aca-sistec-conformidade'] })
        void qc.invalidateQueries({ queryKey: ['aca-vinculos'] })
      },
    }),
  }
}

// ── Conformidade lato sensu (Res. CNE/CES 1/2018) ─────────────────
//
// Vive aqui, junto da conformidade SISTEC, porque é a mesma pergunta da
// secretaria feita para outro nível de ensino: posso certificar este aluno?

export interface PendenciaLatoSensu {
  artigo: string
  descricao: string
  gravidade: 'impedimento' | 'atencao'
}

export interface CursoLatoSensu {
  courseId: number
  curso: string
  ehLatoSensu: boolean
  cargaHoraria: number | null
  chMinimaAtendida: boolean
  docentes: { total: number; strictoSensu: number; percentual: number; atende: boolean }
  atoCredenciamento: {
    tipo: string
    numero: string | null
    dataPublicacao: string | null
    dataDou: string | null
    validadeAte: string | null
    ehCredenciamento: boolean
  } | null
  pendencias: PendenciaLatoSensu[]
}

export function useConformidadeLatoSensu() {
  return useQuery({
    queryKey: ['aca', 'lato-sensu', 'conformidade'],
    queryFn: () => api.get<{
      cursos: CursoLatoSensu[]
      resumo?: { total: number; comImpedimento: number; comAtencao: number; semCursoLatoSensu: boolean }
    }>('/admin/aca/lato-sensu/conformidade'),
    staleTime: 60_000,
  })
}
