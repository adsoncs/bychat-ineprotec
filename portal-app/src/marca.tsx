// Marca do portal (aba Branding) aplicada na página: a mesma regra no
// formulário de inscrição e nas telas logadas (Aluno, Documentos, Contrato),
// para a pessoa não sair do portal da instituição e cair num tema genérico.

/** Os campos brand* do portal, como o backend devolve. */
export interface MarcaDoPortal {
  nome?: string | null
  slug?: string | null
  brandPrimaryColor?: string | null
  brandSecondaryColor?: string | null
  brandTemplate?: string | null
  brandHeaderStyle?: string | null
  brandStepStyle?: string | null
  brandButtonShape?: string | null
  brandButtonUppercase?: boolean | null
  brandTypeScale?: string | null
  brandContentWidth?: string | null
  brandBackdropFrom?: string | null
  brandBackdropTo?: string | null
  brandRadiusScale?: string | number | null
  brandFontFamily?: string | null
  brandLogoUrl?: string | null
  brandLogoLink?: string | null
  brandFaviconUrl?: string | null
  brandFooterText?: string | null
}

// Escala de arredondamento do builder: valores nomeados, não número.
export const RAIOS: Record<string, string> = { sharp: '2px', medium: '12px', rounded: '20px' }

// Fontes que o builder oferece. Carregadas só quando escolhidas — nenhuma
// requisição a mais para quem ficou no padrão do sistema.
export const FONTES: Record<string, { familia: string; href?: string }> = {
  inter: { familia: "'Inter', system-ui, sans-serif", href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap' },
  roboto: { familia: "'Roboto', system-ui, sans-serif", href: 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap' },
  poppins: { familia: "'Poppins', system-ui, sans-serif", href: 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap' },
  system: { familia: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
}

export function aplicarMarca(p: MarcaDoPortal) {

  const raiz = document.documentElement
  if (p.brandPrimaryColor) {
    raiz.style.setProperty('--marca', p.brandPrimaryColor)
    raiz.style.setProperty('--marca-suave', `color-mix(in srgb, ${p.brandPrimaryColor} 12%, transparent)`)
  }
  // Estrutura da página escolhida no builder. Só o arranjo muda — cor, fonte e
  // arredondamento continuam vindo dos campos de marca.
  raiz.dataset.template = p.brandTemplate === 'duas-colunas' ? 'duas-colunas' : 'classico'

  // Acabamento. Cada escolha vira um data-attribute que o CSS lê; nada aqui
  // inventa cor ou fonte, só decide a forma.
  raiz.dataset.topo = p.brandHeaderStyle === 'barra' ? 'barra' : 'simples'
  raiz.dataset.passos = p.brandStepStyle === 'numeros' ? 'numeros' : 'barras'
  raiz.dataset.botao = p.brandButtonShape === 'pill' ? 'pill' : 'reta'
  raiz.dataset.caixaAlta = p.brandButtonUppercase ? 'sim' : 'nao'

  raiz.dataset.escala = ['compacta', 'ampla'].includes(String(p.brandTypeScale ?? '')) ? String(p.brandTypeScale) : 'padrao'
  raiz.dataset.largura = ['estreita', 'ampla'].includes(String(p.brandContentWidth ?? '')) ? String(p.brandContentWidth) : 'padrao'

  // Cor de apoio: sem ela, tudo o que é acento usa a cor da marca — que é o
  // comportamento de antes e continua sendo o padrão.
  const apoio = p.brandSecondaryColor || p.brandPrimaryColor
  if (apoio) {
    raiz.style.setProperty('--apoio', apoio)
    raiz.style.setProperty('--apoio-suave', `color-mix(in srgb, ${apoio} 12%, transparent)`)
  }

  // Fundo em degradê: só quando as duas pontas foram escolhidas. Com uma cor
  // só, o resultado costuma ficar sujo — melhor manter o fundo liso.
  if (p.brandBackdropFrom && p.brandBackdropTo) {
    raiz.style.setProperty('--fundo-de', p.brandBackdropFrom)
    raiz.style.setProperty('--fundo-para', p.brandBackdropTo)
    raiz.dataset.fundo = 'degrade'
  } else {
    raiz.dataset.fundo = 'liso'
  }

  const raio = RAIOS[String(p.brandRadiusScale ?? '')]
  if (raio) raiz.style.setProperty('--raio', raio)

  const fonte = FONTES[String(p.brandFontFamily ?? '')]
  if (fonte) {
    if (fonte.href && !document.querySelector(`link[href="${fonte.href}"]`)) {
      const l = document.createElement('link')
      l.rel = 'stylesheet'
      l.href = fonte.href
      document.head.appendChild(l)
    }
    document.body.style.fontFamily = fonte.familia
  }
  if (p.brandFaviconUrl && !document.querySelector('link[rel="icon"][data-marca]')) {
    const l = document.createElement('link')
    l.rel = 'icon'
    l.href = p.brandFaviconUrl
    l.dataset.marca = '1'
    document.head.appendChild(l)
  }
}

/**
 * Marca para as telas logadas, que não sabem sozinhas de qual portal a pessoa
 * veio: o backend resolve (inscrição de quem está logado, último portal
 * visitado, portal principal). Nunca lança — sem marca, fica o tema padrão.
 */
export async function carregarMarca(): Promise<MarcaDoPortal | null> {
  try {
    const r = await fetch('/api/public/portal/marca', { credentials: 'same-origin' })
    if (!r.ok) return null
    const { marca } = (await r.json()) as { marca: MarcaDoPortal | null }
    if (marca) aplicarMarca(marca)
    return marca
  } catch {
    return null
  }
}

/** Topo com o logo do portal (ou o nome, sem logo) — nas telas logadas. */
export function TopoDaMarca({ marca }: { marca: MarcaDoPortal | null }) {
  if (!marca) return null
  const img = marca.brandLogoUrl
    ? <img src={marca.brandLogoUrl} alt={marca.nome ?? ''} />
    : <span class="nome">{marca.nome}</span>
  return <div class="topo">{marca.brandLogoUrl && marca.brandLogoLink ? <a href={marca.brandLogoLink}>{img}</a> : img}</div>
}
