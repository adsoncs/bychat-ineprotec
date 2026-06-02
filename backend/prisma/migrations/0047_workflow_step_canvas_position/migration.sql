-- 0047_workflow_step_canvas_position
-- Adiciona positionX/positionY em bychat_workflow_steps (builder visual de
-- Workflows). Em produção essa migration foi registrada como já aplicada
-- via `prisma migrate resolve --applied` porque as colunas haviam sido
-- introduzidas previamente via `prisma db push`. Em clones limpos ela roda
-- normalmente.

ALTER TABLE `bychat_workflow_steps`
  ADD COLUMN `positionX` INT NOT NULL DEFAULT 0,
  ADD COLUMN `positionY` INT NOT NULL DEFAULT 0;
