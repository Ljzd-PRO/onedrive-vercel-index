import Redis from 'ioredis'
import siteConfig from '../../config/site.config'

// Persistent key-value store is provided by Redis, hosted on Upstash
// https://vercel.com/integrations/upstash
const kv = new Redis(process.env.REDIS_URL || '')
let localAccessToken: string | null = null
let localRefreshToken: string | null = null
let accessTokenExpiryAt: number = 0

export async function getOdAuthTokens(): Promise<{ accessToken: unknown; refreshToken: unknown }> {
  localRefreshToken = localRefreshToken || (await kv.get(`${siteConfig.kvPrefix}refresh_token`))
  if (!localAccessToken || Date.now() > accessTokenExpiryAt) {
    localAccessToken = await kv.get(`${siteConfig.kvPrefix}access_token`)
    accessTokenExpiryAt = await kv
      .ttl(`${siteConfig.kvPrefix}access_token`)
      .then(ttl => (ttl >= 0 ? Date.now() + ttl * 1000 : 0))
    console.log('Fetched access token from Redis and updated local access token.')
  }
  return {
    accessToken: localAccessToken,
    refreshToken: localRefreshToken,
  }
}

export async function storeOdAuthTokens({
  accessToken,
  accessTokenExpiry,
  refreshToken,
}: {
  accessToken: string
  accessTokenExpiry: number
  refreshToken: string
}): Promise<void> {
  await kv.set(`${siteConfig.kvPrefix}access_token`, accessToken, 'EX', accessTokenExpiry)
  await kv.set(`${siteConfig.kvPrefix}refresh_token`, refreshToken)
  localAccessToken = accessToken
  accessTokenExpiryAt = Date.now() + accessTokenExpiry * 1000
  localRefreshToken = refreshToken
}
