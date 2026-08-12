-- Identidade do contato: separa o nome que a empresa usa do nome que o contato
-- escolheu no WhatsApp dele.
ALTER TABLE `bychat_leads`
  ADD COLUMN `nomeWhatsappAgenda` VARCHAR(191) NULL,
  ADD COLUMN `pushName` VARCHAR(191) NULL,
  ADD COLUMN `nomeOrigem` VARCHAR(20) NULL;

-- Backfill do que já existe. Leads de WhatsApp nasceram com `nome` = pushName
-- (ou o telefone quando nem isso veio); os demais têm nome de formulário,
-- importação ou digitado no painel — esses ficam protegidos de sync.
UPDATE `bychat_leads`
   SET `nomeOrigem` = CASE
     WHEN `isGroup` = 1 THEN 'grupo'
     WHEN `nome` IS NULL OR `nome` = '' THEN NULL
     WHEN REPLACE(REPLACE(REPLACE(REPLACE(`nome`, '+', ''), '-', ''), ' ', ''), '(', '') REGEXP '^[0-9)]+$' THEN 'telefone'
     WHEN `source` = 'whatsapp' THEN 'pushname'
     ELSE 'formulario'
   END
 WHERE `nomeOrigem` IS NULL;

-- O nome atual dos leads de WhatsApp É o pushName: guarda a referência antes
-- que o sync da agenda passe por cima.
UPDATE `bychat_leads`
   SET `pushName` = `nome`
 WHERE `nomeOrigem` = 'pushname' AND `pushName` IS NULL;
