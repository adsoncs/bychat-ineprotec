import Redis from 'ioredis'

const redis = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: 3,
})

redis.on('error', (err) => {
  console.error('[Redis] Connection error:', err.message)
})

export { redis }
