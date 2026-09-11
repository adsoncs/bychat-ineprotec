import { useLocation } from 'wouter-preact'
import { MessageSquare, ExternalLink } from '@/components/ui/icon-set'
import { ActionPill } from './ActionPill'

// O que a atividade sabe do lead — é o que o backend já devolve na listagem,
// então nada aqui exige uma chamada a mais.
export interface LeadDaAtividade {
  id: number
  nome: string | null
  empresa: string | null
  whatsapp: string | null
}

/**
 * As ações que o agente precisa ter à mão ao olhar uma atividade.
 *
 * A tela de Atividades listava a tarefa e o nome do lead como TEXTO MORTO: para
 * responder a pessoa, ver o histórico ou ligar, o agente saía da tela, abria
 * Leads pelo menu e procurava o contato de novo — com o risco de perder a lista
 * de tarefas em que estava. O cliente descreveu exatamente isso: "tem as
 * atividades mas não consigo fazer nada de fato por ela".
 *
 * Só entram destinos DENTRO do sistema. `tel:` e `mailto:` chegaram a existir
 * aqui e foram removidos: abrem o discador e o cliente de e-mail do aparelho,
 * a conversa acontece fora, e nada disso volta para o CRM — sem registro na
 * timeline, sem mensagem no histórico, sem a atividade avançando. Um atalho que
 * tira o atendimento do sistema não ajuda o agente, atrapalha o acompanhamento.
 * Para falar com o contato existe a Conversa, que registra tudo.
 *
 * Rótulo junto do ícone, de propósito: as ações desta tela já viviam atrás de
 * um `⋯`, e foi assim que ninguém as encontrou.
 *
 * Devolve os botões soltos (fragmento), não uma fileira própria: quem monta a
 * linha os coloca na MESMA fileira das ações da tarefa, e é isso que faz tudo
 * parecer um conjunto só.
 */
export function LeadQuickActions({ lead, antesDeNavegar }: {
  lead: LeadDaAtividade
  /**
   * Chamado ANTES de sair da tela. Existe para quem usa isto dentro de um
   * modal: navegar com o diálogo aberto desmonta o Radix no meio do caminho e
   * ele pode deixar a página travada, sem cliques. Fechar antes evita isso.
   */
  antesDeNavegar?: () => void
}) {
  const [, navigate] = useLocation()
  const telefone = (lead.whatsapp || '').replace(/\D/g, '')

  function irPara(destino: string) {
    antesDeNavegar?.()
    navigate(destino)
  }

  return (
    <>
      {telefone && (
        <ActionPill
          icone={<MessageSquare size={11} />}
          rotulo="Conversa"
          titulo="Abrir a conversa de WhatsApp deste contato"
          onClick={() => irPara(`/conversations?leadId=${lead.id}`)}
        />
      )}
      <ActionPill
        icone={<ExternalLink size={11} />}
        rotulo="Ficha do lead"
        titulo="Abrir a ficha completa, com histórico, funil e campos"
        onClick={() => irPara(`/leads/${lead.id}`)}
      />
    </>
  )
}
