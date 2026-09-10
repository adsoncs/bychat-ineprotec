// src/lib/countryCodes.ts
//
// Tabela de DDIs (E.164) — para reconhecer que um telefone é de OUTRO PAÍS.
//
// Existe por causa da Marcia, mãe de aluna do severiano (lead 335): o número
// dela é +1 (689) 206-4057, da Flórida. Sem DDI declarado, "16892064057" tem 11
// dígitos — o mesmo tamanho de um celular brasileiro sem o 55 — e a
// normalização o adotava como BR: DDD "16", número "892064057", chave
// `5516892064057`. Esse número não existe em lugar nenhum, então em 10/09/2026
// o operador tomou onze vezes seguidas "O número 5516892064057 não tem
// WhatsApp. Confira o telefone no cadastro do contato." numa conversa que
// estava acontecendo.
//
// O que separa os dois casos é a ESTRUTURA, não o tamanho: celular brasileiro
// de 11 dígitos tem o 9 obrigatório depois do DDD, e o DDD vem de uma lista
// fechada de 67 valores. "16 8 9206-4057" reprova nas duas regras; "1 689
// 206-4057" é um NANP perfeito. Daí a decisão poder ser tomada sozinha, sem
// pedir nada ao operador.
//
// A tabela guarda, por DDI, o comprimento do número NACIONAL (NSN, sem o DDI).
// É o que permite dizer "este bloco de dígitos é um telefone de tal país" e,
// principalmente, o que separa telefone internacional de LID do WhatsApp — que
// também é um bloco comprido de dígitos, mas não casa com DDI + NSN de país
// nenhum.
//
// Fonte dos comprimentos: recomendação E.164 da ITU (planos de numeração
// nacionais). Onde o país tem faixas de tamanhos diferentes (fixo curto,
// celular longo), a faixa cobre os dois.

export interface Pais {
  /** Código de discagem internacional, sem "+". */
  ddi: string
  /** ISO 3166-1 alpha-2. */
  iso: string
  /** Nome em português. */
  nome: string
  /** Menor comprimento do número nacional (sem DDI). */
  nsnMin: number
  /** Maior comprimento do número nacional (sem DDI). */
  nsnMax: number
  /**
   * Validação ESTRUTURAL do número nacional, além do comprimento — só existe
   * onde o plano do país é rígido o bastante para servir de prova.
   *
   * É o que separa "telefone americano" de "telefone brasileiro truncado com
   * 11 dígitos": no NANP, código de área e central começam obrigatoriamente em
   * 2-9, então "3301130005" (central "113") não é um número americano, é lixo
   * — e sem esta regra viraria um contato dos Estados Unidos.
   */
  estrutura?: (nsn: string) => boolean
}

/**
 * Todos os DDIs atribuídos. Onde vários países dividem o mesmo código (NANP,
 * Rússia/Cazaquistão), aparece uma linha só — a desambiguação fina fica em
 * `NANP_POR_AREA`, que é o único caso em que o país importa para o operador.
 */
export const PAISES: readonly Pais[] = [
  // ── Zona 1 — Plano de Numeração da América do Norte ──────────────────────
  {
    ddi: '1',
    iso: 'US',
    nome: 'Estados Unidos/Canadá',
    nsnMin: 10,
    nsnMax: 10,
    // NPA (área) e NXX (central) começam em 2-9; nenhum dos dois pode ser N11.
    estrutura: (nsn) => /^[2-9]\d{2}[2-9]\d{6}$/.test(nsn) && !/^\d11/.test(nsn),
  },

  // ── Zona 2 — África ──────────────────────────────────────────────────────
  { ddi: '20', iso: 'EG', nome: 'Egito', nsnMin: 9, nsnMax: 10 },
  { ddi: '211', iso: 'SS', nome: 'Sudão do Sul', nsnMin: 9, nsnMax: 9 },
  { ddi: '212', iso: 'MA', nome: 'Marrocos', nsnMin: 9, nsnMax: 9 },
  { ddi: '213', iso: 'DZ', nome: 'Argélia', nsnMin: 9, nsnMax: 9 },
  { ddi: '216', iso: 'TN', nome: 'Tunísia', nsnMin: 8, nsnMax: 8 },
  { ddi: '218', iso: 'LY', nome: 'Líbia', nsnMin: 9, nsnMax: 10 },
  { ddi: '220', iso: 'GM', nome: 'Gâmbia', nsnMin: 7, nsnMax: 7 },
  { ddi: '221', iso: 'SN', nome: 'Senegal', nsnMin: 9, nsnMax: 9 },
  { ddi: '222', iso: 'MR', nome: 'Mauritânia', nsnMin: 8, nsnMax: 8 },
  { ddi: '223', iso: 'ML', nome: 'Mali', nsnMin: 8, nsnMax: 8 },
  { ddi: '224', iso: 'GN', nome: 'Guiné', nsnMin: 8, nsnMax: 9 },
  { ddi: '225', iso: 'CI', nome: 'Costa do Marfim', nsnMin: 8, nsnMax: 10 },
  { ddi: '226', iso: 'BF', nome: 'Burkina Faso', nsnMin: 8, nsnMax: 8 },
  { ddi: '227', iso: 'NE', nome: 'Níger', nsnMin: 8, nsnMax: 8 },
  { ddi: '228', iso: 'TG', nome: 'Togo', nsnMin: 8, nsnMax: 8 },
  { ddi: '229', iso: 'BJ', nome: 'Benim', nsnMin: 8, nsnMax: 10 },
  { ddi: '230', iso: 'MU', nome: 'Maurício', nsnMin: 7, nsnMax: 8 },
  { ddi: '231', iso: 'LR', nome: 'Libéria', nsnMin: 7, nsnMax: 9 },
  { ddi: '232', iso: 'SL', nome: 'Serra Leoa', nsnMin: 8, nsnMax: 8 },
  { ddi: '233', iso: 'GH', nome: 'Gana', nsnMin: 9, nsnMax: 9 },
  { ddi: '234', iso: 'NG', nome: 'Nigéria', nsnMin: 8, nsnMax: 10 },
  { ddi: '235', iso: 'TD', nome: 'Chade', nsnMin: 8, nsnMax: 8 },
  { ddi: '236', iso: 'CF', nome: 'República Centro-Africana', nsnMin: 8, nsnMax: 8 },
  { ddi: '237', iso: 'CM', nome: 'Camarões', nsnMin: 9, nsnMax: 9 },
  { ddi: '238', iso: 'CV', nome: 'Cabo Verde', nsnMin: 7, nsnMax: 7 },
  { ddi: '239', iso: 'ST', nome: 'São Tomé e Príncipe', nsnMin: 7, nsnMax: 7 },
  { ddi: '240', iso: 'GQ', nome: 'Guiné Equatorial', nsnMin: 9, nsnMax: 9 },
  { ddi: '241', iso: 'GA', nome: 'Gabão', nsnMin: 7, nsnMax: 8 },
  { ddi: '242', iso: 'CG', nome: 'Congo', nsnMin: 9, nsnMax: 9 },
  { ddi: '243', iso: 'CD', nome: 'República Democrática do Congo', nsnMin: 9, nsnMax: 9 },
  { ddi: '244', iso: 'AO', nome: 'Angola', nsnMin: 9, nsnMax: 9 },
  { ddi: '245', iso: 'GW', nome: 'Guiné-Bissau', nsnMin: 7, nsnMax: 7 },
  { ddi: '246', iso: 'IO', nome: 'Diego Garcia', nsnMin: 7, nsnMax: 7 },
  { ddi: '247', iso: 'AC', nome: 'Ilha de Ascensão', nsnMin: 4, nsnMax: 5 },
  { ddi: '248', iso: 'SC', nome: 'Seicheles', nsnMin: 7, nsnMax: 7 },
  { ddi: '249', iso: 'SD', nome: 'Sudão', nsnMin: 9, nsnMax: 9 },
  { ddi: '250', iso: 'RW', nome: 'Ruanda', nsnMin: 9, nsnMax: 9 },
  { ddi: '251', iso: 'ET', nome: 'Etiópia', nsnMin: 9, nsnMax: 9 },
  { ddi: '252', iso: 'SO', nome: 'Somália', nsnMin: 7, nsnMax: 9 },
  { ddi: '253', iso: 'DJ', nome: 'Djibuti', nsnMin: 8, nsnMax: 8 },
  { ddi: '254', iso: 'KE', nome: 'Quênia', nsnMin: 9, nsnMax: 10 },
  { ddi: '255', iso: 'TZ', nome: 'Tanzânia', nsnMin: 9, nsnMax: 9 },
  { ddi: '256', iso: 'UG', nome: 'Uganda', nsnMin: 9, nsnMax: 9 },
  { ddi: '257', iso: 'BI', nome: 'Burundi', nsnMin: 8, nsnMax: 8 },
  { ddi: '258', iso: 'MZ', nome: 'Moçambique', nsnMin: 8, nsnMax: 9 },
  { ddi: '260', iso: 'ZM', nome: 'Zâmbia', nsnMin: 9, nsnMax: 9 },
  { ddi: '261', iso: 'MG', nome: 'Madagascar', nsnMin: 9, nsnMax: 9 },
  { ddi: '262', iso: 'RE', nome: 'Reunião/Mayotte', nsnMin: 9, nsnMax: 9 },
  { ddi: '263', iso: 'ZW', nome: 'Zimbábue', nsnMin: 9, nsnMax: 9 },
  { ddi: '264', iso: 'NA', nome: 'Namíbia', nsnMin: 8, nsnMax: 9 },
  { ddi: '265', iso: 'MW', nome: 'Malaui', nsnMin: 7, nsnMax: 9 },
  { ddi: '266', iso: 'LS', nome: 'Lesoto', nsnMin: 8, nsnMax: 8 },
  { ddi: '267', iso: 'BW', nome: 'Botsuana', nsnMin: 7, nsnMax: 8 },
  { ddi: '268', iso: 'SZ', nome: 'Essuatíni', nsnMin: 8, nsnMax: 8 },
  { ddi: '269', iso: 'KM', nome: 'Comores', nsnMin: 7, nsnMax: 7 },
  { ddi: '27', iso: 'ZA', nome: 'África do Sul', nsnMin: 9, nsnMax: 9 },
  { ddi: '290', iso: 'SH', nome: 'Santa Helena', nsnMin: 4, nsnMax: 5 },
  { ddi: '291', iso: 'ER', nome: 'Eritreia', nsnMin: 7, nsnMax: 7 },
  { ddi: '297', iso: 'AW', nome: 'Aruba', nsnMin: 7, nsnMax: 7 },
  { ddi: '298', iso: 'FO', nome: 'Ilhas Faroé', nsnMin: 6, nsnMax: 6 },
  { ddi: '299', iso: 'GL', nome: 'Groenlândia', nsnMin: 6, nsnMax: 6 },

  // ── Zonas 3 e 4 — Europa ─────────────────────────────────────────────────
  { ddi: '30', iso: 'GR', nome: 'Grécia', nsnMin: 10, nsnMax: 10 },
  { ddi: '31', iso: 'NL', nome: 'Países Baixos', nsnMin: 9, nsnMax: 9 },
  { ddi: '32', iso: 'BE', nome: 'Bélgica', nsnMin: 8, nsnMax: 9 },
  { ddi: '33', iso: 'FR', nome: 'França', nsnMin: 9, nsnMax: 9 },
  { ddi: '34', iso: 'ES', nome: 'Espanha', nsnMin: 9, nsnMax: 9 },
  { ddi: '350', iso: 'GI', nome: 'Gibraltar', nsnMin: 8, nsnMax: 8 },
  { ddi: '351', iso: 'PT', nome: 'Portugal', nsnMin: 9, nsnMax: 9 },
  { ddi: '352', iso: 'LU', nome: 'Luxemburgo', nsnMin: 6, nsnMax: 9 },
  { ddi: '353', iso: 'IE', nome: 'Irlanda', nsnMin: 7, nsnMax: 9 },
  { ddi: '354', iso: 'IS', nome: 'Islândia', nsnMin: 7, nsnMax: 9 },
  { ddi: '355', iso: 'AL', nome: 'Albânia', nsnMin: 8, nsnMax: 9 },
  { ddi: '356', iso: 'MT', nome: 'Malta', nsnMin: 8, nsnMax: 8 },
  { ddi: '357', iso: 'CY', nome: 'Chipre', nsnMin: 8, nsnMax: 8 },
  { ddi: '358', iso: 'FI', nome: 'Finlândia', nsnMin: 6, nsnMax: 10 },
  { ddi: '359', iso: 'BG', nome: 'Bulgária', nsnMin: 8, nsnMax: 9 },
  { ddi: '36', iso: 'HU', nome: 'Hungria', nsnMin: 8, nsnMax: 9 },
  { ddi: '370', iso: 'LT', nome: 'Lituânia', nsnMin: 8, nsnMax: 8 },
  { ddi: '371', iso: 'LV', nome: 'Letônia', nsnMin: 8, nsnMax: 8 },
  { ddi: '372', iso: 'EE', nome: 'Estônia', nsnMin: 7, nsnMax: 8 },
  { ddi: '373', iso: 'MD', nome: 'Moldávia', nsnMin: 8, nsnMax: 8 },
  { ddi: '374', iso: 'AM', nome: 'Armênia', nsnMin: 8, nsnMax: 8 },
  { ddi: '375', iso: 'BY', nome: 'Belarus', nsnMin: 9, nsnMax: 9 },
  { ddi: '376', iso: 'AD', nome: 'Andorra', nsnMin: 6, nsnMax: 6 },
  { ddi: '377', iso: 'MC', nome: 'Mônaco', nsnMin: 8, nsnMax: 9 },
  { ddi: '378', iso: 'SM', nome: 'San Marino', nsnMin: 8, nsnMax: 10 },
  { ddi: '380', iso: 'UA', nome: 'Ucrânia', nsnMin: 9, nsnMax: 9 },
  { ddi: '381', iso: 'RS', nome: 'Sérvia', nsnMin: 8, nsnMax: 9 },
  { ddi: '382', iso: 'ME', nome: 'Montenegro', nsnMin: 8, nsnMax: 8 },
  { ddi: '383', iso: 'XK', nome: 'Kosovo', nsnMin: 8, nsnMax: 8 },
  { ddi: '385', iso: 'HR', nome: 'Croácia', nsnMin: 8, nsnMax: 9 },
  { ddi: '386', iso: 'SI', nome: 'Eslovênia', nsnMin: 8, nsnMax: 8 },
  { ddi: '387', iso: 'BA', nome: 'Bósnia e Herzegovina', nsnMin: 8, nsnMax: 8 },
  { ddi: '389', iso: 'MK', nome: 'Macedônia do Norte', nsnMin: 8, nsnMax: 8 },
  { ddi: '39', iso: 'IT', nome: 'Itália', nsnMin: 6, nsnMax: 11 },
  { ddi: '40', iso: 'RO', nome: 'Romênia', nsnMin: 9, nsnMax: 9 },
  { ddi: '41', iso: 'CH', nome: 'Suíça', nsnMin: 9, nsnMax: 9 },
  { ddi: '420', iso: 'CZ', nome: 'Chéquia', nsnMin: 9, nsnMax: 9 },
  { ddi: '421', iso: 'SK', nome: 'Eslováquia', nsnMin: 9, nsnMax: 9 },
  { ddi: '423', iso: 'LI', nome: 'Liechtenstein', nsnMin: 7, nsnMax: 9 },
  { ddi: '43', iso: 'AT', nome: 'Áustria', nsnMin: 8, nsnMax: 13 },
  { ddi: '44', iso: 'GB', nome: 'Reino Unido', nsnMin: 9, nsnMax: 10 },
  { ddi: '45', iso: 'DK', nome: 'Dinamarca', nsnMin: 8, nsnMax: 8 },
  { ddi: '46', iso: 'SE', nome: 'Suécia', nsnMin: 7, nsnMax: 9 },
  { ddi: '47', iso: 'NO', nome: 'Noruega', nsnMin: 8, nsnMax: 8 },
  { ddi: '48', iso: 'PL', nome: 'Polônia', nsnMin: 9, nsnMax: 9 },
  { ddi: '49', iso: 'DE', nome: 'Alemanha', nsnMin: 7, nsnMax: 11 },

  // ── Zona 5 — América Latina ──────────────────────────────────────────────
  { ddi: '500', iso: 'FK', nome: 'Ilhas Malvinas', nsnMin: 5, nsnMax: 5 },
  { ddi: '501', iso: 'BZ', nome: 'Belize', nsnMin: 7, nsnMax: 7 },
  { ddi: '502', iso: 'GT', nome: 'Guatemala', nsnMin: 8, nsnMax: 8 },
  { ddi: '503', iso: 'SV', nome: 'El Salvador', nsnMin: 8, nsnMax: 8 },
  { ddi: '504', iso: 'HN', nome: 'Honduras', nsnMin: 8, nsnMax: 8 },
  { ddi: '505', iso: 'NI', nome: 'Nicarágua', nsnMin: 8, nsnMax: 8 },
  { ddi: '506', iso: 'CR', nome: 'Costa Rica', nsnMin: 8, nsnMax: 8 },
  { ddi: '507', iso: 'PA', nome: 'Panamá', nsnMin: 7, nsnMax: 8 },
  { ddi: '508', iso: 'PM', nome: 'São Pedro e Miquelão', nsnMin: 6, nsnMax: 6 },
  { ddi: '509', iso: 'HT', nome: 'Haiti', nsnMin: 8, nsnMax: 8 },
  { ddi: '51', iso: 'PE', nome: 'Peru', nsnMin: 8, nsnMax: 9 },
  { ddi: '52', iso: 'MX', nome: 'México', nsnMin: 10, nsnMax: 11 },
  { ddi: '53', iso: 'CU', nome: 'Cuba', nsnMin: 6, nsnMax: 8 },
  { ddi: '54', iso: 'AR', nome: 'Argentina', nsnMin: 10, nsnMax: 11 },
  { ddi: '55', iso: 'BR', nome: 'Brasil', nsnMin: 10, nsnMax: 11 },
  { ddi: '56', iso: 'CL', nome: 'Chile', nsnMin: 9, nsnMax: 9 },
  { ddi: '57', iso: 'CO', nome: 'Colômbia', nsnMin: 10, nsnMax: 10 },
  { ddi: '58', iso: 'VE', nome: 'Venezuela', nsnMin: 10, nsnMax: 10 },
  { ddi: '590', iso: 'GP', nome: 'Guadalupe', nsnMin: 9, nsnMax: 9 },
  { ddi: '591', iso: 'BO', nome: 'Bolívia', nsnMin: 8, nsnMax: 8 },
  { ddi: '592', iso: 'GY', nome: 'Guiana', nsnMin: 7, nsnMax: 7 },
  { ddi: '593', iso: 'EC', nome: 'Equador', nsnMin: 8, nsnMax: 9 },
  { ddi: '594', iso: 'GF', nome: 'Guiana Francesa', nsnMin: 9, nsnMax: 9 },
  { ddi: '595', iso: 'PY', nome: 'Paraguai', nsnMin: 9, nsnMax: 9 },
  { ddi: '596', iso: 'MQ', nome: 'Martinica', nsnMin: 9, nsnMax: 9 },
  { ddi: '597', iso: 'SR', nome: 'Suriname', nsnMin: 6, nsnMax: 7 },
  { ddi: '598', iso: 'UY', nome: 'Uruguai', nsnMin: 8, nsnMax: 8 },
  { ddi: '599', iso: 'CW', nome: 'Curaçao/Caribe Neerlandês', nsnMin: 7, nsnMax: 8 },

  // ── Zona 6 — Sudeste Asiático e Oceania ──────────────────────────────────
  { ddi: '60', iso: 'MY', nome: 'Malásia', nsnMin: 7, nsnMax: 9 },
  { ddi: '61', iso: 'AU', nome: 'Austrália', nsnMin: 9, nsnMax: 9 },
  { ddi: '62', iso: 'ID', nome: 'Indonésia', nsnMin: 8, nsnMax: 11 },
  { ddi: '63', iso: 'PH', nome: 'Filipinas', nsnMin: 10, nsnMax: 10 },
  { ddi: '64', iso: 'NZ', nome: 'Nova Zelândia', nsnMin: 8, nsnMax: 10 },
  { ddi: '65', iso: 'SG', nome: 'Singapura', nsnMin: 8, nsnMax: 8 },
  { ddi: '66', iso: 'TH', nome: 'Tailândia', nsnMin: 9, nsnMax: 9 },
  { ddi: '670', iso: 'TL', nome: 'Timor-Leste', nsnMin: 7, nsnMax: 8 },
  { ddi: '672', iso: 'NF', nome: 'Ilha Norfolk', nsnMin: 6, nsnMax: 6 },
  { ddi: '673', iso: 'BN', nome: 'Brunei', nsnMin: 7, nsnMax: 7 },
  { ddi: '674', iso: 'NR', nome: 'Nauru', nsnMin: 7, nsnMax: 7 },
  { ddi: '675', iso: 'PG', nome: 'Papua-Nova Guiné', nsnMin: 8, nsnMax: 8 },
  { ddi: '676', iso: 'TO', nome: 'Tonga', nsnMin: 5, nsnMax: 7 },
  { ddi: '677', iso: 'SB', nome: 'Ilhas Salomão', nsnMin: 5, nsnMax: 7 },
  { ddi: '678', iso: 'VU', nome: 'Vanuatu', nsnMin: 5, nsnMax: 7 },
  { ddi: '679', iso: 'FJ', nome: 'Fiji', nsnMin: 7, nsnMax: 7 },
  { ddi: '680', iso: 'PW', nome: 'Palau', nsnMin: 7, nsnMax: 7 },
  { ddi: '681', iso: 'WF', nome: 'Wallis e Futuna', nsnMin: 6, nsnMax: 6 },
  { ddi: '682', iso: 'CK', nome: 'Ilhas Cook', nsnMin: 5, nsnMax: 5 },
  { ddi: '683', iso: 'NU', nome: 'Niue', nsnMin: 4, nsnMax: 4 },
  { ddi: '685', iso: 'WS', nome: 'Samoa', nsnMin: 5, nsnMax: 7 },
  { ddi: '686', iso: 'KI', nome: 'Quiribati', nsnMin: 5, nsnMax: 8 },
  { ddi: '687', iso: 'NC', nome: 'Nova Caledônia', nsnMin: 6, nsnMax: 6 },
  { ddi: '688', iso: 'TV', nome: 'Tuvalu', nsnMin: 5, nsnMax: 6 },
  { ddi: '689', iso: 'PF', nome: 'Polinésia Francesa', nsnMin: 6, nsnMax: 8 },
  { ddi: '690', iso: 'TK', nome: 'Toquelau', nsnMin: 4, nsnMax: 5 },
  { ddi: '691', iso: 'FM', nome: 'Micronésia', nsnMin: 7, nsnMax: 7 },
  { ddi: '692', iso: 'MH', nome: 'Ilhas Marshall', nsnMin: 7, nsnMax: 7 },

  // ── Zona 7 — Rússia e Cazaquistão ────────────────────────────────────────
  { ddi: '7', iso: 'RU', nome: 'Rússia/Cazaquistão', nsnMin: 10, nsnMax: 10 },

  // ── Zona 8 — Ásia Oriental ───────────────────────────────────────────────
  { ddi: '81', iso: 'JP', nome: 'Japão', nsnMin: 9, nsnMax: 10 },
  { ddi: '82', iso: 'KR', nome: 'Coreia do Sul', nsnMin: 8, nsnMax: 10 },
  { ddi: '84', iso: 'VN', nome: 'Vietnã', nsnMin: 9, nsnMax: 10 },
  { ddi: '850', iso: 'KP', nome: 'Coreia do Norte', nsnMin: 8, nsnMax: 10 },
  { ddi: '852', iso: 'HK', nome: 'Hong Kong', nsnMin: 8, nsnMax: 8 },
  { ddi: '853', iso: 'MO', nome: 'Macau', nsnMin: 8, nsnMax: 8 },
  { ddi: '855', iso: 'KH', nome: 'Camboja', nsnMin: 8, nsnMax: 9 },
  { ddi: '856', iso: 'LA', nome: 'Laos', nsnMin: 8, nsnMax: 10 },
  { ddi: '86', iso: 'CN', nome: 'China', nsnMin: 8, nsnMax: 11 },
  { ddi: '880', iso: 'BD', nome: 'Bangladesh', nsnMin: 8, nsnMax: 10 },
  { ddi: '886', iso: 'TW', nome: 'Taiwan', nsnMin: 8, nsnMax: 9 },

  // ── Zona 9 — Ásia Ocidental e do Sul ─────────────────────────────────────
  { ddi: '90', iso: 'TR', nome: 'Turquia', nsnMin: 10, nsnMax: 10 },
  { ddi: '91', iso: 'IN', nome: 'Índia', nsnMin: 10, nsnMax: 10 },
  { ddi: '92', iso: 'PK', nome: 'Paquistão', nsnMin: 10, nsnMax: 10 },
  { ddi: '93', iso: 'AF', nome: 'Afeganistão', nsnMin: 9, nsnMax: 9 },
  { ddi: '94', iso: 'LK', nome: 'Sri Lanka', nsnMin: 9, nsnMax: 9 },
  { ddi: '95', iso: 'MM', nome: 'Mianmar', nsnMin: 8, nsnMax: 10 },
  { ddi: '960', iso: 'MV', nome: 'Maldivas', nsnMin: 7, nsnMax: 7 },
  { ddi: '961', iso: 'LB', nome: 'Líbano', nsnMin: 7, nsnMax: 8 },
  { ddi: '962', iso: 'JO', nome: 'Jordânia', nsnMin: 8, nsnMax: 9 },
  { ddi: '963', iso: 'SY', nome: 'Síria', nsnMin: 8, nsnMax: 9 },
  { ddi: '964', iso: 'IQ', nome: 'Iraque', nsnMin: 9, nsnMax: 10 },
  { ddi: '965', iso: 'KW', nome: 'Kuwait', nsnMin: 8, nsnMax: 8 },
  { ddi: '966', iso: 'SA', nome: 'Arábia Saudita', nsnMin: 8, nsnMax: 9 },
  { ddi: '967', iso: 'YE', nome: 'Iêmen', nsnMin: 7, nsnMax: 9 },
  { ddi: '968', iso: 'OM', nome: 'Omã', nsnMin: 8, nsnMax: 8 },
  { ddi: '970', iso: 'PS', nome: 'Palestina', nsnMin: 8, nsnMax: 9 },
  { ddi: '971', iso: 'AE', nome: 'Emirados Árabes Unidos', nsnMin: 8, nsnMax: 9 },
  { ddi: '972', iso: 'IL', nome: 'Israel', nsnMin: 8, nsnMax: 9 },
  { ddi: '973', iso: 'BH', nome: 'Bahrein', nsnMin: 8, nsnMax: 8 },
  { ddi: '974', iso: 'QA', nome: 'Catar', nsnMin: 8, nsnMax: 8 },
  { ddi: '975', iso: 'BT', nome: 'Butão', nsnMin: 7, nsnMax: 8 },
  { ddi: '976', iso: 'MN', nome: 'Mongólia', nsnMin: 8, nsnMax: 8 },
  { ddi: '977', iso: 'NP', nome: 'Nepal', nsnMin: 8, nsnMax: 10 },
  { ddi: '98', iso: 'IR', nome: 'Irã', nsnMin: 10, nsnMax: 10 },
  { ddi: '992', iso: 'TJ', nome: 'Tajiquistão', nsnMin: 9, nsnMax: 9 },
  { ddi: '993', iso: 'TM', nome: 'Turcomenistão', nsnMin: 8, nsnMax: 8 },
  { ddi: '994', iso: 'AZ', nome: 'Azerbaijão', nsnMin: 9, nsnMax: 9 },
  { ddi: '995', iso: 'GE', nome: 'Geórgia', nsnMin: 9, nsnMax: 9 },
  { ddi: '996', iso: 'KG', nome: 'Quirguistão', nsnMin: 9, nsnMax: 9 },
  { ddi: '998', iso: 'UZ', nome: 'Uzbequistão', nsnMin: 9, nsnMax: 9 },
]

/**
 * Códigos de área do NANP (DDI 1) que NÃO são Estados Unidos nem Canadá.
 *
 * Serve só para dar o nome certo ao operador: um WhatsApp +1 809 é dominicano,
 * não americano. A discagem é idêntica nos dois casos, então isto não muda
 * nada no envio.
 */
export const NANP_POR_AREA: Readonly<Record<string, { iso: string; nome: string }>> = {
  '242': { iso: 'BS', nome: 'Bahamas' },
  '246': { iso: 'BB', nome: 'Barbados' },
  '264': { iso: 'AI', nome: 'Anguila' },
  '268': { iso: 'AG', nome: 'Antígua e Barbuda' },
  '284': { iso: 'VG', nome: 'Ilhas Virgens Britânicas' },
  '340': { iso: 'VI', nome: 'Ilhas Virgens Americanas' },
  '345': { iso: 'KY', nome: 'Ilhas Cayman' },
  '441': { iso: 'BM', nome: 'Bermudas' },
  '473': { iso: 'GD', nome: 'Granada' },
  '649': { iso: 'TC', nome: 'Ilhas Turcas e Caicos' },
  '658': { iso: 'JM', nome: 'Jamaica' },
  '664': { iso: 'MS', nome: 'Montserrat' },
  '670': { iso: 'MP', nome: 'Marianas Setentrionais' },
  '671': { iso: 'GU', nome: 'Guam' },
  '684': { iso: 'AS', nome: 'Samoa Americana' },
  '721': { iso: 'SX', nome: 'Sint Maarten' },
  '758': { iso: 'LC', nome: 'Santa Lúcia' },
  '767': { iso: 'DM', nome: 'Dominica' },
  '784': { iso: 'VC', nome: 'São Vicente e Granadinas' },
  '787': { iso: 'PR', nome: 'Porto Rico' },
  '809': { iso: 'DO', nome: 'República Dominicana' },
  '829': { iso: 'DO', nome: 'República Dominicana' },
  '849': { iso: 'DO', nome: 'República Dominicana' },
  '868': { iso: 'TT', nome: 'Trinidad e Tobago' },
  '869': { iso: 'KN', nome: 'São Cristóvão e Névis' },
  '876': { iso: 'JM', nome: 'Jamaica' },
  '939': { iso: 'PR', nome: 'Porto Rico' },
}

/** O Brasil, à mão — é o caso mais consultado do sistema. */
export const BRASIL: Pais = PAISES.find((p) => p.ddi === '55')!

/**
 * DDDs brasileiros em uso. Lista FECHADA de propósito: é ela que permite dizer
 * que "16892064057" não é um celular de Ribeirão Preto sem o 55, e sim um
 * número americano — sem ela, qualquer par de dígitos iniciais passaria por DDD.
 */
export const DDD_BR: ReadonlySet<string> = new Set([
  '11', '12', '13', '14', '15', '16', '17', '18', '19',
  '21', '22', '24', '27', '28',
  '31', '32', '33', '34', '35', '37', '38',
  '41', '42', '43', '44', '45', '46', '47', '48', '49',
  '51', '53', '54', '55',
  '61', '62', '63', '64', '65', '66', '67', '68', '69',
  '71', '73', '74', '75', '77', '79',
  '81', '82', '83', '84', '85', '86', '87', '88', '89',
  '91', '92', '93', '94', '95', '96', '97', '98', '99',
])

// DDIs ordenados do mais longo para o mais curto: "351" tem de ser testado
// antes de "35" (que nem existe como DDI, mas a ordem é o que garante isso em
// casos como "1" vs "1"+area, "7" vs "70").
const POR_TAMANHO: readonly Pais[] = [...PAISES].sort((a, b) => b.ddi.length - a.ddi.length)

const POR_DDI = new Map<string, Pais>(PAISES.map((p) => [p.ddi, p]))

/** O país de um DDI exato ("55" → Brasil). */
export function paisPorDdi(ddi: string): Pais | null {
  return POR_DDI.get(ddi) ?? null
}

export interface Separado {
  pais: Pais
  /** DDI, sem "+". */
  ddi: string
  /** Número nacional, sem o DDI. */
  nsn: string
  /** Nome do país já desambiguado (NANP resolve Porto Rico, Jamaica etc.). */
  nome: string
  iso: string
  /**
   * O país tem validação estrutural e o número passou nela. Só um `forte`
   * autoriza tirar de um bloco de 10-11 dígitos com DDD brasileiro válido a
   * conclusão de que ele é estrangeiro.
   */
  forte: boolean
}

/**
 * Separa DDI + número nacional de um bloco de dígitos em E.164, exigindo que o
 * comprimento nacional caiba no plano daquele país.
 *
 * A exigência de comprimento é o que faz este módulo servir de peneira contra
 * LID do WhatsApp: "74607944044732" começa com "7" (Rússia), mas sobram 13
 * dígitos onde o plano russo aceita 10 — então não é telefone, e a função
 * devolve `null` em vez de inventar um contato russo.
 */
export function separarE164(digits: string): Separado | null {
  const d = (digits || '').replace(/\D/g, '')
  if (d.length < 5 || d.length > 15) return null // limite duro do E.164
  for (const pais of POR_TAMANHO) {
    if (!d.startsWith(pais.ddi)) continue
    const nsn = d.slice(pais.ddi.length)
    if (nsn.length < pais.nsnMin || nsn.length > pais.nsnMax) continue
    // Nenhum plano nacional começa em 0 — o zero é prefixo de discagem, não
    // faz parte do número. Sem esta linha, "+55 (60) 00000-0000" (um cadastro
    // de zeros que existe de verdade no unialfa) casaria com a Malásia pelo
    // comprimento e o lead seria "corrigido" para um telefone malaio.
    if (nsn.startsWith('0')) continue
    if (pais.estrutura && !pais.estrutura(nsn)) continue
    let nome = pais.nome
    let iso = pais.iso
    if (pais.ddi === '1') {
      const area = NANP_POR_AREA[nsn.slice(0, 3)]
      if (area) { nome = area.nome; iso = area.iso }
      else { nome = 'Estados Unidos/Canadá' }
    }
    return { pais, ddi: pais.ddi, nsn, nome, iso, forte: !!pais.estrutura }
  }
  return null
}

/** Este bloco de dígitos é um E.164 plausível de algum país? */
export function ehE164Plausivel(digits: string): boolean {
  return separarE164(digits) !== null
}

/**
 * O bloco (sem DDI) é um número NACIONAL brasileiro plausível?
 *
 *   · 11 dígitos → DDD válido + 9 + 8 dígitos (celular; o 9 é obrigatório desde 2016)
 *   · 10 dígitos → DDD válido + 8 dígitos começando em 2-5 (fixo) ou 6-9 (celular antigo)
 *
 * É a regra que decide, para um número sem DDI declarado, se ele é "brasileiro
 * sem o 55" ou "estrangeiro com DDI". Ela reprova "16892064057" (o 9 do celular
 * não está lá) e aprova "16992064057".
 */
export function ehNacionalBr(nsn: string): boolean {
  const d = (nsn || '').replace(/\D/g, '')
  if (d.length !== 10 && d.length !== 11) return false
  if (!DDD_BR.has(d.slice(0, 2))) return false
  const resto = d.slice(2)
  if (resto.length === 9) return resto.startsWith('9')
  return /^[2-9]/.test(resto)
}

/** O bloco inteiro é um telefone brasileiro em E.164 ("55" + nacional válido)? */
export function ehE164Br(digits: string): boolean {
  const d = (digits || '').replace(/\D/g, '')
  return d.startsWith('55') && ehNacionalBr(d.slice(2))
}

/** Bandeira em emoji a partir do ISO ("US" → 🇺🇸). Vazio se o ISO for inválido. */
export function bandeira(iso: string): string {
  const s = (iso || '').toUpperCase()
  if (!/^[A-Z]{2}$/.test(s)) return ''
  return String.fromCodePoint(...[...s].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}
