import ServiceProvider from '@stravigor/kernel/core/service_provider'
import type Application from '@stravigor/kernel/core/application'
import Auth from '../auth/auth.ts'

export interface AuthProviderOptions {
  /** Function to load a user by ID. Required for auth middleware. */
  resolver?: (id: string | number) => Promise<unknown>
  /** Whether to auto-create the access_tokens table. Default: `true` */
  ensureTables?: boolean
}

export default class AuthProvider extends ServiceProvider {
  readonly name = 'auth'
  override readonly dependencies = ['database']

  constructor(private options?: AuthProviderOptions) {
    super()
  }

  override register(app: Application): void {
    app.singleton(Auth)
  }

  override async boot(app: Application): Promise<void> {
    app.resolve(Auth)

    if (this.options?.resolver) {
      Auth.useResolver(this.options.resolver)
    }

    if (this.options?.ensureTables !== false) {
      await Auth.ensureTables()
    }
  }
}
