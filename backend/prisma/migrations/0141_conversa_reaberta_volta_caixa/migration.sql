-- Contato que volta a falar depois de resolvido vai para a CAIXA, não para
-- Atendimento.
--
-- Até aqui a mensagem em conversa encerrada reabria o atendimento direto
-- (conversationOpenedAt = agora, closedAt = null): a conversa nascia "em
-- atendimento" com o dono de antes, sem ninguém ter pegado. Agora o
-- encerramento fica de pé e o retorno é marcado nesta coluna, que é o que move
-- o lead de Resolvidos para a Caixa.
--
-- Nasce NULL em todo mundo. Nada de backfill: quem já foi reaberto pelo
-- comportamento antigo está em Atendimento com closedAt = null, e continua lá —
-- reclassificar conversa em andamento tiraria da tela de quem está atendendo.
ALTER TABLE `bychat_leads` ADD COLUMN `conversationReopenedAt` DATETIME(3) NULL;
CREATE INDEX `bychat_leads_conversationReopenedAt_idx` ON `bychat_leads`(`conversationReopenedAt`);
