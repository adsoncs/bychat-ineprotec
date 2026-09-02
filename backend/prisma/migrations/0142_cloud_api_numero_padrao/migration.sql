-- Número padrão de envio da Cloud API.
--
-- Enquanto havia uma conexão só, "qual número envia" nunca foi pergunta: o
-- código pedia `findFirst({ active: true })` e recebia a única. Com dois ou mais
-- números, `findFirst` sem ordem devolve o que o banco quiser — fluxo, cadência,
-- notificação de agenda e resposta a lead sem histórico passam a sair por um
-- número imprevisível, sem erro e sem log. Esta coluna torna a escolha explícita.
--
-- Backfill: marca a conexão ativa mais antiga como padrão, que é exatamente o
-- que o `findFirst` costumava devolver na prática (ordem de inserção). Assim o
-- comportamento de quem já rodava não muda ao subir a migration. Tenant sem
-- conexão nenhuma não recebe linha alguma.
ALTER TABLE `bychat_cloud_api_connections` ADD COLUMN `isDefault` BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX `bychat_cloud_api_connections_isDefault_idx` ON `bychat_cloud_api_connections`(`isDefault`);

UPDATE `bychat_cloud_api_connections`
SET `isDefault` = true
WHERE `id` = (
  SELECT `id` FROM (
    SELECT `id` FROM `bychat_cloud_api_connections`
    WHERE `active` = true
    ORDER BY `id` ASC
    LIMIT 1
  ) AS primeira
);
