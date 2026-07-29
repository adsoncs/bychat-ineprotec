-- Frequência não é obrigatória em EAD.
--
-- LDB (Lei 9.394/96), art. 47, §3º: "É obrigatória a frequência de alunos e
-- professores, salvo nos programas de educação a distância." O piso de 75%
-- estava sendo imposto a QUALQUER curso, o que reprovava por frequência aluno
-- de EAD — onde o controle legal é por atividades no ambiente virtual e pela
-- presença nas avaliações presenciais.
ALTER TABLE `bychat_aca_esquemas_avaliacao`
  ADD COLUMN `frequenciaObrigatoria` BOOLEAN NOT NULL DEFAULT true;
