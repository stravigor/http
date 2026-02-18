import ServiceProvider from '@stravigor/kernel/core/service_provider'
import type Application from '@stravigor/kernel/core/application'
import Server from '../http/server.ts'
import Router from '../http/router.ts'

export default class HttpProvider extends ServiceProvider {
  readonly name = 'http'
  override readonly dependencies = ['config']

  private server: Server | null = null

  override register(app: Application): void {
    if (!app.has(Router)) app.singleton(Router)
    app.singleton(Server)
  }

  override boot(app: Application): void {
    const router = app.resolve(Router)
    this.server = app.resolve(Server)
    this.server.start(router)
  }

  override shutdown(): void {
    this.server?.stop()
    this.server = null
  }
}
