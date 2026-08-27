-- Tela inicial nativa: um painel pronto do produto em vez de pilha de blocos.
--
-- Nasce NULL em todas as telas existentes, que continuam sendo pilhas de
-- blocos. Nada a fazer de backfill: `builtin` preenchido e `blocks` são
-- excludentes por desenho, e nenhuma tela de hoje é nativa.
ALTER TABLE `bychat_home_screens` ADD COLUMN `builtin` VARCHAR(40) NULL;
