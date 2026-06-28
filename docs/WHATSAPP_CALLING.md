# WhatsApp Business Calling API — bychat-beyond

Chamadas de voz VoIP nativas do WhatsApp (Cloud API), atendidas **no painel via WebRTC**.
Entrante (cliente liga, grátis) + saída (operador liga, cobrado, exige opt-in).

Status: **Fase 0 (infra) concluída.** Fases 1–5 em andamento — ver `ROADMAP.md`.

---

## Pré-requisitos na Meta (ação do admin — fora do código)

1. **Ativar o produto Calling** na WhatsApp Business Account (WABA) do número.
2. **Assinar o campo de webhook `calls`** no App Dashboard da Meta
   (App > WhatsApp > Configuration > Webhooks > campos), além do `messages` já assinado.
3. **Tier de mensagens ≥ 2.000 conversas/24h** — a Calling API exige isso.
   O número precisa estar no **Cloud API** (não no app WhatsApp Business).
4. Permissão `whatsapp_business_messaging` no app (já presente para mensagens).

> **Indisponível** em EUA, Canadá, Egito, Vietnã e Nigéria. Brasil é suportado.
> Chamadas entrantes (user-initiated) são grátis; saídas (business-initiated) são
> cobradas por minuto conforme o país e exigem permissão do usuário.

URL do webhook (já existente, trata `messages` e agora `calls`):
`https://bychat.ia.br/api/cloud-api/webhook` — JÁ cadastrada na Meta (mensagens funcionam).
Só falta marcar o campo `calls` na assinatura do webhook (não precisa reconfigurar URL/verify token).

---

## Infra TURN (coturn) — Fase 0 concluída

WebRTC precisa de um servidor **TURN/STUN** para atravessar NAT. Subimos o **coturn**
no próprio VPS com o mecanismo *TURN REST API* (credenciais efêmeras via HMAC).

- **Pacote:** `coturn` 4.6.x (`systemctl status coturn`).
- **Config:** `/etc/turnserver.conf` (`use-auth-secret`, `static-auth-secret`, realm `bychat.ia.br`).
- **Habilitado:** `/etc/default/coturn` → `TURNSERVER_ENABLED=1`.
- **Portas (ufw + provedor de nuvem):**
  - `3478/udp` e `3478/tcp` — sinalização TURN/STUN.
  - `49160–49200/udp` — faixa de relay (min-port/max-port).
  - ⚠️ Se houver **firewall do provedor de nuvem** (security group), abrir os MESMOS ranges UDP lá também.
- **Log:** `/var/log/turnserver/turn.log` (dono `turnserver:turnserver`).

### Credenciais (.env do backend)
```
TURN_SECRET=<igual ao static-auth-secret do /etc/turnserver.conf>
TURN_URLS=turn:187.77.246.105:3478?transport=udp,turn:187.77.246.105:3478?transport=tcp
TURN_TTL_SECONDS=3600
```
O backend gera credenciais efêmeras em `lib/turnCredentials.ts::getTurnCredentials()`
e as serve ao navegador (rota da Fase 3). **`TURN_SECRET` nunca vai ao cliente** — só
o par `username`/`credential` derivado por HMAC, com validade de `TURN_TTL_SECONDS`.

### Teste rápido
```bash
SECRET=$(grep ^TURN_SECRET backend/.env | cut -d= -f2)
TS=$(( $(date +%s) + 3600 )); USER="$TS:bychat"
PASS=$(printf '%s' "$USER" | openssl dgst -binary -sha1 -hmac "$SECRET" | openssl base64)
turnutils_uclient -y -u "$USER" -w "$PASS" -p 3478 -n 1 -c 187.77.246.105
# Esperado: "Total lost packets 0 (0.000000%)"
```

### Endurecimento futuro (recomendado p/ produção)
- **TLS (`turns:` 5349)** com um subdomínio (ex.: `turn.bychat.ia.br`) + cert Let's Encrypt —
  alguns navegadores/redes corporativas só liberam `turns:`.
- Rotacionar `TURN_SECRET` periodicamente (atualizar `/etc/turnserver.conf` + `.env` + reload).

### Reverter (se necessário)
```bash
systemctl disable --now coturn
ufw delete allow 3478/udp; ufw delete allow 3478/tcp; ufw delete allow 49160:49200/udp
apt-get remove -y coturn
```

---

## Arquitetura de sinalização (referência)

```
ENTRANTE  Meta → webhook 'calls' (connect, SDP offer) → casa lead → WS para o operador
          → CallWidget responde (WebRTC) → POST /api/wa-calls/:id/accept → POST /<id>/calls accept
SAÍDA     CallWidget cria offer → POST /api/wa-calls/connect → POST /<id>/calls connect
          → toca no WhatsApp do cliente → mídia WebRTC (via coturn)
```
