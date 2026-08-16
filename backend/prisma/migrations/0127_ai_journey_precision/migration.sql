-- Jornada Automática por IA: precisão do pool de reanálise.
--
-- 1) `aiStageAnalyzedAt` no lead: carimbo da última classificação concluída,
--    inclusive quando não gerou sugestão. Sustenta o cooldown e o "só reanalisa
--    se houve mensagem nova" (comparação com `lastMessageAt`).
-- 2) `kind` na sugestão + `suggestedStageKey` nullable: a IA passa a poder
--    concluir "este lead não pertence a este funil" em vez de ser obrigada a
--    escolher uma etapa qualquer.

ALTER TABLE `bychat_leads`
  ADD COLUMN `aiStageAnalyzedAt` DATETIME(3) NULL;

ALTER TABLE `bychat_lead_stage_suggestions`
  ADD COLUMN `kind` VARCHAR(20) NOT NULL DEFAULT 'stage',
  MODIFY COLUMN `suggestedStageKey` VARCHAR(50) NULL;
