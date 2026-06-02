-- Toggle de aprovação automática pela IA na Redação Online.
-- Quando true, após a IA corrigir, a submissão vai direto para approved/rejected
-- (com base em essayCutoff) sem aguardar revisão humana.
-- Quando false (padrão, comportamento atual), submissão sempre vai para
-- needs_human após a IA — humano dá veredito final.

ALTER TABLE `bychat_edu_selection_processes`
  ADD COLUMN `essayAiAutoApprove` BOOLEAN NOT NULL DEFAULT FALSE AFTER `essayAiEnabled`;
