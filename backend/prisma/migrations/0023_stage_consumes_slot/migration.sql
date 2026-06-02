-- Stage.consumesSlot: marca etapas onde leads ocupam vaga da CourseOffering.
-- Inscrição (INSCRITO) não consome; só avançar para Pagou Taxa, Classificado,
-- Convocado ou Matriculado garante a vaga. Mover lead de volta para Desistente
-- ou outra etapa não-consumidora libera a vaga automaticamente (a contagem é
-- dinâmica via JOIN Stage.consumesSlot).

ALTER TABLE `bychat_stages`
  ADD COLUMN `consumesSlot` BOOLEAN NOT NULL DEFAULT false;

-- Backfill: marca como true as etapas padrão do funil "Captação Educacional"
-- que historicamente representam vaga garantida. Em funis customizados o
-- admin marca pelo editor.
UPDATE `bychat_stages`
   SET `consumesSlot` = true
 WHERE `key` IN ('PAGOU_TAXA', 'CLASSIFICADO', 'CONVOCADO', 'MATRICULADO');
