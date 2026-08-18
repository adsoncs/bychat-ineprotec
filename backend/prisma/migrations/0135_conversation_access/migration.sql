-- Gerenciador de acesso do Conversas.
--
-- Quem vê o quê no Conversas era decidido em três lugares que não conversam
-- entre si: a permissão do MÓDULO (ver/criar/editar/excluir por papel), o
-- ALCANCE do lead (scope own/team/all) e a reserva do NÚMERO. Nenhum deles
-- responde à pergunta que o cliente faz — "o gestor acompanha os grupos da
-- recepção, e só isso" — e cada tentativa de forçar a resposta mexendo em
-- setor, dono ou escopo do papel respinga em Leads, Kanban e Relatórios.
--
-- Esta tabela faz a pergunta direto: por CANAL e por TIPO de conversa (contato
-- x grupo), o que este papel — ou esta pessoa — pode fazer.
--
-- Nasce vazia de propósito: sem linha para o sujeito, o Conversas se comporta
-- exatamente como antes da migration. Só quem o superadmin marcar passa a ser
-- regido por aqui, e nesse caso a marcação é a palavra final — vale mais que o
-- scope do papel e mais que a reserva do número.

CREATE TABLE `bychat_conversation_access_rules` (
  `id`          INT NOT NULL AUTO_INCREMENT,
  -- 'role' | 'user'
  `subjectType` VARCHAR(10) NOT NULL,
  -- nome do papel ('MANAGER') ou id do usuário em texto ('4')
  `subjectId`   VARCHAR(50) NOT NULL,
  -- 'evolution:<instanceId>' | 'cloud:<connectionId>' | '*'
  `channelKey`  VARCHAR(40) NOT NULL,
  -- 'contact' | 'group'
  `kind`        VARCHAR(10) NOT NULL,
  `canView`     TINYINT(1) NOT NULL DEFAULT 0,
  `canCreate`   TINYINT(1) NOT NULL DEFAULT 0,
  `canEdit`     TINYINT(1) NOT NULL DEFAULT 0,
  `canDelete`   TINYINT(1) NOT NULL DEFAULT 0,
  `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `bychat_conv_access_subject_channel_kind_key` (`subjectType`, `subjectId`, `channelKey`, `kind`),
  KEY `bychat_conv_access_subject_idx` (`subjectType`, `subjectId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
