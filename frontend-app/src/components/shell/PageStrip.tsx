// components/shell/PageStrip.tsx
//
// A faixa de página: título à esquerda, migalhas à direita, encostada no topo
// do painel.
//
// É a segunda das duas faixas do desenho — a de cima pertence ao sistema e é
// igual em toda tela; esta pertence à tela e muda com ela. Ter um lugar fixo
// para a página se apresentar é o que faz telas muito diferentes parecerem o
// mesmo produto; era exatamente o que faltava na barra antiga, que não sabia
// dizer onde a pessoa estava.
//
// O título vem do <Page> da tela (títulos dinâmicos, como o nome de um lead) e
// cai no nome do menu quando a tela não registra nada.

import { useMemo } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { usePageHeaderStore } from '@/stores/pageHeader'
import { sidebarSchema } from '@/modules/sidebar.config'

export function PageStrip() {
  const [loc] = useLocation()
  const tituloDaTela = usePageHeaderStore((s) => s.title)
  const doMenu = useMemo(() => localizarNoMenu(loc), [loc])
  const titulo = tituloDaTela || doMenu?.item || null
  if (!titulo) return null

  return (
    <div class="app-pagestrip">
      <h1 class="app-pagestrip-title">{titulo}</h1>
      <nav class="app-pagestrip-crumbs" aria-label="Trilha de navegação">
        <span>Início</span>
        {doMenu?.grupo && (<><i aria-hidden="true">/</i><span>{doMenu.grupo}</span></>)}
        {doMenu?.item && (<><i aria-hidden="true">/</i><b>{doMenu.item}</b></>)}
      </nav>
    </div>
  )
}

/**
 * Onde a rota atual mora no menu: o grupo dá a migalha do meio, o item dá a
 * última. Ganha o `href` mais LONGO que casa — `/app/leads` e
 * `/app/leads/duplicates` são dois itens, e o segundo tem de vencer na rota
 * dele.
 */
function localizarNoMenu(loc: string): { grupo: string | null; item: string } | null {
  let achado: { grupo: string | null; item: string } | null = null
  let tamanho = -1

  const considerar = (href: string | undefined, label: string, grupo: string | null) => {
    if (!href) return
    if ((loc === href || loc.startsWith(href + '/')) && href.length > tamanho) {
      achado = { grupo, item: label }
      tamanho = href.length
    }
  }

  for (const it of sidebarSchema.pinned) considerar(it.href, it.label, null)
  for (const g of sidebarSchema.groups) for (const it of g.items) considerar(it.href, it.label, g.label)
  for (const it of sidebarSchema.footer) considerar(it.href, it.label, null)
  return achado
}
