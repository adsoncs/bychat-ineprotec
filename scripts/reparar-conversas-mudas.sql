-- reparar-conversas-mudas.sql
--
-- Devolve ao Conversas as conversas que a importação do celular gravou no banco
-- mas que não aparecem em aba nenhuma.
--
-- O PORQUÊ: as abas do Conversas são decididas por dois campos do lead
-- (`condicaoDaCaixa`, em backend/src/routes/atendimento.ts):
--
--     Atendimento  → conversationOpenedAt IS NOT NULL
--     Caixa        → lastMessageAt        IS NOT NULL
--     Resolvidos   → conversationClosedAt IS NOT NULL
--
-- O runner da importação nunca tocava em `lastMessageAt` — de propósito, para
-- que histórico de meses atrás não ressuscitasse a conversa no topo da caixa.
-- O efeito colateral é que um lead CRIADO pela importação não recebia nenhum
-- dos três campos e ficava fora de todas as abas, inclusive da "Todos": as
-- mensagens estavam no banco e a conversa não existia na tela. Era o
-- "importa, diz que importou, e não reflete no Conversas".
--
-- A partir de agora `tornarVisivelNoConversas()` (chatImportRunner.ts) resolve
-- isso ao fim de cada sincronização. Este script é para o passivo: as conversas
-- que já estavam mudas antes da correção.
--
-- O QUE FAZ: `lastMessageAt` recebe a data da mensagem mais NOVA da conversa.
-- Assim ela entra na Caixa na posição da sua última atividade real, e não no
-- topo como se tivesse acabado de chegar. Nada é criado, apagado ou movido de
-- dono; `unreadMessages` não é tocado (histórico antigo não é "não lido").
--
-- ONDE MEXE: só em lead que tem mensagem E está fora das três abas. Um lead sem
-- mensagem continua sem `lastMessageAt` — ele não é uma conversa.
--
-- Rodar:  mysql -h127.0.0.1 -P<porta> -u<user> -p <base> < reparar-conversas-mudas.sql
-- É idempotente: rodar de novo não muda mais nada.

-- Antes: quantas estão mudas.
SELECT COUNT(*) AS `conversas_mudas_antes`
FROM bychat_leads l
WHERE l.lastMessageAt IS NULL
  AND l.conversationOpenedAt IS NULL
  AND l.conversationClosedAt IS NULL
  AND EXISTS (SELECT 1 FROM bychat_messages m WHERE m.leadId = l.id);

UPDATE bychat_leads l
JOIN (
  SELECT m.leadId, MAX(m.timestamp) AS ultima
  FROM bychat_messages m
  GROUP BY m.leadId
) u ON u.leadId = l.id
SET l.lastMessageAt = u.ultima
WHERE l.lastMessageAt IS NULL
  AND l.conversationOpenedAt IS NULL
  AND l.conversationClosedAt IS NULL;

-- Depois: tem que dar zero.
SELECT COUNT(*) AS `conversas_mudas_depois`
FROM bychat_leads l
WHERE l.lastMessageAt IS NULL
  AND l.conversationOpenedAt IS NULL
  AND l.conversationClosedAt IS NULL
  AND EXISTS (SELECT 1 FROM bychat_messages m WHERE m.leadId = l.id);
