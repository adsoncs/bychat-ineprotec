// src/services/enemEssayCatalog.ts
// Catálogo curado dos temas de redação do ENEM (últimas 10 edições).
// Fonte: cadernos de prova oficiais do INEP (inep.gov.br).
// O INEP não publica API pública para os temas — esta lista é mantida
// manualmente. Para atualizar com uma nova edição, adicione no topo do array
// e remova a mais antiga (mantendo 10 itens).

export interface EnemEssayTheme {
  year: number
  title: string
  prompt: string
  supportTexts: string
  sourceUrl: string
}

export const ENEM_ESSAY_CATALOG: EnemEssayTheme[] = [
  {
    year: 2024,
    title: 'Desafios para o enfrentamento do racismo nas mídias digitais no Brasil',
    prompt:
      'A partir da leitura dos textos motivadores e com base nos conhecimentos construídos ao longo de sua formação, redija texto dissertativo-argumentativo em modalidade escrita formal da língua portuguesa sobre o tema "Desafios para o enfrentamento do racismo nas mídias digitais no Brasil", apresentando proposta de intervenção que respeite os direitos humanos. Selecione, organize e relacione, de forma coerente e coesa, argumentos e fatos para defesa de seu ponto de vista.',
    supportTexts:
      'TEXTO I — Dados da Central SaferNet Brasil (2023) apontam aumento de 80% nas denúncias de racismo praticado por meio da internet em comparação com o ano anterior, com mais de 13 mil registros.\n\nTEXTO II — A Lei nº 14.532/2023 alterou o Código Penal e a Lei do Racismo (Lei nº 7.716/1989), tipificando como crime de racismo (e não mais apenas injúria racial) ofensas dirigidas a pessoa em razão de raça, cor, etnia ou procedência nacional, inclusive em redes sociais.\n\nTEXTO III — Pesquisa da PerifaConnection (2022) mostra que algoritmos de plataformas digitais frequentemente reduzem o alcance de criadores de conteúdo negros e periféricos, prática conhecida como "shadow banning algorítmico".\n\nTEXTO IV — Excerto: "Quando o racismo migra para o ambiente digital, ele se amplifica pela velocidade do compartilhamento e pelo anonimato, exigindo respostas que envolvam educação midiática, regulação das plataformas e responsabilização dos perpetradores." (DJAMILA RIBEIRO, adaptado).',
    sourceUrl: 'https://www.gov.br/inep/pt-br/areas-de-atuacao/avaliacao-e-exames-educacionais/enem',
  },
  {
    year: 2023,
    title: 'Desafios para o enfrentamento da invisibilidade do trabalho de cuidado realizado pela mulher no Brasil',
    prompt:
      'A partir da leitura dos textos motivadores e com base nos conhecimentos construídos ao longo de sua formação, redija texto dissertativo-argumentativo em modalidade escrita formal da língua portuguesa sobre o tema "Desafios para o enfrentamento da invisibilidade do trabalho de cuidado realizado pela mulher no Brasil", apresentando proposta de intervenção que respeite os direitos humanos. Selecione, organize e relacione, de forma coerente e coesa, argumentos e fatos para defesa de seu ponto de vista.',
    supportTexts:
      'TEXTO I — Pesquisa do IBGE (2019) revela que mulheres dedicam, em média, 21,4 horas semanais a afazeres domésticos e cuidado de pessoas, quase o dobro das 11 horas registradas entre os homens.\n\nTEXTO II — A Pesquisa Nacional por Amostra de Domicílios Contínua (PNAD-C/IBGE) classifica como "trabalho não remunerado" a maior parte das atividades de cuidado, o que contribui para sua invisibilidade nas estatísticas econômicas.\n\nTEXTO III — Estudo da Oxfam (2020) estima que o trabalho de cuidado não remunerado realizado por mulheres em todo o mundo equivale a US$ 10,8 trilhões por ano — três vezes o valor da indústria global de tecnologia.\n\nTEXTO IV — Excerto: "Cuidar é um trabalho. E o fato de ser realizado majoritariamente por mulheres, dentro de casa e sem remuneração, não deve ser motivo para sua desvalorização, mas sim para o reconhecimento e a redistribuição dessa responsabilidade." (HELENA HIRATA, adaptado).',
    sourceUrl: 'https://www.gov.br/inep/pt-br/areas-de-atuacao/avaliacao-e-exames-educacionais/enem',
  },
  {
    year: 2022,
    title: 'Desafios para a valorização de comunidades e povos tradicionais no Brasil',
    prompt:
      'A partir da leitura dos textos motivadores e com base nos conhecimentos construídos ao longo de sua formação, redija texto dissertativo-argumentativo em modalidade escrita formal da língua portuguesa sobre o tema "Desafios para a valorização de comunidades e povos tradicionais no Brasil", apresentando proposta de intervenção que respeite os direitos humanos. Selecione, organize e relacione, de forma coerente e coesa, argumentos e fatos para defesa de seu ponto de vista.',
    supportTexts:
      'TEXTO I — O Decreto nº 6.040/2007 instituiu a Política Nacional de Desenvolvimento Sustentável dos Povos e Comunidades Tradicionais, reconhecendo grupos como quilombolas, ribeirinhos, ciganos, pomeranos, pantaneiros, faxinalenses, entre outros.\n\nTEXTO II — Segundo o Censo 2010 (IBGE), o Brasil possui mais de 305 etnias indígenas e cerca de 274 línguas faladas. Existem ainda mais de 6 mil comunidades quilombolas certificadas pela Fundação Cultural Palmares.\n\nTEXTO III — A Convenção 169 da Organização Internacional do Trabalho (OIT), ratificada pelo Brasil, garante aos povos tradicionais o direito à consulta livre, prévia e informada sobre medidas administrativas ou legislativas que os afetem.\n\nTEXTO IV — Excerto: "A valorização dos saberes tradicionais não é apenas uma questão de justiça histórica, mas também de sobrevivência ecológica: são esses povos que protegem boa parte da biodiversidade do planeta." (AILTON KRENAK, adaptado).',
    sourceUrl: 'https://www.gov.br/inep/pt-br/areas-de-atuacao/avaliacao-e-exames-educacionais/enem',
  },
  {
    year: 2021,
    title: 'Invisibilidade e registro civil: garantia de acesso à cidadania no Brasil',
    prompt:
      'A partir da leitura dos textos motivadores e com base nos conhecimentos construídos ao longo de sua formação, redija texto dissertativo-argumentativo em modalidade escrita formal da língua portuguesa sobre o tema "Invisibilidade e registro civil: garantia de acesso à cidadania no Brasil", apresentando proposta de intervenção que respeite os direitos humanos. Selecione, organize e relacione, de forma coerente e coesa, argumentos e fatos para defesa de seu ponto de vista.',
    supportTexts:
      'TEXTO I — De acordo com o IBGE (2019), aproximadamente 2,7% das crianças brasileiras menores de 10 anos não possuem certidão de nascimento, o que as exclui de direitos básicos como educação, saúde e benefícios sociais.\n\nTEXTO II — A Lei nº 9.534/1997 garante a gratuidade do registro civil de nascimento e do assento de óbito, bem como da primeira certidão correspondente, para todos os cidadãos.\n\nTEXTO III — O sub-registro é mais elevado nas regiões Norte e Nordeste e atinge desproporcionalmente populações indígenas, quilombolas e em situação de rua.\n\nTEXTO IV — Excerto: "Sem documento, a pessoa existe biologicamente, mas não juridicamente. É como se ela fosse invisível para o Estado e, portanto, sem acesso a direitos básicos." (Defensoria Pública da União, adaptado).',
    sourceUrl: 'https://www.gov.br/inep/pt-br/areas-de-atuacao/avaliacao-e-exames-educacionais/enem',
  },
  {
    year: 2020,
    title: 'O estigma associado às doenças mentais na sociedade brasileira',
    prompt:
      'A partir da leitura dos textos motivadores e com base nos conhecimentos construídos ao longo de sua formação, redija texto dissertativo-argumentativo em modalidade escrita formal da língua portuguesa sobre o tema "O estigma associado às doenças mentais na sociedade brasileira", apresentando proposta de intervenção que respeite os direitos humanos. Selecione, organize e relacione, de forma coerente e coesa, argumentos e fatos para defesa de seu ponto de vista.',
    supportTexts:
      'TEXTO I — Segundo a Organização Mundial da Saúde (OMS), o Brasil é o país com maior prevalência de transtornos de ansiedade no mundo (9,3% da população) e o quinto em casos de depressão.\n\nTEXTO II — A Lei nº 10.216/2001 (Lei da Reforma Psiquiátrica) redirecionou o modelo assistencial em saúde mental, priorizando o tratamento em serviços comunitários (CAPS) em vez de hospitais psiquiátricos.\n\nTEXTO III — Pesquisa do Instituto Ipsos (2019) aponta que 53% dos brasileiros já se sentiram constrangidos para falar sobre problemas de saúde mental, e 41% afirmam que conhecem alguém que evitou buscar ajuda por medo do julgamento.\n\nTEXTO IV — Excerto: "O estigma é a segunda doença. Quando a pessoa adoece e ainda precisa lidar com o preconceito alheio, o sofrimento se duplica e a recuperação se torna muito mais difícil." (DRAUZIO VARELLA, adaptado).',
    sourceUrl: 'https://www.gov.br/inep/pt-br/areas-de-atuacao/avaliacao-e-exames-educacionais/enem',
  },
  {
    year: 2019,
    title: 'Democratização do acesso ao cinema no Brasil',
    prompt:
      'A partir da leitura dos textos motivadores e com base nos conhecimentos construídos ao longo de sua formação, redija texto dissertativo-argumentativo em modalidade escrita formal da língua portuguesa sobre o tema "Democratização do acesso ao cinema no Brasil", apresentando proposta de intervenção que respeite os direitos humanos. Selecione, organize e relacione, de forma coerente e coesa, argumentos e fatos para defesa de seu ponto de vista.',
    supportTexts:
      'TEXTO I — Dados da ANCINE (2018) revelam que apenas 8% dos municípios brasileiros possuem ao menos uma sala de cinema, o que concentra o acesso à sétima arte em capitais e grandes centros urbanos.\n\nTEXTO II — O ingresso médio de cinema no Brasil custa R$ 17,00, valor superior a 2% do salário mínimo, o que torna a frequência regular inacessível para parte significativa da população.\n\nTEXTO III — A Lei nº 8.685/1993 (Lei do Audiovisual) e a criação da ANCINE em 2001 buscaram fomentar a produção nacional, mas a distribuição e exibição permanecem dominadas por grandes redes em shoppings.\n\nTEXTO IV — Excerto: "O cinema é uma das principais formas de expressão cultural contemporânea. Negar acesso a ele é negar acesso a uma forma de leitura crítica do mundo." (CACÁ DIEGUES, adaptado).',
    sourceUrl: 'https://www.gov.br/inep/pt-br/areas-de-atuacao/avaliacao-e-exames-educacionais/enem',
  },
  {
    year: 2018,
    title: 'Manipulação do comportamento do usuário pelo controle de dados na internet',
    prompt:
      'A partir da leitura dos textos motivadores e com base nos conhecimentos construídos ao longo de sua formação, redija texto dissertativo-argumentativo em modalidade escrita formal da língua portuguesa sobre o tema "Manipulação do comportamento do usuário pelo controle de dados na internet", apresentando proposta de intervenção que respeite os direitos humanos. Selecione, organize e relacione, de forma coerente e coesa, argumentos e fatos para defesa de seu ponto de vista.',
    supportTexts:
      'TEXTO I — O escândalo Cambridge Analytica (2018) revelou que dados de mais de 87 milhões de usuários do Facebook foram coletados sem consentimento e usados para influenciar eleições nos Estados Unidos e em outros países.\n\nTEXTO II — A Lei Geral de Proteção de Dados Pessoais (LGPD — Lei nº 13.709/2018) estabelece regras para o tratamento de dados pessoais por entidades públicas e privadas no Brasil.\n\nTEXTO III — Algoritmos de redes sociais e plataformas de busca personalizam conteúdo com base no histórico do usuário, criando "bolhas informacionais" que reforçam vieses e podem distorcer a percepção da realidade.\n\nTEXTO IV — Excerto: "Quando o serviço é gratuito, o produto é você. Os dados que entregamos diariamente são a moeda de troca de uma economia da atenção que molda nossas escolhas sem que percebamos." (SHOSHANA ZUBOFF, adaptado).',
    sourceUrl: 'https://www.gov.br/inep/pt-br/areas-de-atuacao/avaliacao-e-exames-educacionais/enem',
  },
  {
    year: 2017,
    title: 'Desafios para a formação educacional de surdos no Brasil',
    prompt:
      'A partir da leitura dos textos motivadores e com base nos conhecimentos construídos ao longo de sua formação, redija texto dissertativo-argumentativo em modalidade escrita formal da língua portuguesa sobre o tema "Desafios para a formação educacional de surdos no Brasil", apresentando proposta de intervenção que respeite os direitos humanos. Selecione, organize e relacione, de forma coerente e coesa, argumentos e fatos para defesa de seu ponto de vista.',
    supportTexts:
      'TEXTO I — A Lei nº 10.436/2002 reconhece a Língua Brasileira de Sinais (Libras) como meio legal de comunicação e expressão da comunidade surda brasileira. O Decreto nº 5.626/2005 regulamenta sua presença nos currículos escolares.\n\nTEXTO II — Segundo o Censo Escolar/INEP (2016), apenas 21% das escolas brasileiras possuem profissionais com formação em Libras ou tradutores-intérpretes para atender estudantes surdos.\n\nTEXTO III — Pesquisa do IBGE (2010) registrou cerca de 9,7 milhões de brasileiros com algum grau de deficiência auditiva, dos quais 2,1 milhões com surdez severa ou profunda.\n\nTEXTO IV — Excerto: "A escola inclusiva não é a que recebe o aluno surdo na sala comum sem mais — é a que reconhece a Libras como primeira língua e o português escrito como segunda, organizando o ensino a partir dessa premissa." (RONICE QUADROS, adaptado).',
    sourceUrl: 'https://www.gov.br/inep/pt-br/areas-de-atuacao/avaliacao-e-exames-educacionais/enem',
  },
  {
    year: 2016,
    title: 'Caminhos para combater a intolerância religiosa no Brasil',
    prompt:
      'A partir da leitura dos textos motivadores e com base nos conhecimentos construídos ao longo de sua formação, redija texto dissertativo-argumentativo em modalidade escrita formal da língua portuguesa sobre o tema "Caminhos para combater a intolerância religiosa no Brasil", apresentando proposta de intervenção que respeite os direitos humanos. Selecione, organize e relacione, de forma coerente e coesa, argumentos e fatos para defesa de seu ponto de vista.',
    supportTexts:
      'TEXTO I — A Constituição Federal de 1988, em seu artigo 5º, inciso VI, garante a liberdade de consciência e de crença, sendo assegurado o livre exercício dos cultos religiosos.\n\nTEXTO II — Dados da Secretaria Nacional de Direitos Humanos apontam crescimento expressivo de denúncias de intolerância religiosa via Disque 100 nos últimos anos, com a maioria dos casos atingindo religiões de matriz africana.\n\nTEXTO III — A Lei nº 7.716/1989 tipifica como crime os atos de discriminação ou preconceito por motivo de religião, com pena de reclusão de um a três anos.\n\nTEXTO IV — Excerto: "A intolerância religiosa no Brasil tem cor e tem endereço: ataca preferencialmente terreiros de candomblé e umbanda, expressões legítimas da cultura afro-brasileira que ainda lutam por reconhecimento como religiões, e não como folclore." (BABÁ DIBA DE IYEMONJÁ, adaptado).',
    sourceUrl: 'https://www.gov.br/inep/pt-br/areas-de-atuacao/avaliacao-e-exames-educacionais/enem',
  },
  {
    year: 2015,
    title: 'A persistência da violência contra a mulher na sociedade brasileira',
    prompt:
      'A partir da leitura dos textos motivadores e com base nos conhecimentos construídos ao longo de sua formação, redija texto dissertativo-argumentativo em modalidade escrita formal da língua portuguesa sobre o tema "A persistência da violência contra a mulher na sociedade brasileira", apresentando proposta de intervenção que respeite os direitos humanos. Selecione, organize e relacione, de forma coerente e coesa, argumentos e fatos para defesa de seu ponto de vista.',
    supportTexts:
      'TEXTO I — A Lei nº 11.340/2006 (Lei Maria da Penha) cria mecanismos para coibir a violência doméstica e familiar contra a mulher, prevendo medidas protetivas de urgência e atendimento especializado.\n\nTEXTO II — A Lei nº 13.104/2015 incluiu o feminicídio no rol de crimes hediondos, qualificando o homicídio praticado contra a mulher por razões da condição de sexo feminino.\n\nTEXTO III — Pesquisa do Instituto DataFolha (2015) revela que uma em cada três brasileiras com mais de 16 anos já sofreu algum tipo de violência (física, verbal, psicológica ou sexual).\n\nTEXTO IV — Excerto: "Enquanto a sociedade culpabilizar a vítima por suas roupas, seus comportamentos ou seus relacionamentos, e enquanto o Estado não garantir acolhimento e responsabilização efetiva, a violência continuará sendo banalizada." (DEBORA DINIZ, adaptado).',
    sourceUrl: 'https://www.gov.br/inep/pt-br/areas-de-atuacao/avaliacao-e-exames-educacionais/enem',
  },
]
