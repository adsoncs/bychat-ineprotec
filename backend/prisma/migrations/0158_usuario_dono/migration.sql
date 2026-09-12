-- O dono do produto — um nível acima do SUPERADMIN, que é do cliente.
--
-- A loja de apps não pode ser configurável por quem compra: se o superadmin
-- alcança a tela de direitos de uso, ele se dá os módulos que não pagou. Mas a
-- solução óbvia — um papel novo no enum UserRole — é uma armadilha aqui:
-- existem 47 comparações estritas `role === 'SUPERADMIN'` espalhadas pelo
-- código, e NENHUMA hierarquia de papéis. Um valor novo falharia nas 47, e o
-- dono acabaria com MENOS acesso que o superadmin.
--
-- Então o dono é um ATRIBUTO de um superadmin, não um papel. Ele continua
-- passando em todas as verificações existentes, e ganha o que é dele por uma
-- checagem nova e explícita. A superfície nova é pequena e auditável.
--
-- Este campo NÃO é escrito por nenhuma rota. A API de usuários lista os campos
-- aceitos um a um (email, name, role, active, password, capacity,
-- notifyWhatsapp), então `isOwner` não entra nem por acidente nem de propósito.
-- Quem define é `scripts/definir-dono.ts`, rodado no servidor pelo operador.
--
-- LIMITE HONESTO: isto protege contra abuso PELA APLICAÇÃO, não contra acesso
-- ao servidor. Quem tem shell escreve direto no banco. No arranjo atual é
-- adequado — o cliente não tem servidor. Se um dia hospedar por conta própria,
-- o que continua valendo é a loja não ter endpoint de concessão no tenant.

ALTER TABLE `bychat_users`
  ADD COLUMN `isOwner` BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX `idx_users_owner` ON `bychat_users` (`isOwner`);
