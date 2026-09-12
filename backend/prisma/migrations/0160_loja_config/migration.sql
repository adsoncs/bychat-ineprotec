-- A configuração da loja sai de `bychat_settings`.
--
-- A 0159 gravou `loja.carencia_dias` e `loja.teste_dias` como Setting, e isso
-- era um furo: `GET /api/admin/settings` devolve TODAS as chaves e o
-- `PUT /api/admin/settings` faz upsert de qualquer uma. O superadmin do cliente
-- podia ler a carência e gravar 3650 — dez anos de graça, contornando a
-- cobrança inteira. Mais de doze rotas escrevem Setting, então lista negra por
-- prefixo não protege nada: o que protege é o dado não morar lá.
--
-- Regra do produto: a loja de apps e suas configurações ficam FORA das
-- configurações do sistema, e o superadmin não tem acesso a elas.
--
-- Esta tabela não é exposta por nenhuma rota de administração do tenant. Quem
-- escreve é o dono do produto e a loja central, pela rota assinada.

CREATE TABLE IF NOT EXISTS `bychat_loja_config` (
  `chave`       VARCHAR(60) NOT NULL,
  `valor`       VARCHAR(500) NOT NULL,
  `atualizadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`chave`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Leva o valor que já valia, para que instalação nenhuma mude de comportamento
-- na subida. Aspas são retiradas porque Setting.value é JSON e aqui é texto.
INSERT IGNORE INTO `bychat_loja_config` (`chave`, `valor`)
SELECT SUBSTRING(`key`, 6), TRIM(BOTH '"' FROM `value`)
FROM `bychat_settings`
WHERE `key` IN ('loja.carencia_dias', 'loja.teste_dias');

-- Defaults, para a instalação que por algum motivo não tenha as linhas acima.
INSERT IGNORE INTO `bychat_loja_config` (`chave`, `valor`) VALUES ('carencia_dias', '15');
INSERT IGNORE INTO `bychat_loja_config` (`chave`, `valor`) VALUES ('teste_dias', '7');

-- Sai da tela de configurações. Chaves nomeadas uma a uma de propósito: um
-- LIKE 'loja.%' apagaria qualquer coisa que um cliente tenha criado com nome
-- parecido.
DELETE FROM `bychat_settings` WHERE `key` IN ('loja.carencia_dias', 'loja.teste_dias');
