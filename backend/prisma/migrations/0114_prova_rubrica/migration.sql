-- G8 / RF-203: rubrica na questão dissertativa.
-- Nota única esconde o julgamento. Com critérios pontuados em separado, quem
-- pede revisão vê onde perdeu, e a correção fica reproduzível entre corretores.
ALTER TABLE `bychat_aca_questoes` ADD COLUMN `rubricaJson` JSON NULL;
ALTER TABLE `bychat_aca_prova_respostas` ADD COLUMN `rubricaNotasJson` JSON NULL;
