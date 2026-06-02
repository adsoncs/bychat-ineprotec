// GitHub: busca perfil público por e-mail ou nome.
// 60 req/h sem auth, 5000 com GITHUB_TOKEN (qualquer PAT grátis resolve).

import type { Provider, ProviderResult } from '../types.js'

async function gh(url: string) {
  const headers: Record<string, string> = {
    'User-Agent': 'ByChatBeyond/1.0',
    'Accept': 'application/vnd.github+json',
  }
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const resp = await fetch(url, { headers })
  if (!resp.ok) return null
  return await resp.json() as any
}

export const githubProvider: Provider = async (seed) => {
  const result: ProviderResult = { facts: [] }
  const email = (seed.email || '').toLowerCase()
  const nome = (seed.nome || '').trim()

  // Tenta por e-mail (mais assertivo)
  if (email) {
    try {
      const data = await gh(`https://api.github.com/search/users?q=${encodeURIComponent(email + ' in:email')}&per_page=3`)
      if (data?.items?.length) {
        const user = data.items[0]
        const full = await gh(`https://api.github.com/users/${user.login}`)
        if (full) {
          result.facts.push({ source: 'github', field: 'github_url', value: full.html_url, confidence: 0.9 })
          result.facts.push({ source: 'github', field: 'github_username', value: full.login, confidence: 0.95 })
          if (full.name) result.facts.push({ source: 'github', field: 'name', value: full.name, confidence: 0.85 })
          if (full.company) result.facts.push({ source: 'github', field: 'company_name', value: full.company.replace(/^@/, ''), confidence: 0.8 })
          if (full.location) result.facts.push({ source: 'github', field: 'location', value: full.location, confidence: 0.8 })
          if (full.blog) result.facts.push({ source: 'github', field: 'website', value: full.blog.startsWith('http') ? full.blog : `https://${full.blog}`, confidence: 0.8 })
          if (full.bio) result.facts.push({ source: 'github', field: 'bio', value: full.bio, confidence: 0.7 })
          if (full.avatar_url) result.facts.push({ source: 'github', field: 'photo_url', value: full.avatar_url, confidence: 0.85 })
          if (full.twitter_username) result.facts.push({ source: 'github', field: 'social_twitter', value: `https://twitter.com/${full.twitter_username}`, confidence: 0.85 })
          if (full.public_repos) result.facts.push({ source: 'github', field: 'github_public_repos', value: String(full.public_repos), confidence: 1.0 })
          return result
        }
      }
    } catch (err: any) {
      result.errors = [`github email: ${err.message}`]
    }
  }

  // Fallback: busca por nome + empresa
  if (nome && nome.split(' ').length >= 2) {
    try {
      const q = seed.empresa ? `${nome} ${seed.empresa} in:fullname` : `${nome} in:fullname`
      const data = await gh(`https://api.github.com/search/users?q=${encodeURIComponent(q)}&per_page=3`)
      if (data?.items?.length) {
        const user = data.items[0]
        result.facts.push({ source: 'github', field: 'github_url', value: user.html_url, confidence: 0.5 })
        result.facts.push({ source: 'github', field: 'github_username', value: user.login, confidence: 0.5 })
      }
    } catch { /* ignore */ }
  }

  return result
}
