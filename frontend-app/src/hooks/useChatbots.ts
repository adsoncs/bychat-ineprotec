import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface ChatbotItem {
  id: number
  name: string
  channel: string
  mode: string
  formId: number | null
  useFlow: boolean
  postChatAi: boolean
  postChatPrompt: string | null
  scriptedMessages: Record<string, string> | null
  active: boolean
  systemPrompt: string | null
  extractionPrompt: string | null
  analysisPrompt: string | null
  greetingMessage: string | null
  completionMessage: string | null
  funnelId: number | null
  defaultTeamId: number | null
  inactivityEnabled: boolean
  inactivityAction: string | null
  inactivityTimeoutMin: number | null
  inactivityCheckIntervalMin: number | null
  inactivityMessage: string | null
  inactivityMaxRetries: number | null
  inactivityCloseAfterMin: number | null
  createdAt: string
  updatedAt: string
  _count: { questions: number }
}

export interface ChatbotInput {
  name: string
  channel?: string | undefined
  mode?: string | undefined
  formId?: number | null | undefined
  useFlow?: boolean | undefined
  postChatAi?: boolean | undefined
  postChatPrompt?: string | null | undefined
  scriptedMessages?: Record<string, string> | null | undefined
  systemPrompt?: string | null | undefined
  extractionPrompt?: string | null | undefined
  analysisPrompt?: string | null | undefined
  greetingMessage?: string | null | undefined
  completionMessage?: string | null | undefined
  funnelId?: number | null | undefined
  defaultTeamId?: number | null | undefined
  active?: boolean | undefined
  inactivityEnabled?: boolean | undefined
  inactivityAction?: string | null | undefined
  inactivityTimeoutMin?: number | null | undefined
  inactivityCheckIntervalMin?: number | null | undefined
  inactivityMessage?: string | null | undefined
  inactivityMaxRetries?: number | null | undefined
  inactivityCloseAfterMin?: number | null | undefined
}

export function useChatbots() {
  return useQuery({
    queryKey: ['chatbots'],
    queryFn: () => api.get<{ chatbots: ChatbotItem[] }>('/admin/chatbots'),
    staleTime: 60_000,
  })
}

export function useChatbot(id: number | null) {
  return useQuery({
    queryKey: ['chatbot', id],
    queryFn: () => api.get<ChatbotItem>(`/admin/chatbots/${id}`),
    enabled: id !== null,
    staleTime: 30_000,
  })
}

export function useCreateChatbot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ChatbotInput) => api.post<ChatbotItem>('/admin/chatbots', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chatbots'] }),
  })
}

export function useUpdateChatbot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & Partial<ChatbotInput>) =>
      api.put<ChatbotItem>(`/admin/chatbots/${id}`, input),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['chatbots'] })
      void qc.invalidateQueries({ queryKey: ['chatbot', vars.id] })
    },
  })
}

export function useDeleteChatbot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/admin/chatbots/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chatbots'] }),
  })
}

export function useDuplicateChatbot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.post<{ ok: true; chatbot: ChatbotItem }>(`/admin/chatbots/${id}/duplicate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chatbots'] }),
  })
}

// ── Export / Import ──────────────────────────────────────────────

import { downloadFile } from '@/lib/download'

/** Dispara o download direto do JSON do chatbot. Usa o helper compartilhado
 * `downloadFile` que já cuida do Authorization header + Content-Disposition. */
export async function exportChatbot(id: number, suggestedName?: string): Promise<void> {
  const filename = `chatbot-${suggestedName ? slugify(suggestedName) : id}.json`
  await downloadFile(`/admin/chatbots/${id}/export`, filename)
}

function slugify(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'chatbot'
}

export interface ChatbotImportPayload {
  kind: 'bychat-chatbot-export'
  version: number
  exportedAt?: string
  sourceId?: number
  chatbot: Record<string, unknown> & { name?: string }
  references?: {
    funnel?: { name: string } | null
    team?:   { name: string; slug?: string } | null
  }
  questions?: unknown[]
}

export interface ChatbotImportResult {
  ok: true
  chatbot: ChatbotItem
  importedQuestions: number
  resolvedReferences: { funnelId: number | null; defaultTeamId: number | null }
  unresolvedReferences: { funnel?: string; team?: string }
}

export function useImportChatbot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { payload: ChatbotImportPayload; name?: string; importQuestions?: boolean }) =>
      api.post<ChatbotImportResult>('/admin/chatbots/import', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['chatbots'] })
    },
  })
}

// ── Chat questions (perguntas do bot) ──────────────────────────

export type ChatQuestionType =
  | 'text' | 'email' | 'phone' | 'number'
  | 'select' | 'multi_select'
  | 'date' | 'cep' | 'cpf' | 'cnpj'

export interface ChatQuestion {
  id: number
  chatbotId: number
  stage: number
  position: number
  fieldKey: string
  text: string
  type: ChatQuestionType
  options: unknown
  required: boolean
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface ChatQuestionInput {
  stage?: number | undefined
  position?: number | undefined
  fieldKey: string
  text: string
  type?: ChatQuestionType | undefined
  options?: unknown
  required?: boolean | undefined
  active?: boolean | undefined
}

export function useChatQuestions(chatbotId: number | null | undefined) {
  return useQuery({
    queryKey: ['chatbot-questions', chatbotId],
    queryFn: () => api.get<{ questions: ChatQuestion[] }>(`/admin/chatbots/${chatbotId}/questions`),
    enabled: !!chatbotId,
    staleTime: 30_000,
  })
}

export function useCreateChatQuestion(chatbotId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ChatQuestionInput) =>
      api.post<ChatQuestion>(`/admin/chatbots/${chatbotId}/questions`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['chatbot-questions', chatbotId] })
      void qc.invalidateQueries({ queryKey: ['chatbots'] })
    },
  })
}

export function useUpdateChatQuestion(chatbotId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ qid, ...input }: { qid: number } & Partial<ChatQuestionInput>) =>
      api.put<ChatQuestion>(`/admin/chatbots/${chatbotId}/questions/${qid}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chatbot-questions', chatbotId] }),
  })
}

export function useDeleteChatQuestion(chatbotId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (qid: number) => api.delete<{ ok: true }>(`/admin/chatbots/${chatbotId}/questions/${qid}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['chatbot-questions', chatbotId] })
      void qc.invalidateQueries({ queryKey: ['chatbots'] })
    },
  })
}

export function useReorderChatQuestions(chatbotId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (order: { id: number; position: number; stage: number }[]) =>
      api.put<{ ok: true }>(`/admin/chatbots/${chatbotId}/questions/reorder`, { order }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chatbot-questions', chatbotId] }),
  })
}

// Embed code do chatbot (usa GET /api/chatbots/:id/embed-code)
export function useChatbotEmbedCode(id: number | null) {
  return useQuery({
    queryKey: ['chatbot-embed', id],
    queryFn: () => api.get<{ snippet: string; baseUrl: string }>(`/chatbots/${id}/embed-code`),
    enabled: id !== null,
    staleTime: 5 * 60_000,
  })
}
