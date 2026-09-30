/**
 * SHA-256 и HMAC-SHA256 через WebCrypto.
 *
 * Одна реализация на всех — и на сервере, и в браузере. Своя криптография тут
 * была бы худшим решением: ошибка в самодельном SHA-256 обнуляет весь смысл
 * «проверяемой честности», а заметить её в тестах можно не сразу. WebCrypto есть
 * везде, где живёт наш код: в Bun, в Node 18+ и в браузере на защищённом origin.
 *
 * Цена — асинхронный API. Для проверки раундов это неважно.
 */

function subtle(): SubtleCrypto {
  const crypto = globalThis.crypto
  if (!crypto?.subtle) {
    throw new Error('WebCrypto недоступен: проверка честности требует crypto.subtle')
  }

  return crypto.subtle
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await subtle().digest('SHA-256', new TextEncoder().encode(value))
  return toHex(digest)
}

/**
 * HMAC-SHA256. Ключ не может быть пустым.
 *
 * Это ограничение WebCrypto, а не математики: Node считает HMAC с пустым ключом,
 * а браузерный `importKey` отказывается с `DataError`. Если бы мы это не поймали,
 * проверка раунда работала бы на сервере и падала в браузере — то есть ровно там,
 * где игрок пытается убедиться в честности. Поэтому отказ сделан явным.
 */
export async function hmacSha256Hex(key: string, message: string): Promise<string> {
  if (key.length === 0) {
    throw new TypeError('Ключ HMAC не может быть пустым')
  }

  const encoder = new TextEncoder()

  const cryptoKey = await subtle().importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signature = await subtle().sign('HMAC', cryptoKey, encoder.encode(message))
  return toHex(signature)
}
