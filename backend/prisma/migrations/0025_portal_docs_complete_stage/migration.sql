-- Etapa-alvo para auto-avanço do lead quando todos os docs obrigatórios são aprovados.
ALTER TABLE `bychat_enrollment_portals`
  ADD COLUMN `docsCompleteStageKey` VARCHAR(50) NULL;
