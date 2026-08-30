// components/ui/icons.ts
//
// Seletor do set de ícones do painel. Trocar a biblioteca inteira é trocar a
// linha marcada abaixo — as telas pedem ícone por NOME (`sets/names.ts`) e não
// sabem de onde ele vem.
//
// Sets disponíveis:
//   ./sets/lucide  — lucide-preact 1.11 (ISC), traço, grade 24 — o histórico.
//                    ATENÇÃO: os componentes do lucide não levam `data-icon`,
//                    então voltar a ele exige reativar a calibragem de traço
//                    (um <LucideProvider strokeWidth={1.5} absoluteStrokeWidth>
//                    na raiz, como havia antes) — senão o traço volta a variar
//                    com o tamanho do ícone.
//   ./sets/tabler  — @tabler/icons 3.46 (MIT), outline, grade 24
//
// Para avaliar um set novo: gere `sets/<nome>.tsx` cobrindo `ICON_NAMES` e
// aponte a linha abaixo para ele. Se faltar um nome, o build acusa.

import { TABLER_ICONS } from './sets/tabler'
import type { IconName } from './sets/names'

/** ← SET ATIVO. Troque o import e esta linha para mudar a cara do painel. */
export const ICONS = TABLER_ICONS as Record<IconName, unknown>

export type { IconName }
export { ICON_NAMES } from './sets/names'
