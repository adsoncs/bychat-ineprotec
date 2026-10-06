// src/lib/eduTextos.ts
//
// Catálogo dos textos do portal editáveis em Configurações Gerais › Textos.
// É a lista de chaves aceitas, o nome que o admin vê e o texto padrão.
//
// O padrão aqui é o MESMO texto que o portal-app escreve como reserva em cada
// chamada t('chave', 'padrão') — assim, sem nada salvo, a tela fica igual.
// Mudou um texto no portal-app? Mude aqui também.
//
// Precedência: rótulo do portal (Branding › Textos, só os do formulário) ›
// este catálogo editado › padrão.

export interface TextoDoCatalogo {
  chave: string
  rotulo: string
  padrao: string
  /** Texto longo: o admin mostra caixa de várias linhas. */
  longo?: boolean
  /** Marcadores aceitos, ex.: {nome}. */
  marcadores?: string[]
}

export interface GrupoDeTextos {
  id: string
  titulo: string
  descricao: string
  textos: TextoDoCatalogo[]
}

export const CATALOGO_TEXTOS: GrupoDeTextos[] = [
  {
    id: 'form',
    titulo: 'Formulário de inscrição',
    descricao: 'Botões e quadros do formulário. Um portal personalizado com texto próprio no Branding continua com o dele; os que seguem as Gerais em Textos usam estes.',
    textos: [
      { chave: 'form.continuar', rotulo: 'Botão para avançar', padrao: 'Continuar' },
      { chave: 'form.voltar', rotulo: 'Botão para voltar', padrao: 'Voltar' },
      { chave: 'form.enviar', rotulo: 'Botão de envio', padrao: 'Confirmar inscrição' },
      { chave: 'form.revisao', rotulo: 'Nome do passo de revisão', padrao: 'Revisão' },
      { chave: 'form.revisaoTitulo', rotulo: 'Título da revisão', padrao: 'Confira antes de enviar' },
      { chave: 'form.revisaoSubtitulo', rotulo: 'Texto da revisão', padrao: 'Depois de confirmar, esses dados vão para a secretaria.', longo: true },
      { chave: 'form.resumoTitulo', rotulo: 'Título do resumo', padrao: 'Resumo da inscrição' },
      { chave: 'form.resumoVazio', rotulo: 'Resumo sem curso escolhido', padrao: 'O curso escolhido e os valores aparecem aqui.' },
      { chave: 'form.resumoTaxa', rotulo: 'Linha da taxa de inscrição', padrao: 'Taxa de inscrição' },
      { chave: 'form.resumoMatricula', rotulo: 'Linha da taxa de matrícula', padrao: 'Taxa de matrícula' },
      { chave: 'form.resumoMensalidade', rotulo: 'Linha da mensalidade', padrao: 'Mensalidade' },
      { chave: 'form.resumoCurso', rotulo: 'Nome do valor do curso (tabela de preços) no pagamento e na fatura', padrao: 'Curso' },
      { chave: 'form.resumoAVista', rotulo: 'Linha do à vista (tabela de preços)', padrao: 'À vista no Pix ou boleto' },
      { chave: 'form.resumoObservacao', rotulo: 'Observação do resumo', padrao: 'Os valores são confirmados no contrato, depois da análise dos documentos.', longo: true },
    ],
  },
  {
    id: 'conclusao',
    titulo: 'Confirmação da inscrição',
    descricao: 'A tela logo depois de enviar a inscrição. A mensagem de conclusão configurada no portal continua aparecendo primeiro.',
    textos: [
      { chave: 'conc.titulo', rotulo: 'Título', padrao: 'Inscrição recebida' },
      { chave: 'conc.guardeCodigo', rotulo: 'Texto acima do código', padrao: 'Guarde este código — ele identifica sua inscrição.' },
      { chave: 'conc.faltaPagamento', rotulo: 'Aviso de pagamento pendente', padrao: 'Falta concluir o pagamento para a inscrição valer.' },
      { chave: 'conc.pagarAgora', rotulo: 'Botão de pagar', padrao: 'Pagar agora' },
      { chave: 'conc.sigaPassos', rotulo: 'Quando há próximos passos', padrao: 'Siga os próximos passos abaixo para concluir.' },
      { chave: 'conc.whatsapp', rotulo: 'Quando os passos vão pelo WhatsApp', padrao: 'Enviamos os próximos passos para o seu WhatsApp.' },
      { chave: 'conc.conviteSenhaLink', rotulo: 'Convite de senha (link)', padrao: 'Criar uma senha' },
      { chave: 'conc.conviteSenhaTexto', rotulo: 'Convite de senha (resto da frase)', padrao: 'para acompanhar sua inscrição sem precisar achar esta página de novo.' },
      { chave: 'conc.senhaTitulo', rotulo: 'Quadro de senha: título', padrao: 'Crie uma senha para acompanhar' },
      { chave: 'conc.senhaTexto', rotulo: 'Quadro de senha: texto', padrao: 'Com ela você entra quando quiser para enviar documentos, assinar o contrato e ver o que falta — sem depender de achar esta página de novo.', longo: true },
      { chave: 'conc.senhaDepois', rotulo: 'Quadro de senha: rodapé', padrao: 'Pode deixar para depois: dá para criar a senha pelo link que enviamos no WhatsApp.', longo: true },
      { chave: 'conc.senhaCriadaTitulo', rotulo: 'Senha criada: título', padrao: 'Senha criada' },
      { chave: 'conc.senhaCriadaTexto', rotulo: 'Senha criada: texto', padrao: 'Você já está identificado neste aparelho.' },
      { chave: 'conc.irPortal', rotulo: 'Botão para o portal', padrao: 'Ir para meu portal' },
      { chave: 'conc.interesseTitulo', rotulo: 'Captura de interesse: título', padrao: 'Recebemos seu interesse' },
      { chave: 'conc.interesseTexto', rotulo: 'Captura de interesse: texto', padrao: 'Enviamos no seu WhatsApp o link para continuar a inscrição.' },
      { chave: 'conc.ajudaBotao', rotulo: 'Botão flutuante de ajuda', padrao: 'Falar com a gente' },
      { chave: 'conc.ajudaMensagem', rotulo: 'Mensagem pronta do WhatsApp de ajuda', padrao: 'Olá! Preciso de ajuda com a inscrição.' },
    ],
  },
  {
    id: 'etapas',
    titulo: 'Etapas da inscrição',
    descricao: 'A lista de etapas depois da inscrição e no portal (redação, contrato, documentos, pagamento).',
    textos: [
      { chave: 'etapas.tituloInscricao', rotulo: 'Título logo após a inscrição', padrao: 'Próximos passos' },
      { chave: 'etapas.tituloPainel', rotulo: 'Título no portal', padrao: 'O que falta na sua inscrição' },
      { chave: 'etapas.nome.cadastro', rotulo: 'Nome: cadastro', padrao: 'Completar cadastro' },
      { chave: 'etapas.nome.prova', rotulo: 'Nome: redação/prova', padrao: 'Redação online' },
      { chave: 'etapas.nome.contrato', rotulo: 'Nome: contrato', padrao: 'Contrato' },
      { chave: 'etapas.nome.documentos', rotulo: 'Nome: documentos', padrao: 'Documentos' },
      { chave: 'etapas.nome.pagamento', rotulo: 'Nome: pagamento', padrao: 'Pagamento' },
      { chave: 'etapas.feito', rotulo: 'Situação: concluída', padrao: 'Concluída' },
      { chave: 'etapas.aguardando', rotulo: 'Situação: em análise', padrao: 'Em análise' },
      { chave: 'etapas.pendente', rotulo: 'Situação: pendente', padrao: 'Pendente' },
      { chave: 'etapas.corrigir', rotulo: 'Situação: precisa corrigir', padrao: 'Corrigir' },
      { chave: 'etapas.fazerAgora', rotulo: 'Botão de etapa pendente', padrao: 'Fazer agora' },
      { chave: 'etapas.ver', rotulo: 'Botão de etapa feita', padrao: 'Ver' },
      { chave: 'etapas.avisoDepois', rotulo: 'Aviso abaixo das etapas', padrao: 'Você pode fazer as etapas agora ou depois, quando quiser, entrando no seu portal.', longo: true },
      { chave: 'etapas.tudoCerto', rotulo: 'Tudo concluído (destaque)', padrao: 'Tudo certo por aqui.' },
      { chave: 'etapas.tudoCertoTexto', rotulo: 'Tudo concluído (texto)', padrao: 'Acompanhe o andamento pelo seu portal.' },
    ],
  },
  {
    id: 'portal',
    titulo: 'Meu portal',
    descricao: 'A área logada do candidato e o menu da conta.',
    textos: [
      { chave: 'portal.candidato', rotulo: 'Quem ainda não é aluno', padrao: 'Candidato' },
      { chave: 'portal.outrasInscricoes', rotulo: 'Título de outras inscrições', padrao: 'Outras inscrições' },
      { chave: 'portal.nadaPendente', rotulo: 'Sem etapas pendentes', padrao: 'Nada pendente por aqui. Avisamos você pelo WhatsApp quando houver novidade.', longo: true },
      { chave: 'portal.falha', rotulo: 'Erro ao abrir o portal', padrao: 'Não foi possível abrir o seu portal. Verifique a conexão e tente de novo.', longo: true },
      { chave: 'portal.menuEditar', rotulo: 'Menu: editar dados', padrao: 'Editar meus dados' },
      { chave: 'portal.menuCriarSenha', rotulo: 'Menu: criar senha', padrao: 'Criar minha senha' },
      { chave: 'portal.menuTrocarSenha', rotulo: 'Menu: trocar senha', padrao: 'Trocar senha' },
      { chave: 'portal.menuCpfAviso', rotulo: 'Menu: aviso do CPF como senha', padrao: 'Você ainda entra com o CPF como senha.' },
      { chave: 'portal.saiu', rotulo: 'Aviso depois de sair', padrao: 'Você saiu do portal.' },
    ],
  },
  {
    id: 'aluno',
    titulo: 'Vida acadêmica',
    descricao: 'As seções do portal de quem já é aluno.',
    textos: [
      { chave: 'aluno.emDia', rotulo: 'Sem pendências: título', padrao: 'Está tudo em dia' },
      { chave: 'aluno.emDiaTexto', rotulo: 'Sem pendências: texto', padrao: 'Nada pendente da sua parte.' },
      { chave: 'aluno.pendentesTexto', rotulo: 'Com pendências: texto', padrao: 'O que ainda depende de você ou da secretaria.' },
      { chave: 'aluno.financeiro', rotulo: 'Seção: financeiro', padrao: 'Financeiro' },
      { chave: 'aluno.horario', rotulo: 'Seção: horário', padrao: 'Horário das aulas' },
      { chave: 'aluno.datas', rotulo: 'Seção: datas', padrao: 'Próximas datas' },
      { chave: 'aluno.materiais', rotulo: 'Seção: materiais', padrao: 'Materiais de estudo' },
      { chave: 'aluno.estagio', rotulo: 'Seção: estágio', padrao: 'Estágio e atividades' },
      { chave: 'aluno.boletim', rotulo: 'Seção: boletim', padrao: 'Boletim' },
      { chave: 'aluno.boletimBloqueado', rotulo: 'Boletim bloqueado', padrao: 'Indisponível enquanto houver pendência financeira.' },
      { chave: 'aluno.rematricula', rotulo: 'Seção: rematrícula', padrao: 'Rematrícula aberta' },
      { chave: 'aluno.rematriculaTexto', rotulo: 'Rematrícula: texto', padrao: 'Há turma disponível para você continuar no próximo período.' },
      { chave: 'aluno.requerimentos', rotulo: 'Seção: requerimentos', padrao: 'Requerimentos' },
      { chave: 'aluno.requerimentosTexto', rotulo: 'Requerimentos: texto', padrao: 'Declarações, histórico e outros pedidos à secretaria.' },
      { chave: 'aluno.conta', rotulo: 'Seção: conta', padrao: 'Sua conta' },
    ],
  },
  {
    id: 'senha',
    titulo: 'Senha e documentos',
    descricao: 'As telas de criar/trocar senha e de documentos.',
    textos: [
      { chave: 'senha.criarTitulo', rotulo: 'Criar senha: título', padrao: 'Criar sua senha' },
      { chave: 'senha.criarTexto', rotulo: 'Criar senha: texto', padrao: 'Olá, {nome}. Você entrou com a senha padrão (o seu CPF). Crie uma senha só sua — a partir daí o CPF deixa de valer como senha.', longo: true, marcadores: ['{nome}'] },
      { chave: 'senha.trocarTitulo', rotulo: 'Trocar senha: título', padrao: 'Trocar senha' },
      { chave: 'senha.trocarTexto', rotulo: 'Trocar senha: texto', padrao: 'A senha atual deixa de valer e os outros aparelhos saem do portal.', longo: true },
      { chave: 'senha.regra', rotulo: 'Regra da senha', padrao: 'Ao menos 8 caracteres, misturando letras e números.' },
      { chave: 'senha.salvar', rotulo: 'Botão salvar', padrao: 'Salvar senha' },
      { chave: 'senha.agoraNao', rotulo: 'Botão pular', padrao: 'Agora não, continuar' },
      { chave: 'docs.titulo', rotulo: 'Documentos: título', padrao: 'Seus documentos' },
      { chave: 'docs.nenhum', rotulo: 'Documentos: nada a enviar', padrao: 'Ainda não há documentos a enviar para esta inscrição. Se a secretaria pedir algum, ele aparece aqui.', longo: true },
    ],
  },
]

const CHAVES = new Map(CATALOGO_TEXTOS.flatMap((g) => g.textos.map((t) => [t.chave, t] as const)))

/** Só chaves do catálogo; texto aparado, até 500 caracteres; vazio = padrão. */
export function limparTextos(v: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!v || typeof v !== 'object') return out
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (!CHAVES.has(k) || typeof val !== 'string') continue
    const s = val.trim().slice(0, 500)
    // Igual ao padrão não é personalização: não guarda.
    if (s && s !== CHAVES.get(k)!.padrao) out[k] = s
  }
  return out
}
