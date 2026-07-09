// src/lib/googleAdsApi.ts
// Versão da Google Ads API centralizada. O Google descontinua ~3 versões/ano e
// BLOQUEIA as antigas (v20 foi bloqueada em 2026-07 com UNSUPPORTED_VERSION).
// Mantê-la num só lugar (com override por env) evita ter que caçar strings em
// vários arquivos quando o Google força a atualização.
//
// Para atualizar sem deploy: defina GOOGLE_ADS_API_VERSION no .env (ex.: v25).
export const GOOGLE_ADS_API_VERSION = (process.env.GOOGLE_ADS_API_VERSION || 'v24').trim()
export const GOOGLE_ADS_API_BASE = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`
