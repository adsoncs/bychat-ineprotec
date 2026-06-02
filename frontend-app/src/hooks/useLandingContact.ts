import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface LandingContact {
  whatsappNumber: string
  whatsappMessage: string
  loginUrl: string
}

// GET /admin/landing-contact — contatos atuais da landing institucional
export function useLandingContact() {
  return useQuery({
    queryKey: ['landing-contact'],
    queryFn: () => api.get<LandingContact>('/admin/landing-contact'),
    staleTime: 60_000,
  })
}

// PUT /admin/landing-contact — salva (efeito imediato; landing lê na próxima request)
export function useSaveLandingContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (c: LandingContact) => api.put<{ ok: true }>('/admin/landing-contact', c),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['landing-contact'] }) },
  })
}
