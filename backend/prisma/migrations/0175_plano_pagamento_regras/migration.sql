-- Planos de pagamento da oferta com regras de portal (services/planoFinanceiro).
ALTER TABLE `bychat_aca_planos_pagamento` ADD COLUMN `regras` JSON NULL;
