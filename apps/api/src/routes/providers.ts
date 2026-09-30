import { Hono } from 'hono'
import { findProviderProfile } from '../services/catalog'

export const providerRoutes = new Hono()

/** Профиль студии: её игры и суммарная активность. */
providerRoutes.get('/:slug', async (c) => {
  const slug = c.req.param('slug')
  const provider = await findProviderProfile(slug)

  if (!provider) {
    return c.json({ error: 'not_found', message: `Студия «${slug}» не найдена` }, 404)
  }

  return c.json({ provider })
})
