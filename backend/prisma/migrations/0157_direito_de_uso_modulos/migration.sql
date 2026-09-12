-- Direito de uso por módulo — a base da loja de apps.
--
-- Até aqui, "módulo ligado" era uma decisão do admin: um interruptor em
-- `bychat_modules.active`. Para a loja vender e ativar sozinha, ligado precisa
-- ser CONSEQUÊNCIA de uma compra — e as duas coisas não podem ser a mesma.
--
-- Se a compra apenas ligasse o interruptor, sumiria a diferença entre "o
-- cliente não comprou" e "o cliente comprou e desligou", o cancelamento não
-- saberia o que reverter, e qualquer admin ligaria sozinho o que não pagou.
--
-- Então passam a existir duas perguntas:
--   tem direito?  → esta tabela, escrita pela loja
--   está ligado?  → bychat_modules.active, escrito pelo admin
-- E o módulo só funciona quando as duas respondem sim.
--
-- PREÇO NÃO MORA AQUI. Cada instalação tem banco próprio; a loja é central.
-- O tenant guarda o que tem direito de usar; quanto custa é problema da loja.
-- Guardar preço aqui significaria mudar valor em doze bancos a cada promoção.

CREATE TABLE IF NOT EXISTS `bychat_module_entitlements` (
  `id`         INT NOT NULL AUTO_INCREMENT,
  `moduleId`   VARCHAR(50) NOT NULL,

  -- De onde veio o direito. Importa no cancelamento: revogar um pacote tira
  -- junto tudo que ele concedeu, sem tocar no que foi dado à parte.
  --   pacote    compra de um guarda-chuva (o caso normal)
  --   avulso    módulo comprado sozinho
  --   cortesia  liberado em negociação — não expira sozinho
  --   teste     avaliação com prazo
  --   migracao  já era cliente antes da loja: mantém tudo que tinha
  `origem`     VARCHAR(20) NOT NULL DEFAULT 'pacote',

  -- Qual guarda-chuva concedeu, quando `origem = 'pacote'`.
  `pacote`     VARCHAR(40) NULL,

  `inicioEm`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  -- NULL = sem prazo. Assinatura ativa renova empurrando esta data.
  `expiraEm`   DATETIME(3) NULL,

  -- Rastro de quem concedeu: a loja grava o pedido, o humano grava o nome.
  `referencia` VARCHAR(120) NULL,
  `concedidoPor` VARCHAR(120) NULL,

  `createdAt`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  -- Um direito por módulo e origem: comprar o pacote duas vezes não duplica
  -- linha, e um módulo pode ter direito por pacote E por cortesia ao mesmo
  -- tempo — perder o pacote não derruba a cortesia.
  UNIQUE KEY `uniq_modulo_origem` (`moduleId`, `origem`),
  KEY `idx_modulo` (`moduleId`),
  KEY `idx_expira` (`expiraEm`),
  KEY `idx_pacote` (`pacote`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Quem já é cliente não pode perder nada ao ligarmos a loja: tudo que existe
-- hoje vira direito sem prazo. A loja passa a valer para quem chegar depois.
INSERT IGNORE INTO `bychat_module_entitlements` (`moduleId`, `origem`, `expiraEm`, `referencia`)
SELECT `id`, 'migracao', NULL, 'cliente anterior à loja'
FROM `bychat_modules`;
