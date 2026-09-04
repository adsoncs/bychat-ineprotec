# Alertas — como escrever um

Referência para quem for criar um produtor novo. O objetivo não é padronizar por
padronizar: é que a pessoa consiga ler doze alertas em quinze segundos e saber
quais são dela.

## A regra de fundo

**Alerta é estado, não evento.** Uma condição que dura até alguém arrumar, não
uma mensagem que acontece uma vez. Isso decide tudo o mais: `dedupeKey` único, o
produtor pode chamar `raiseAlert` a cada volta do relógio, e o alerta fecha
quando a condição some — não quando alguém clica.

## Gramática

### Título: `<o que aconteceu>: <com quem ou com o quê>`

```
✅ Linha de WhatsApp fora do ar: attrae
✅ Proposta parada: Rafaella Freitas
✅ Google desconectado: contato@empresa.com.br
```

- **Sem número que envelhece.** "Proposta parada **há 30 dias**" fica errado
  amanhã, e a idade já aparece na linha, calculada do `firstSeenAt`.
- **Sem duplicar o que o nome do item já diz.** `Atividade atrasada: Reunião:
  Reunião com Captação` aconteceu de verdade, porque o título da atividade já
  começava com o tipo. Prefira o nome de quem, e deixe o nome do item no corpo.
- **Sem chave crua.** `status "em_negociacao"` é nome de coluna, não português.

### Corpo: `<contexto>. <consequência ou pergunta>.`

O contexto situa; a segunda frase diz **por que isso importa** ou **o que se
espera da pessoa**. Alerta sem consequência é observação.

```
✅ Estado "connecting" — número 556292376545.
   Mensagem não entra nem sai por esta linha.

✅ Reunião com Captação Edu de 28/08, 14:00.
   Aconteceu ou o contato não veio?

❌ A atividade venceu.            (e daí?)
```

### Nunca no texto

- ID interno (`booking 124`, `lead 725`) — o link já leva lá
- Nome de tabela, coluna ou chave de status
- "Erro", "falha", "exceção" sem dizer o efeito prático
- Ponto de exclamação, emoji de alarme e maiúscula gritando

## Severidade

| Nível | Critério | Exemplos |
|---|---|---|
| `critical` | Dinheiro ou atendimento **parados agora**. Alguém precisa agir hoje | Linha fora do ar, token vencido, Evolution caída |
| `warning` | Compromisso combinado que **falhou**. Precisa de alguém, não é emergência | Atividade atrasada, proposta parada, bot que não gravou |
| `info` | Pendência **administrativa**. O trabalho aconteceu, falta registrar | Reunião sem desfecho |

Em dúvida entre dois, escolha o **menor**. Severidade inflacionada é o caminho
mais curto para o time ignorar o vermelho.

`critical` tem consequência fora do painel: quando o escalonamento está ligado
(`alertas.escalonamento_ativo`), um crítico que passa da carência sem ninguém
ler vira mensagem de WhatsApp e e-mail — no máximo duas, nunca mais que isso.
Marcar como crítico algo que pode esperar até amanhã interrompe pessoas de
verdade fora do horário, e é assim que um canal de aviso morre.

## Audiência

| Valor | Quem recebe | Quando usar |
|---|---|---|
| `management` | Gestão (SUPERADMIN, ADMIN, MANAGER) | O conserto exige acesso administrativo: reconectar integração, religar linha |
| `owner` | O dono do item **e** a gestão | É trabalho de alguém: a atividade dele, a proposta dele, a reunião dele |

Nunca `owner` sem `ownerUserId` — sobra só a gestão e a regra vira letra morta.

## Antes de criar um produtor

1. **Janela de corte.** Só itens dos últimos N dias. O passivo antigo precisa de
   decisão humana, não de notificação; despejá-lo de uma vez transforma o sino
   em ruído no primeiro dia, e alerta que virou ruído não volta a ser lido.
2. **Limiar em `Setting`.** Ajustar "quantos dias contam como parada" não pode
   exigir deploy.
3. **`resolverAusentes(kind, chavesVivas)`** ao fim da varredura, para o que
   deixou de ser problema fechar sozinho.
4. **`metadata.leadId`** quando o item viver dentro de um lead — é o que permite
   ao sino montar o caminho de volta.
5. **Caminho e ação** em `services/alertLinks.ts`. Alerta que só aponta o
   problema repete o erro que originou este trabalho: o botão de desfecho da
   reunião existia na Agenda e **nunca foi usado uma única vez** em toda a
   história do sistema, porque exigia voltar a uma tela que ninguém revisita.

## Depois de criar

Rode `scripts/setup-alertas.ts --escalonar` se o tipo for `critical`: ele mostra
o texto que sairia por WhatsApp e e-mail **sem enviar nada**. A única outra
forma de conferir um envio externo é enviando, e aí já foi.

Olhe `scripts/setup-alertas.ts --saude` uma semana depois. Descarte alto quer
dizer que a pessoa viu e decidiu não fazer nada — o tipo é ruído e deve ser
desligado ou ter o limiar apertado. Nunca-lido alto quer dizer que o texto ou o
destinatário está errado.

É a única medida que impede o sistema de apodrecer sozinho.
