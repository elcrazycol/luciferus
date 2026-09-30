import { serverConfig } from '@luciferus/config'
import { getRedis } from './redis'

/**
 * События об изменениях баланса.
 *
 * Кошелёк публикует событие после каждой успешной операции, а подписчики —
 * SSE-поток игрока — получают его и обновляют интерфейс. Без этого баланс
 * менялся бы только после перезагрузки страницы.
 *
 * Публикация — удобство, а не источник правды: если Redis недоступен, операция
 * всё равно проходит, просто интерфейс обновится позже. Поэтому ошибки здесь
 * только логируются.
 */

export type BalanceEvent = {
  balance: string
  /** На сколько изменилось: удобно показать «+50» рядом с балансом. */
  delta: string
  /** Почему изменилось: `bet`, `payout`, `reload_bonus`, `admin_adjust`. */
  reason: string
  at: string
}

function channelFor(userId: string): string {
  return `luciferus:balance:${userId}`
}

/**
 * Отдельное соединение для подписок.
 *
 * Redis запрещает обычные команды на соединении в режиме подписки, поэтому
 * переиспользовать основной клиент нельзя: rate limit и кэш сломались бы,
 * как только первый игрок откроет поток.
 */
let subscriber: Bun.RedisClient | null = null

function getSubscriber(): Bun.RedisClient {
  subscriber ??= new Bun.RedisClient(serverConfig.redisUrl)
  return subscriber
}

export async function publishBalance(userId: string, event: BalanceEvent): Promise<void> {
  try {
    await getRedis().publish(channelFor(userId), JSON.stringify(event))
  } catch (error) {
    console.warn('[events] не удалось опубликовать изменение баланса:', error)
  }
}

/**
 * Подписка на баланс игрока. Возвращает функцию отписки.
 *
 * Счётчик подписчиков на канал нужен, потому что у одного игрока может быть
 * открыто несколько вкладок: отписка последней не должна гасить остальные.
 */
const listeners = new Map<string, Set<(event: BalanceEvent) => void>>()

export function subscribeBalance(
  userId: string,
  onEvent: (event: BalanceEvent) => void,
): () => void {
  const channel = channelFor(userId)
  const handlers = listeners.get(channel) ?? new Set()
  const isFirst = handlers.size === 0

  handlers.add(onEvent)
  listeners.set(channel, handlers)

  if (isFirst) {
    try {
      void getSubscriber().subscribe(channel, (message) => {
        if (typeof message !== 'string') return

        let parsed: unknown
        try {
          parsed = JSON.parse(message)
        } catch {
          return
        }

        if (typeof parsed !== 'object' || parsed === null) return

        for (const handler of listeners.get(channel) ?? []) {
          handler(parsed as BalanceEvent)
        }
      })
    } catch (error) {
      console.warn('[events] не удалось подписаться на баланс:', error)
    }
  }

  return () => {
    const current = listeners.get(channel)
    if (!current) return

    current.delete(onEvent)
    if (current.size > 0) return

    listeners.delete(channel)
    try {
      void getSubscriber().unsubscribe(channel)
    } catch {
      // Соединение могло уже закрыться — ничего страшного.
    }
  }
}

/** Сколько игроков сейчас слушают баланс. Для диагностики и тестов. */
export function activeSubscriptions(): number {
  return listeners.size
}

/** Закрывает соединение подписчика. Нужно тестам, чтобы процесс завершился. */
export function closeEventSubscriber(): void {
  listeners.clear()
  subscriber?.close()
  subscriber = null
}
