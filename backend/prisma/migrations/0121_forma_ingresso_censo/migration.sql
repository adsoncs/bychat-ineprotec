-- Formas de ingresso do Censo da Educação Superior + critério de classificação.
--
-- Res. CNE/CES 1/2018, art. 6º: cursos de especialização SÃO registrados no
-- Censo da Educação Superior. Logo a lista oficial de formas de ingresso vale
-- para pós e especialização, não só graduação.
--
-- EntryMode → forma do Censo é N:1 de propósito: a escola cria quantos modos
-- comerciais quiser e todos podem declarar SELECAO_SIMPLIFICADA.

ALTER TABLE `bychat_edu_entry_modes`
  ADD COLUMN `censoForma` VARCHAR(30) NULL,
  ADD COLUMN `criterioClassificacao` VARCHAR(30) NULL;

-- Transferência interna NÃO é forma de ingresso: é situação do vínculo de
-- origem + curso de origem aqui no vínculo de destino (exigido pelo Censo).
ALTER TABLE `bychat_aca_vinculos`
  ADD COLUMN `entryModeId` INT NULL,
  ADD COLUMN `cursoOrigemId` INT NULL,
  ADD COLUMN `criterioClassificacao` VARCHAR(30) NULL,
  ADD COLUMN `amparoUrl` TEXT NULL;
