// Distingue a instalação PRINCIPAL (que serve a landing/home pública no
// domínio principal) das instalações FILHAS (tenants em subdomínio).
//
// Sinal: `MARKETING_HOST` explícito no .env. A instalação principal
// (bychat-beyond) seta `MARKETING_HOST="bychat.ia.br"`. Tenants criados
// pelo installer NÃO setam — então nunca expõem nem acessam os controles
// da landing principal. (Diferente de resolveMarketingHost(), que tem
// fallback pro hostname de APP_URL; aqui exigimos o env EXPLÍCITO.)
export function isPrimaryInstall(): boolean {
  return !!process.env.MARKETING_HOST?.trim()
}
