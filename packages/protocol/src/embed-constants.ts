/**
 * Константы и типы протокола встраивания — без Zod.
 *
 * Живут отдельно от `embed.ts` намеренно: SDK собирается в браузерный бандл, и
 * тянуть туда валидатор ради двух констант — это 400 КБ вместо 8. Схемы проверки
 * нужны только на стороне портала и API, где приходят недоверенные данные.
 */

/** Версия протокола. Меняется только при ломающих изменениях. */
export const EMBED_PROTOCOL_VERSION = 1

/** Сколько SDK ждёт сессию от портала, прежде чем уйти в мок-режим. */
export const EMBED_INIT_TIMEOUT_MS = 10_000

/** Как часто портал повторяет `casino:init`, пока не получит `casino:hello`. */
export const EMBED_INIT_RETRY_MS = 300

/** Коды ошибок, которые SDK отдаёт автору игры. */
export const SDK_ERROR_CODES = [
  'handshake_timeout',
  'origin_not_allowed',
  'game_disabled',
  'not_ready',
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'insufficient_funds',
  'limit_exceeded',
  'rate_limited',
  'network_error',
  'internal_error',
] as const

export type SdkErrorCode = (typeof SDK_ERROR_CODES)[number]

/** Игровой токен: то, что портал передал игре, в разобранном виде. */
export type GameTokenClaims = {
  /** Версия формата токена. */
  v: number
  /** Аудитория: игровой токен нельзя применить к портальным маршрутам. */
  aud: 'game'
  /** Игрок. */
  sub: string
  /** Игра, к которой привязан токен. */
  gid: string
  slug: string
  /** Сессия портала, из которой выдан токен. Позволяет отзывать его выходом из аккаунта. */
  sid: string
  iat: number
  exp: number
}

export type GameSessionPayload = {
  /** Игровой токен. Живёт ограниченное время и работает только для своей игры. */
  token: string
  expiresAt: string
}
