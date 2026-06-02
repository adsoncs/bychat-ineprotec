-- 0068_shift_handover_settings
-- Reforma F5 — hand-off no fim do turno.
--
-- Cron detecta agentes cujo AgentWorkingHour terminou há > toleranceMinutes
-- e ainda têm leads atribuídos. Solta esses leads (assignedUserId=null) pra
-- voltarem à fila do setor (ou do plantão se OOH team configurado).
--
-- Inerte enquanto routing.shift.enabled = false (default).

INSERT INTO `bychat_settings` (`key`, `value`, `label`, `grp`, `fieldType`, `createdAt`, `updatedAt`)
  VALUES
    ('routing.shift.enabled', CAST('false' AS JSON), 'Hand-off no fim do turno', 'routing', 'boolean', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('routing.shift.toleranceMinutes', CAST('30' AS JSON), 'Tolerância após fim do turno (min)', 'routing', 'number', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
  ON DUPLICATE KEY UPDATE `updatedAt` = CURRENT_TIMESTAMP(3);
