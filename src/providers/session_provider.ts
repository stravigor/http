import ServiceProvider from '@stravigor/kernel/core/service_provider'
import type Application from '@stravigor/kernel/core/application'
import SessionManager from '../session/session_manager.ts'

export interface SessionProviderOptions {
  /** Whether to auto-create the sessions table. Default: `true` */
  ensureTable?: boolean
}

export default class SessionProvider extends ServiceProvider {
  readonly name = 'session'
  override readonly dependencies = ['database']

  constructor(private options?: SessionProviderOptions) {
    super()
  }

  override register(app: Application): void {
    app.singleton(SessionManager)
  }

  override async boot(app: Application): Promise<void> {
    app.resolve(SessionManager)

    if (this.options?.ensureTable !== false) {
      await SessionManager.ensureTable()
    }
  }
}
