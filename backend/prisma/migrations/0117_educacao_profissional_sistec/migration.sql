-- Conformidade com o SISTEC na educação profissional técnica (fase T1).
--
-- 1. INTEGRALIZANDO = "Integralizar em Fase Escolar" do SISTEC: cumpriu os
--    componentes e falta estágio/TCC/atividade complementar. Sem essa situação o
--    aluno fica como "em curso" ou é evadido por engano — e é o caso mais comum
--    da escola técnica.
-- 2. TRANSFERIDO_INTERNO: o SISTEC distingue transferência interna (troca de
--    curso na mesma unidade) da externa, e a estatística da unidade depende disso.
-- 3. Curso ganha eixo tecnológico, código no CNCT e a marca de certificação
--    intermediária — os três são pedidos no cadastro de curso do SISTEC.
ALTER TABLE `bychat_aca_vinculos`
  MODIFY COLUMN `situacao` ENUM(
    'PRE_MATRICULADO','ATIVO','INTEGRALIZANDO','TRANCADO','EVADIDO',
    'TRANSFERIDO','TRANSFERIDO_INTERNO','CANCELADO','FORMADO','DIPLOMADO','FALECIDO'
  ) NOT NULL DEFAULT 'PRE_MATRICULADO';

ALTER TABLE `bychat_edu_courses`
  ADD COLUMN `eixoTecnologico` VARCHAR(80) NULL,
  ADD COLUMN `codigoCnct` VARCHAR(20) NULL,
  ADD COLUMN `certificacaoIntermediaria` BOOLEAN NOT NULL DEFAULT false;
