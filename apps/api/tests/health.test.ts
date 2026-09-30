import { describe, expect, test } from 'bun:test'
import { app } from '../src/index'

describe('служебные маршруты', () => {
  test('GET /health отвечает ok', async () => {
    const response = await app.request('/health')
    expect(response.status).toBe(200)

    const body = (await response.json()) as { ok: boolean; service: string }
    expect(body.ok).toBe(true)
    expect(body.service).toBe('luciferus-api')
  })

  test('GET /v1/config отдаёт CrazyBucks и бонусы', async () => {
    const response = await app.request('/v1/config')
    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      currency: { code: string; symbol: string; isSimulation: boolean }
      economy: { signupBonus: number }
      example: string
    }

    expect(body.currency.symbol).toBe('C$')
    expect(body.currency.code).toBe('CBK')
    expect(body.currency.isSimulation).toBe(true)
    expect(body.economy.signupBonus).toBe(250)
    expect(body.example).toBe('C$1,420.50')
  })

  test('неизвестный маршрут — 404 в формате API', async () => {
    const response = await app.request('/v1/нет-такого')
    expect(response.status).toBe(404)

    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('not_found')
  })
})
