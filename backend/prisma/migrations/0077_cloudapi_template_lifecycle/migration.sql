-- 0077 — Ciclo de vida de templates Cloud API (status em tempo real + motivo de reprovação)
-- Adiciona campos para rastrear motivo do status, qualidade e quando o status mudou.
-- Amplia `status` para comportar os estados completos da Meta (PAUSED, DISABLED, etc.).

ALTER TABLE `bychat_cloud_api_templates`
  MODIFY COLUMN `status` VARCHAR(30) NOT NULL,
  ADD COLUMN `statusReason`    VARCHAR(255) NULL AFTER `status`,
  ADD COLUMN `qualityScore`    VARCHAR(20)  NULL AFTER `statusReason`,
  ADD COLUMN `statusUpdatedAt` DATETIME(3)  NULL AFTER `qualityScore`;
