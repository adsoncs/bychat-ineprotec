import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { env } from '@/lib/env'

const base = '/admin/aca/diploma'

export interface DiplomaConfig { id: number; iesEmissora: string | null; cnpjEmissora: string | null; codigoMecEmissora: string | null; iesRegistradora: string | null; codigoMecRegistradora: string | null; reitor: string | null; secretario: string | null; provedorAssinatura: string | null; ativo: boolean }
export interface DiplomaItem { matriculaId: number; alunoNome: string; ra: string | null; dataConclusao: string | null; diplomaId: number | null; status: string | null; numero: string | null; codigoValidacao: string | null }

export const DIP_STATUS: Record<string, { label: string; tone: 'neutral' | 'info' | 'accent' | 'success' | 'danger' }> = {
  RASCUNHO: { label: 'Rascunho', tone: 'neutral' }, XML_GERADO: { label: 'XML gerado', tone: 'info' },
  ASSINADO: { label: 'Assinado', tone: 'accent' }, REGISTRADO: { label: 'Registrado', tone: 'success' }, ANULADO: { label: 'Anulado', tone: 'danger' },
}

export const useDiplomaConfig = () => useQuery({ queryKey: ['aca-dip-cfg'], queryFn: () => api.get<{ config: DiplomaConfig | null }>(`${base}/config`), staleTime: 30_000 })
export const useDiplomas = () => useQuery({ queryKey: ['aca-dip'], queryFn: () => api.get<{ itens: DiplomaItem[] }>(`${base}/diplomas`), staleTime: 3_000 })

export function useDiplomaMut() {
  const qc = useQueryClient()
  const inval = () => { void qc.invalidateQueries({ queryKey: ['aca-dip'] }); void qc.invalidateQueries({ queryKey: ['aca-dip-cfg'] }) }
  const act = (path: string) => useMutation({ mutationFn: (b: any) => api.post(`${base}/diplomas/${b.id}/${path}`, b), onSuccess: inval })
  return {
    salvarConfig: useMutation({ mutationFn: (b: any) => api.put(`${base}/config`, b), onSuccess: inval }),
    criar: useMutation({ mutationFn: (matriculaId: number) => api.post(`${base}/diplomas`, { matriculaId }), onSuccess: inval }),
    gerarXml: act('xml'),
    assinar: act('assinar'),
    registrar: act('registrar'),
    anular: act('anular'),
  }
}

export async function baixarDiplomaXml(id: number, codigo: string | null) {
  const token = (() => { try { return localStorage.getItem(env.authTokenKey) } catch { return null } })()
  const res = await fetch(`${env.apiBase}${base}/diplomas/${id}/xml`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) throw new Error('XML não gerado')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = `diploma-${codigo || id}.xml`; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
