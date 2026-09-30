/**
 * Подтягивает корневой .env до первого чтения конфига.
 * Реализация живёт в @luciferus/config, здесь — только точка входа с побочным эффектом,
 * чтобы `packages/db` не тянул лишние модули внутрь drizzle-kit и скриптов.
 */
import '@luciferus/config/load-env'

export { loadRootEnv } from '@luciferus/config/load-env'
