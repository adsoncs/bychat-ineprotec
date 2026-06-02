-- LGPD honesto: separar consent dado pelo TITULAR (via formulário) do
-- override executado pelo OPERADOR em massa.
--
-- O bulk-grant por operador era marcado como `lgpdConsent=true` igual ao
-- consent real do titular — mas isso ignora o art. 7 IX da LGPD (consentimento
-- precisa vir do titular dos dados). Agora gravamos a origem para auditoria
-- e diferenciação visual.
--
-- Valores válidos para lgpdConsentSource:
--   - 'titular'           → titular autorizou via formulário
--   - 'operator_override' → operador autorizou em massa (uso interno, requer base legal)
--   - 'legacy'            → consent dado antes desta migração, origem desconhecida
--   - NULL                → ainda não consentido

ALTER TABLE `bychat_leads`
  ADD COLUMN `lgpdConsentSource` VARCHAR(30) NULL,
  ADD COLUMN `lgpdConsentBy` INT NULL;

-- Marca consents existentes como legacy (origem desconhecida) — preserva auditoria
-- mas sinaliza visualmente que precisam ser revisados se houver questionamento.
UPDATE `bychat_leads`
SET `lgpdConsentSource` = 'legacy'
WHERE `lgpdConsent` = 1 AND `lgpdConsentSource` IS NULL;
