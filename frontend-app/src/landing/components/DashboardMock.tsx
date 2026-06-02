/**
 * Mockup estilizado do produto (placeholder profissional, sem dependências).
 * Substituível por screenshot real do sistema depois — a estrutura imita
 * uma tela de conversas + KPIs do ByChat.
 */
export function DashboardMock() {
  return (
    <div class="rounded-2xl border border-line bg-surface p-3 shadow-2xl shadow-brand/10">
      {/* barra de janela */}
      <div class="flex items-center gap-1.5 px-2 pb-3">
        <span class="size-2.5 rounded-full bg-line-strong" />
        <span class="size-2.5 rounded-full bg-line-strong" />
        <span class="size-2.5 rounded-full bg-line-strong" />
        <span class="ml-3 h-5 flex-1 rounded bg-surface-2" />
      </div>

      <div class="grid grid-cols-3 gap-3">
        {/* lista de conversas */}
        <div class="col-span-1 space-y-2 rounded-xl bg-surface-2 p-3">
          {['Ana', 'Bruno', 'Clara', 'Diego'].map((n, i) => (
            <div
              key={n}
              class={`flex items-center gap-2 rounded-lg p-2 ${
                i === 0 ? 'bg-brand-soft' : ''
              }`}
            >
              <span class="grid size-7 shrink-0 place-items-center rounded-full bg-brand/15 text-[10px] font-bold text-brand">
                {n.slice(0, 1)}
              </span>
              <div class="min-w-0 flex-1">
                <div class="h-2 w-3/4 rounded bg-line-strong" />
                <div class="mt-1.5 h-1.5 w-full rounded bg-line" />
              </div>
            </div>
          ))}
        </div>

        {/* painel de conversa + KPIs */}
        <div class="col-span-2 space-y-3">
          <div class="grid grid-cols-3 gap-2">
            {[
              { k: 'Leads hoje', v: '128' },
              { k: 'Conversão', v: '24%' },
              { k: 'Receita', v: 'R$ 41k' },
            ].map((m) => (
              <div
                key={m.k}
                class="rounded-xl border border-line bg-surface p-3"
              >
                <div class="text-[10px] font-medium text-fg-subtle">{m.k}</div>
                <div class="mt-1 text-lg font-extrabold text-ink">{m.v}</div>
              </div>
            ))}
          </div>

          <div class="space-y-2 rounded-xl border border-line bg-surface p-3">
            <div class="max-w-[70%] rounded-2xl rounded-tl-sm bg-surface-2 p-2.5">
              <div class="h-1.5 w-32 rounded bg-line-strong" />
              <div class="mt-1.5 h-1.5 w-24 rounded bg-line" />
            </div>
            <div class="ml-auto max-w-[70%] rounded-2xl rounded-tr-sm bg-brand p-2.5">
              <div class="h-1.5 w-28 rounded bg-brand-fg/70" />
              <div class="mt-1.5 h-1.5 w-20 rounded bg-brand-fg/40" />
            </div>
            <div class="flex items-center gap-2 rounded-full bg-surface-2 px-3 py-2">
              <div class="h-2 flex-1 rounded bg-line" />
              <span class="grid size-6 place-items-center rounded-full bg-cta text-[9px] font-bold text-cta-fg">
                ➤
              </span>
            </div>
          </div>

          <div class="flex items-center gap-2 rounded-xl border border-line bg-surface p-3">
            <span class="rounded-md bg-cta/15 px-2 py-0.5 text-[10px] font-semibold text-cta">
              IA
            </span>
            <div class="h-1.5 flex-1 rounded bg-line" />
            <div class="h-1.5 w-10 rounded bg-line-strong" />
          </div>
        </div>
      </div>
    </div>
  )
}
