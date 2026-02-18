// @ts-nocheck — Client-side script; requires DOM types provided by the app's bundler config.
/**
 * Vue Islands Bootstrap
 *
 * Auto-discovers elements with [data-vue] attributes and mounts
 * Vue components on them via a single shared Vue app instance.
 * All islands share the same app context (plugins, provide/inject,
 * global components), connected to their marker elements via Teleport.
 *
 * Register your components on the window before this script runs:
 *
 *   import Counter from './components/Counter.vue'
 *   window.__vue_components = { counter: Counter }
 *
 * Optionally provide a setup function to install plugins:
 *
 *   window.__vue_setup = (app) => {
 *     app.use(somePlugin)
 *     app.provide('key', value)
 *   }
 *
 * Then in your .strav templates:
 *   <vue:counter :initial="{{ count }}" label="Click me" />
 */

import { createApp, defineComponent, h, Teleport } from 'vue'

declare global {
  interface Window {
    __vue_components?: Record<string, any>
    __vue_setup?: (app: any) => void
  }
}

function toPascalCase(str: string): string {
  return str.replace(/(^|-)(\w)/g, (_match, _sep, char) => char.toUpperCase())
}

function mountIslands(): void {
  const components = window.__vue_components ?? {}

  const islands: { Component: any; props: Record<string, any>; el: HTMLElement }[] = []

  document.querySelectorAll<HTMLElement>('[data-vue]').forEach(el => {
    const name = el.dataset.vue
    if (!name) return

    const Component = components[name] ?? components[toPascalCase(name)]
    if (!Component) {
      console.warn(`[islands] Unknown component: ${name}`)
      return
    }

    const props = JSON.parse(el.dataset.props ?? '{}')
    islands.push({ Component, props, el })
  })

  if (islands.length === 0) return

  const Root = defineComponent({
    render() {
      return islands.map(island =>
        h(Teleport, { to: island.el }, [h(island.Component, island.props)])
      )
    },
  })

  const app = createApp(Root)

  if (typeof window.__vue_setup === 'function') {
    window.__vue_setup(app)
  }

  const root = document.createElement('div')
  root.style.display = 'contents'
  document.body.appendChild(root)
  app.mount(root)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountIslands)
} else {
  mountIslands()
}
