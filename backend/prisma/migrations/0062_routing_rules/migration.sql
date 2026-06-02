-- 0062_routing_rules
-- Fase 4 do módulo Lead Routing — regras condicionais em cascata.
--
-- bychat_routing_rules:
--   order      — ordem de avaliação (menor primeiro). Primeira regra que casa, ganha.
--   enabled    — toggle sem deletar (preserva configuração para reativação).
--   conditions — Json {field, op, value}[]. Todos devem casar (AND).
--                Campos suportados na F4: source, utmSource, utmMedium, utmCampaign,
--                utmContent, utmTerm, formId, chatbotId, instanceName, tag.
--                Operadores: eq, neq, contains, startsWith, in, notIn, exists, missing.
--   action     — Json {type: "team"|"user", teamId?|userId?}.
--                F5 adicionará "skill".
--
-- Avaliação:
--   - Só regras enabled=true entram.
--   - Cascade ordenada por order ASC. matchedAt registra a primeira regra que casa.
--   - Compatível com motor V2 (feature flag) — quando flag off, regras NÃO rodam.

CREATE TABLE `bychat_routing_rules` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `order` INT NOT NULL DEFAULT 0,
  `name` VARCHAR(120) NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT TRUE,
  `conditions` JSON NOT NULL,
  `action` JSON NOT NULL,
  `description` VARCHAR(255) NULL,
  `matchedCount` INT NOT NULL DEFAULT 0,
  `lastMatchedAt` DATETIME(3) NULL,
  `createdByUserId` INT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `bychat_routing_rules_enabled_order_idx` (`enabled`, `order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
