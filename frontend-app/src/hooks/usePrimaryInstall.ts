// Hook que diz se este frontend está rodando contra a INSTALAÇÃO PRINCIPAL
// (bychat-beyond em bychat.ia.br) ou contra uma filha (terram, vantari, …).
//
// A fonte da verdade é o backend: ele retorna `landingAdmin: true` apenas
// quando MARKETING_HOST está setado no .env do tenant (vide
// backend/src/lib/install.ts → isPrimaryInstall()). Filhas criadas pelo
// installer não definem MARKETING_HOST e portanto recebem false aqui.
//
// Use isso pra esconder funcionalidades exclusivas do tenant principal:
// configuração de landing institucional, Instalações, Planejamento, etc.

import { useAppearance } from './useSettings'

export function usePrimaryInstall(): { isPrimary: boolean; isLoading: boolean } {
  const { data, isLoading } = useAppearance()
  return { isPrimary: data?.landingAdmin === true, isLoading }
}
