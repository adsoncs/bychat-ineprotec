import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { env } from '@/lib/env'

const base = '/admin/aca/censo'

export interface Inconsistencia { matriculaId: number; nome: string; ra: string; curso: string; problemas: string[]; justificada: boolean }
export interface Validacao { total: number; comInconsistencia: number; pendentes: number; inconsistencias: Inconsistencia[] }
export interface EnadeCurso { curso: string; ingressantes: number; concluintes: number }
export interface EnadePreview { ano: number; totalIngressantes: number; totalConcluintes: number; porCurso: EnadeCurso[]; amostra: { ingressantes: any[]; concluintes: any[] } }
export interface Justificativa { id: number; matriculaId: number; anoBase: number; motivo: string }

export const useAnosCenso = () => useQuery({ queryKey: ['aca-censo-anos'], queryFn: () => api.get<{ anos: number[] }>(`${base}/anos`), staleTime: 60_000 })
export const useValidacaoCenso = (anoBase: number | null) =>
  useQuery({ queryKey: ['aca-censo-val', anoBase], queryFn: () => api.get<Validacao>(`${base}/validacao${anoBase ? `?anoBase=${anoBase}` : ''}`), staleTime: 5_000 })
export const useEnade = (ano: number | null) =>
  useQuery({ queryKey: ['aca-censo-enade', ano], queryFn: () => api.get<EnadePreview>(`${base}/enade?ano=${ano}`), enabled: ano !== null, staleTime: 5_000 })

export function useCensoMut() {
  const qc = useQueryClient()
  return {
    justificar: useMutation({ mutationFn: (b: { matriculaId: number; anoBase: number; motivo: string }) => api.post(`${base}/justificativas`, b), onSuccess: () => qc.invalidateQueries({ queryKey: ['aca-censo-val'] }) }),
  }
}

export async function baixarCensoCsv(path: string, nome: string) {
  const token = (() => { try { return localStorage.getItem(env.authTokenKey) } catch { return null } })()
  const res = await fetch(`${env.apiBase}${base}/${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) throw new Error('Falha ao exportar')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = nome; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
