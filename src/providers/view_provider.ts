import ServiceProvider from '@stravigor/kernel/core/service_provider'
import type Application from '@stravigor/kernel/core/application'
import ViewEngine from '../view/engine.ts'
import Context from '../http/context.ts'

export default class ViewProvider extends ServiceProvider {
  readonly name = 'view'
  override readonly dependencies = ['config']

  override register(app: Application): void {
    app.singleton(ViewEngine)
  }

  override boot(app: Application): void {
    const engine = app.resolve(ViewEngine)
    Context.setViewEngine(engine)
  }
}
