/**
 * Catálogos de mensagens — pt como master (mais completo, fallback).
 *
 * Para adicionar uma string nova:
 *   1. Adicione a chave aqui em `pt`
 *   2. Tipo `MessageKey` é inferido automaticamente
 *   3. en/es podem ficar sem traduzir → cai no fallback pt com aviso no DEV
 */

export const pt = {
  // Topbar / Shell
  'shell.search.placeholder': 'Buscar páginas, leads, ações…',
  'shell.search.aria': 'Buscar (Ctrl+K)',
  'shell.menu.open': 'Abrir menu',
  'shell.user.menu': 'Menu do usuário',
  'shell.user.account': 'Conta',
  'shell.user.logout': 'Sair',
  'shell.theme.label': 'Tema',
  'shell.theme.light': 'Claro',
  'shell.theme.dark': 'Escuro',
  'shell.theme.system': 'Automático',
  'shell.skipToContent': 'Pular para o conteúdo principal',
  'shell.nav.aria': 'Navegação principal',
  'shell.sidebar.collapse': 'Recolher menu',
  'shell.sidebar.expand': 'Expandir menu',

  // Locale
  'locale.label': 'Idioma',
  'locale.pt': 'Português',
  'locale.en': 'English',
  'locale.es': 'Español',

  // Comuns
  'common.cancel': 'Cancelar',
  'common.save': 'Salvar',
  'common.delete': 'Excluir',
  'common.edit': 'Editar',
  'common.add': 'Adicionar',
  'common.close': 'Fechar',
  'common.confirm': 'Confirmar',
  'common.loading': 'Carregando…',
  'common.empty': 'Nenhum item',
  'common.search': 'Buscar',
  'common.back': 'Voltar',
  'common.actions': 'Ações',
  'common.required': 'Obrigatório',
}

export type MessageKey = keyof typeof pt

export type Catalog = Partial<Record<MessageKey, string>>

export const en: Catalog = {
  'shell.search.placeholder': 'Search pages, leads, actions…',
  'shell.search.aria': 'Search (Ctrl+K)',
  'shell.menu.open': 'Open menu',
  'shell.user.menu': 'User menu',
  'shell.user.account': 'Account',
  'shell.user.logout': 'Sign out',
  'shell.theme.label': 'Theme',
  'shell.theme.light': 'Light',
  'shell.theme.dark': 'Dark',
  'shell.theme.system': 'Auto',
  'shell.skipToContent': 'Skip to main content',
  'shell.nav.aria': 'Main navigation',
  'shell.sidebar.collapse': 'Collapse menu',
  'shell.sidebar.expand': 'Expand menu',
  'locale.label': 'Language',
  'locale.pt': 'Português',
  'locale.en': 'English',
  'locale.es': 'Español',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.add': 'Add',
  'common.close': 'Close',
  'common.confirm': 'Confirm',
  'common.loading': 'Loading…',
  'common.empty': 'No items',
  'common.search': 'Search',
  'common.back': 'Back',
  'common.actions': 'Actions',
  'common.required': 'Required',
}

export const es: Catalog = {
  'shell.search.placeholder': 'Buscar páginas, leads, acciones…',
  'shell.search.aria': 'Buscar (Ctrl+K)',
  'shell.menu.open': 'Abrir menú',
  'shell.user.menu': 'Menú del usuario',
  'shell.user.account': 'Cuenta',
  'shell.user.logout': 'Cerrar sesión',
  'shell.theme.label': 'Tema',
  'shell.theme.light': 'Claro',
  'shell.theme.dark': 'Oscuro',
  'shell.theme.system': 'Automático',
  'shell.skipToContent': 'Saltar al contenido principal',
  'shell.nav.aria': 'Navegación principal',
  'shell.sidebar.collapse': 'Contraer menú',
  'shell.sidebar.expand': 'Expandir menú',
  'locale.label': 'Idioma',
  'locale.pt': 'Português',
  'locale.en': 'English',
  'locale.es': 'Español',
  'common.cancel': 'Cancelar',
  'common.save': 'Guardar',
  'common.delete': 'Eliminar',
  'common.edit': 'Editar',
  'common.add': 'Añadir',
  'common.close': 'Cerrar',
  'common.confirm': 'Confirmar',
  'common.loading': 'Cargando…',
  'common.empty': 'Sin elementos',
  'common.search': 'Buscar',
  'common.back': 'Volver',
  'common.actions': 'Acciones',
  'common.required': 'Obligatorio',
}

export const CATALOGS = { pt, en, es } as const
export type Locale = keyof typeof CATALOGS
