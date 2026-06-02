-- 0048_cadence_step_branching_canvas
-- Habilita o builder visual também para Cadências, com branching opcional.
-- - positionX/Y: posição no canvas, persistida ao arrastar.
-- - nextStepId: sucessor explícito (preferido pelo cadenceScheduler quando
--   presente; caso null, fallback é o `order` consecutivo, mantendo o modelo
--   linear histórico).
-- - altStepId: caminho alternativo quando o step possui conditionJson e a
--   condição falha — mesmo papel do altStepId em WorkflowStep.

ALTER TABLE `bychat_cadence_steps`
  ADD COLUMN `positionX` INT NOT NULL DEFAULT 0,
  ADD COLUMN `positionY` INT NOT NULL DEFAULT 0,
  ADD COLUMN `nextStepId` INT NULL,
  ADD COLUMN `altStepId` INT NULL;
