-- Teste grátis, carência e baixa manual — a parte da loja que vive no tenant.
--
-- Regras do produto (11/09/2026):
--   · teste grátis de 7 dias
--   · no vencimento, 15 dias de carência antes de cortar
--   · o dono pode esticar a carência
--   · o dono pode marcar o mês como PAGO à mão, porque o cliente pode pagar
--     por fora (PIX, transferência) e isso não passa pelo provedor
--
-- A carência existe porque cortar no dia do vencimento transforma um boleto
-- atrasado em cliente sem sistema — e quem paga por PIX costuma pagar depois
-- do aviso, não antes.
--
-- ⚠️ A CHAVE ASAAS DO ATTRAE NÃO MORA AQUI, nem vai morar.
-- Este banco é do cliente. `bychat_payment_provider_connections` guarda a chave
-- DELE, para ele cobrar os clientes dele. A credencial com que o Attrae cobra o
-- cliente é outra conta, de outro dono, e fica só na loja central: se ficasse
-- aqui, seriam doze cópias da credencial de cobrança do negócio espalhadas em
-- bancos de terceiros. Vazar a chave do cliente fere um cliente; vazar a nossa
-- fere a todos.
--
-- O tenant guarda o que tem direito, até quando, e o que o dono decidiu à mão.

CREATE TABLE IF NOT EXISTS `bychat_assinatura_eventos` (
  `id`   INT NOT NULL AUTO_INCREMENT,

  -- teste | pago_manual | carencia_estendida | renovado | cancelado
  `tipo` VARCHAR(30) NOT NULL,

  -- Guarda-chuva afetado. NULL = a assinatura toda.
  `pacote` VARCHAR(40) NULL,

  -- Mês de referência de um pagamento manual: '2026-09'. É o que permite
  -- responder "setembro foi pago?" sem depender de memória de ninguém.
  `competencia` VARCHAR(7) NULL,

  -- Vencimento antes e depois do evento: a trilha de como a data andou.
  `vencimentoAnterior` DATETIME(3) NULL,
  `vencimentoNovo`     DATETIME(3) NULL,

  -- Dinheiro recebido por fora: quanto e como. Sem isto, "marquei como pago"
  -- é palavra contra palavra quando alguém conferir o caixa meses depois.
  `valorCentavos` INT NULL,
  `meio`         VARCHAR(20) NULL,   -- pix | transferencia | dinheiro | outro

  `observacao` VARCHAR(500) NULL,
  -- E-mail do dono que fez. Não é FK de propósito: se o usuário for apagado,
  -- o registro do dinheiro continua legível.
  `feitoPor`   VARCHAR(191) NULL,

  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  KEY `idx_tipo` (`tipo`),
  KEY `idx_pacote` (`pacote`),
  KEY `idx_competencia` (`competencia`),
  KEY `idx_criado` (`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Carência padrão. Fica em Setting, e não fixa no código, porque o dono pode
-- esticar para um cliente específico sem deploy.
INSERT IGNORE INTO `bychat_settings` (`key`, `value`, `label`, `grp`, `fieldType`, `createdAt`, `updatedAt`)
VALUES ('loja.carencia_dias', '15', 'Dias de carência após o vencimento', 'loja', 'number', NOW(3), NOW(3));

INSERT IGNORE INTO `bychat_settings` (`key`, `value`, `label`, `grp`, `fieldType`, `createdAt`, `updatedAt`)
VALUES ('loja.teste_dias', '7', 'Dias de teste grátis', 'loja', 'number', NOW(3), NOW(3));
