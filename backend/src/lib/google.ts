// src/lib/google.ts
// Google OAuth2 + Sheets/Calendar API helpers

import { google } from 'googleapis'
import { prisma } from './prisma.js'
import { encryptToken, decryptToken } from '../services/cloudApi.js'

// Helper seguro para decriptar tokens (suporta tokens legados não criptografados)
function safeDecrypt(token: string): string {
  if (!token) return token
  try {
    // Formato criptografado: iv:authTag:encrypted (3 partes hex separadas por :)
    if (token.includes(':') && token.split(':').length === 3) {
      return decryptToken(token)
    }
    return token // Token legado (plaintext)
  } catch {
    return token // Fallback para tokens que não estão criptografados
  }
}

const SCOPES_SHEETS = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
]

const SCOPES_CALENDAR = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
]

const SCOPES_GMAIL = [
  'https://www.googleapis.com/auth/gmail.send',
]

const SCOPES_TASKS = [
  'https://www.googleapis.com/auth/tasks',
]

const SCOPES_ADS = [
  'https://www.googleapis.com/auth/adwords',
]

const SCOPES_IDENTITY = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

export const ALL_GOOGLE_SCOPES = [
  ...SCOPES_IDENTITY,
  ...SCOPES_SHEETS, ...SCOPES_CALENDAR, ...SCOPES_GMAIL,
  ...SCOPES_TASKS, ...SCOPES_ADS,
]

async function getSetting(key: string): Promise<string> {
  // env var takes precedence, then database
  const envMap: Record<string, string> = {
    'google.client_id': 'GOOGLE_CLIENT_ID',
    'google.client_secret': 'GOOGLE_CLIENT_SECRET',
    'google.redirect_uri': 'GOOGLE_REDIRECT_URI',
  }
  const envVal = process.env[envMap[key] || '']
  if (envVal) return envVal
  const row = await prisma.setting.findUnique({ where: { key } })
  const val = row ? (typeof row.value === 'string' ? row.value : String(row.value)) : ''
  return val.replace(/^"|"$/g, '')
}

async function getCredentials() {
  const clientId = await getSetting('google.client_id')
  const clientSecret = await getSetting('google.client_secret')
  let redirectUri = await getSetting('google.redirect_uri')

  // Auto-generate redirect URI from APP_URL if not explicitly set
  if (!redirectUri && process.env.APP_URL) {
    redirectUri = `${process.env.APP_URL.replace(/\/$/, '')}/api/admin/google/callback`
  }

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Credenciais Google nao configuradas. Configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no .env do servidor.')
  }
  return { clientId, clientSecret, redirectUri }
}

/** Check if Google OAuth credentials are available (env or DB) without throwing */
export async function isGoogleConfigured(): Promise<boolean> {
  try {
    const clientId = await getSetting('google.client_id')
    const clientSecret = await getSetting('google.client_secret')
    let redirectUri = await getSetting('google.redirect_uri')
    if (!redirectUri && process.env.APP_URL) redirectUri = 'auto'
    return !!(clientId && clientSecret && redirectUri)
  } catch {
    return false
  }
}

export async function createOAuth2Client() {
  const { clientId, clientSecret, redirectUri } = await getCredentials()
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri)
}

export async function getAuthUrl(state?: string): Promise<string> {
  const client = await createOAuth2Client()
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ALL_GOOGLE_SCOPES,
    state: state || '',
  })
}

export async function exchangeCode(code: string) {
  const client = await createOAuth2Client()
  const { tokens } = await client.getToken(code)
  client.setCredentials(tokens)

  // Get user email
  const oauth2 = google.oauth2({ version: 'v2', auth: client })
  const { data } = await oauth2.userinfo.get()

  return {
    email: data.email || 'unknown',
    accessToken: tokens.access_token || '',
    refreshToken: tokens.refresh_token || '',
    expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    scopes: (tokens.scope || '').split(' ').filter(Boolean).join(' '),
  }
}

// Token refresh mutex per connection to avoid concurrent refreshes
const refreshMutexes = new Map<number, Promise<string>>()

export async function getAuthenticatedClient(connectionId: number) {
  const conn = await prisma.googleConnection.findUnique({ where: { id: connectionId } })
  if (!conn || !conn.active) throw new Error('Google connection not found or inactive')

  const client = await createOAuth2Client()
  client.setCredentials({
    access_token: safeDecrypt(conn.accessToken),
    refresh_token: safeDecrypt(conn.refreshToken),
    expiry_date: conn.tokenExpiresAt?.getTime(),
  })

  // Check if token needs refresh (5min buffer)
  const needsRefresh = conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() < Date.now() + 5 * 60_000

  if (needsRefresh) {
    if (!refreshMutexes.has(connectionId)) {
      const promise = (async () => {
        try {
          const { credentials } = await client.refreshAccessToken()
          await prisma.googleConnection.update({
            where: { id: connectionId },
            data: {
              accessToken: credentials.access_token ? encryptToken(credentials.access_token) : conn.accessToken,
              tokenExpiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : null,
            },
          })
          client.setCredentials(credentials)
          return credentials.access_token || safeDecrypt(conn.accessToken)
        } finally {
          refreshMutexes.delete(connectionId)
        }
      })()
      refreshMutexes.set(connectionId, promise)
    }
    await refreshMutexes.get(connectionId)
  }

  return client
}

// ── Sheets helpers ──────────────────────────────────────

export async function listSpreadsheets(connectionId: number) {
  const auth = await getAuthenticatedClient(connectionId)
  const drive = google.drive({ version: 'v3', auth })
  const res = await drive.files.list({
    q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
    fields: 'files(id,name,modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: 50,
  })
  return res.data.files || []
}

export async function createSpreadsheet(connectionId: number, title: string) {
  const auth = await getAuthenticatedClient(connectionId)
  const sheets = google.sheets({ version: 'v4', auth })
  const res = await sheets.spreadsheets.create({
    requestBody: { properties: { title } },
  })
  return { id: res.data.spreadsheetId!, title: res.data.properties?.title || title }
}

export async function listSheetTabs(connectionId: number, spreadsheetId: string) {
  const auth = await getAuthenticatedClient(connectionId)
  const sheets = google.sheets({ version: 'v4', auth })
  const res = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' })
  return (res.data.sheets || []).map(s => ({
    sheetId: s.properties?.sheetId,
    title: s.properties?.title || 'Sheet1',
  }))
}

export async function appendRow(connectionId: number, spreadsheetId: string, sheetName: string, values: any[]) {
  const auth = await getAuthenticatedClient(connectionId)
  const sheets = google.sheets({ version: 'v4', auth })
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] },
  })
}

export async function writeHeaders(connectionId: number, spreadsheetId: string, sheetName: string, headers: string[]) {
  const auth = await getAuthenticatedClient(connectionId)
  const sheets = google.sheets({ version: 'v4', auth })
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [headers] },
  })
}

// ── Calendar helpers ────────────────────────────────────

export async function listCalendars(connectionId: number) {
  const auth = await getAuthenticatedClient(connectionId)
  const calendar = google.calendar({ version: 'v3', auth })
  const res = await calendar.calendarList.list({ minAccessRole: 'writer' })
  return (res.data.items || []).map(c => ({
    id: c.id,
    summary: c.summary,
    primary: c.primary || false,
  }))
}

// Lista eventos (expandidos) de um calendário num intervalo. Usado para sincronizar
// a agenda do Google na agenda nativa (exibição + free/busy).
export async function listCalendarEvents(connectionId: number, calendarId: string, timeMin: Date, timeMax: Date) {
  const auth = await getAuthenticatedClient(connectionId)
  const calendar = google.calendar({ version: 'v3', auth })
  const res = await calendar.events.list({
    calendarId,
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 250,
    showDeleted: false,
  })
  return (res.data.items || [])
    .filter(e => e.status !== 'cancelled')
    .map(e => {
      const allDay = !!e.start?.date
      const start = e.start?.dateTime || (e.start?.date ? `${e.start.date}T00:00:00` : null)
      const end = e.end?.dateTime || (e.end?.date ? `${e.end.date}T00:00:00` : null)
      return {
        eventId: e.id || '',
        summary: e.summary || '(sem título)',
        start, end, allDay,
        htmlLink: e.htmlLink || '',
        transparency: e.transparency || 'opaque', // 'transparent' = livre (não ocupa)
        bychatSource: (e.extendedProperties?.private as any)?.bychatSource || null,
      }
    })
}

const ymdUTC = (d: Date) => d.toISOString().slice(0, 10)

export async function createCalendarEvent(connectionId: number, calendarId: string, event: {
  summary: string
  description?: string
  start: Date
  end: Date
  attendees?: string[]
  addMeetLink?: boolean
  allDay?: boolean
  extendedPrivate?: Record<string, string>
}) {
  const auth = await getAuthenticatedClient(connectionId)
  const calendar = google.calendar({ version: 'v3', auth })

  const body: any = {
    summary: event.summary,
    description: event.description || '',
    start: event.allDay ? { date: ymdUTC(event.start) } : { dateTime: event.start.toISOString(), timeZone: 'America/Sao_Paulo' },
    end: event.allDay ? { date: ymdUTC(event.end) } : { dateTime: event.end.toISOString(), timeZone: 'America/Sao_Paulo' },
  }

  if (event.extendedPrivate) body.extendedProperties = { private: event.extendedPrivate }

  if (event.attendees?.length) {
    body.attendees = event.attendees.map(email => ({ email }))
  }

  if (event.addMeetLink) {
    body.conferenceData = {
      createRequest: { requestId: `bychat-${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } },
    }
  }

  const res = await calendar.events.insert({
    calendarId,
    requestBody: body,
    conferenceDataVersion: event.addMeetLink ? 1 : 0,
    sendUpdates: event.attendees?.length ? 'all' : 'none',
  })

  return {
    eventId: res.data.id!,
    htmlLink: res.data.htmlLink || '',
    meetLink: res.data.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri || '',
  }
}

export async function updateCalendarEvent(connectionId: number, calendarId: string, eventId: string, updates: {
  summary?: string
  description?: string
  start?: Date
  end?: Date
  allDay?: boolean
}) {
  const auth = await getAuthenticatedClient(connectionId)
  const calendar = google.calendar({ version: 'v3', auth })

  const body: any = {}
  if (updates.summary) body.summary = updates.summary
  if (updates.description) body.description = updates.description
  if (updates.start) body.start = updates.allDay ? { date: ymdUTC(updates.start) } : { dateTime: updates.start.toISOString(), timeZone: 'America/Sao_Paulo' }
  if (updates.end) body.end = updates.allDay ? { date: ymdUTC(updates.end) } : { dateTime: updates.end.toISOString(), timeZone: 'America/Sao_Paulo' }

  await calendar.events.patch({ calendarId, eventId, requestBody: body })
}

export async function deleteCalendarEvent(connectionId: number, calendarId: string, eventId: string) {
  const auth = await getAuthenticatedClient(connectionId)
  const calendar = google.calendar({ version: 'v3', auth })
  await calendar.events.delete({ calendarId, eventId })
}

// ── Drive helpers ───────────────────────────────────────

export async function driveCreateFolder(connectionId: number, name: string, parentId?: string) {
  const auth = await getAuthenticatedClient(connectionId)
  const drive = google.drive({ version: 'v3', auth })
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : undefined,
    },
    fields: 'id,name,webViewLink',
  })
  return { id: res.data.id!, name: res.data.name!, link: res.data.webViewLink || '' }
}

export async function driveFindFolder(connectionId: number, name: string, parentId?: string) {
  const auth = await getAuthenticatedClient(connectionId)
  const drive = google.drive({ version: 'v3', auth })
  const q = parentId
    ? `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
    : `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const res = await drive.files.list({ q, fields: 'files(id,name,webViewLink)', pageSize: 1 })
  return res.data.files?.[0] || null
}

export async function driveUploadFile(connectionId: number, opts: {
  name: string
  mimeType: string
  body: Buffer | NodeJS.ReadableStream
  parentId?: string
}) {
  const auth = await getAuthenticatedClient(connectionId)
  const drive = google.drive({ version: 'v3', auth })
  const res = await drive.files.create({
    requestBody: { name: opts.name, parents: opts.parentId ? [opts.parentId] : undefined },
    media: { mimeType: opts.mimeType, body: opts.body },
    fields: 'id,name,webViewLink,webContentLink',
  })
  return {
    id: res.data.id!,
    name: res.data.name!,
    viewLink: res.data.webViewLink || '',
    downloadLink: res.data.webContentLink || '',
  }
}

export async function driveListFiles(connectionId: number, folderId: string) {
  const auth = await getAuthenticatedClient(connectionId)
  const drive = google.drive({ version: 'v3', auth })
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id,name,mimeType,size,modifiedTime,webViewLink)',
    orderBy: 'modifiedTime desc',
    pageSize: 100,
  })
  return res.data.files || []
}

// ── Gmail helpers ───────────────────────────────────────

export async function gmailSendEmail(connectionId: number, opts: {
  to: string
  subject: string
  body: string
  bodyHtml?: string
  from?: string
  replyTo?: string
}) {
  const auth = await getAuthenticatedClient(connectionId)
  const gmail = google.gmail({ version: 'v1', auth })

  const boundary = `boundary_${Date.now()}`
  const isHtml = !!opts.bodyHtml

  const headers = [
    `To: ${opts.to}`,
    opts.from ? `From: ${opts.from}` : '',
    opts.replyTo ? `Reply-To: ${opts.replyTo}` : '',
    `Subject: =?UTF-8?B?${Buffer.from(opts.subject).toString('base64')}?=`,
    `MIME-Version: 1.0`,
    isHtml ? `Content-Type: multipart/alternative; boundary="${boundary}"` : `Content-Type: text/plain; charset=UTF-8`,
  ].filter(Boolean).join('\r\n')

  let rawEmail: string
  if (isHtml) {
    rawEmail = [
      headers,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      '',
      opts.body,
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      '',
      opts.bodyHtml,
      `--${boundary}--`,
    ].join('\r\n')
  } else {
    rawEmail = [headers, '', opts.body].join('\r\n')
  }

  const encoded = Buffer.from(rawEmail).toString('base64url')

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encoded },
  })

  return { messageId: res.data.id!, threadId: res.data.threadId || '' }
}

export async function gmailGetProfile(connectionId: number) {
  const auth = await getAuthenticatedClient(connectionId)
  const gmail = google.gmail({ version: 'v1', auth })
  const res = await gmail.users.getProfile({ userId: 'me' })
  return { email: res.data.emailAddress || '', messagesTotal: res.data.messagesTotal || 0 }
}

// ── Google Tasks helpers ────────────────────────────────

export async function tasksListTaskLists(connectionId: number) {
  const auth = await getAuthenticatedClient(connectionId)
  const tasks = google.tasks({ version: 'v1', auth })
  const res = await tasks.tasklists.list({ maxResults: 20 })
  return (res.data.items || []).map(t => ({ id: t.id!, title: t.title! }))
}

export async function tasksCreateTask(connectionId: number, taskListId: string, task: {
  title: string
  notes?: string
  due?: Date
}) {
  const auth = await getAuthenticatedClient(connectionId)
  const tasks = google.tasks({ version: 'v1', auth })
  const res = await tasks.tasks.insert({
    tasklist: taskListId,
    requestBody: {
      title: task.title,
      notes: task.notes || '',
      due: task.due?.toISOString(),
      status: 'needsAction',
    },
  })
  return { id: res.data.id!, title: res.data.title!, link: res.data.selfLink || '' }
}

export async function tasksCompleteTask(connectionId: number, taskListId: string, taskId: string) {
  const auth = await getAuthenticatedClient(connectionId)
  const tasks = google.tasks({ version: 'v1', auth })
  await tasks.tasks.patch({
    tasklist: taskListId,
    task: taskId,
    requestBody: { status: 'completed' },
  })
}

export async function tasksDeleteTask(connectionId: number, taskListId: string, taskId: string) {
  const auth = await getAuthenticatedClient(connectionId)
  const tasks = google.tasks({ version: 'v1', auth })
  await tasks.tasks.delete({ tasklist: taskListId, task: taskId })
}

// ── Google Meet helpers (standalone) ────────────────────

export async function createMeetLink(connectionId: number): Promise<string> {
  const auth = await getAuthenticatedClient(connectionId)
  const calendar = google.calendar({ version: 'v3', auth })

  const now = new Date()
  const end = new Date(now.getTime() + 60 * 60_000) // 1h from now

  const res = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: 'Reuniao ByChat',
      start: { dateTime: now.toISOString(), timeZone: 'America/Sao_Paulo' },
      end: { dateTime: end.toISOString(), timeZone: 'America/Sao_Paulo' },
      conferenceData: {
        createRequest: { requestId: `bychat-meet-${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } },
      },
    },
    conferenceDataVersion: 1,
  })

  const meetLink = res.data.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri || ''
  return meetLink
}
