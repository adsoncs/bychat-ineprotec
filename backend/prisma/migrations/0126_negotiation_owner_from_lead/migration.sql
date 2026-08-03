-- O responsável da negociação passa a ser o do LEAD.
--
-- Até aqui, quem criava a proposta virava responsável por ela: gestor montando a
-- proposta pelo vendedor ficava como dono do negócio, e o painel de Negociações
-- (tabela, pipeline, filtro e exportação) mostrava o nome errado. O responsável
-- do lead é a fonte da verdade — daqui em diante a criação herda dele e trocar o
-- dono do lead propaga para as negociações em aberto (middleware do Prisma).
--
-- Sem DDL: só realinha o que já está gravado. Alinha inclusive as fechadas
-- porque o valor ali nunca foi "quem vendeu" — era quem clicou em criar, o que
-- não é histórico que valha a pena preservar. Daqui em diante a proposta fechada
-- congela o responsável que tinha no fechamento.

UPDATE `bychat_negotiations` n
  JOIN `bychat_leads` l ON l.id = n.leadId
   SET n.`responsavelUserId` = l.`assignedUserId`
 WHERE l.`assignedUserId` IS NOT NULL
   AND (n.`responsavelUserId` <=> l.`assignedUserId`) = 0;
