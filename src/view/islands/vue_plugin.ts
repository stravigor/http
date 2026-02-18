import { parse, compileScript, compileTemplate, compileStyle } from '@vue/compiler-sfc'
import type { BunPlugin } from 'bun'

function hashId(path: string): string {
  const hasher = new Bun.CryptoHasher('md5')
  hasher.update(path)
  return hasher.digest('hex').slice(0, 8)
}

export function vueSfcPlugin(): BunPlugin {
  return {
    name: 'vue-sfc',
    setup(build) {
      build.onLoad({ filter: /\.vue$/ }, async args => {
        const source = await Bun.file(args.path).text()
        const id = hashId(args.path)
        const scopeId = `data-v-${id}`
        const hasScoped = false // computed below
        const { descriptor, errors } = parse(source, { filename: args.path })

        if (errors.length > 0) {
          throw new Error(
            `Vue SFC parse error in ${args.path}:\n${errors.map(e => e.message).join('\n')}`
          )
        }

        const scoped = descriptor.styles.some(s => s.scoped)

        // ── Script ────────────────────────────────────────────────────────
        let scriptCode = ''
        let bindings: Record<string, any> | undefined

        if (descriptor.script || descriptor.scriptSetup) {
          const result = compileScript(descriptor, {
            id,
            inlineTemplate: !!descriptor.scriptSetup,
            sourceMap: false,
            templateOptions: scoped
              ? {
                  scoped: true,
                  id,
                  compilerOptions: { scopeId },
                }
              : undefined,
          })
          scriptCode = result.content
          bindings = result.bindings
        }

        // ── Template (Options API only — script setup uses inlineTemplate) ─
        let templateCode = ''

        if (descriptor.template && !descriptor.scriptSetup) {
          const result = compileTemplate({
            source: descriptor.template.content,
            filename: args.path,
            id,
            scoped,
            compilerOptions: {
              bindingMetadata: bindings,
              scopeId: scoped ? scopeId : undefined,
            },
          })

          if (result.errors.length > 0) {
            throw new Error(
              `Vue template error in ${args.path}:\n${result.errors.map(e => (typeof e === 'string' ? e : e.message)).join('\n')}`
            )
          }

          templateCode = result.code
        }

        // ── Styles ────────────────────────────────────────────────────────
        const styles: string[] = []

        for (const styleBlock of descriptor.styles) {
          const result = compileStyle({
            source: styleBlock.content,
            filename: args.path,
            id: scopeId,
            scoped: !!styleBlock.scoped,
          })

          if (result.errors.length > 0) {
            console.warn(`[vue-sfc] Style warning in ${args.path}:`, result.errors)
          }

          styles.push(result.code)
        }

        // ── Assemble ──────────────────────────────────────────────────────
        let output = ''

        // Inject styles at module load time
        if (styles.length > 0) {
          const css = JSON.stringify(styles.join('\n'))
          output += `(function(){var s=document.createElement('style');s.textContent=${css};document.head.appendChild(s)})();\n`
        }

        if (descriptor.scriptSetup) {
          // <script setup> with inlineTemplate — scriptCode is a complete module
          // Rewrite the default export to capture the component and set __scopeId
          if (scoped) {
            output += scriptCode.replace(/export\s+default\s+/, 'const __sfc__ = ') + '\n'
            output += `__sfc__.__scopeId = ${JSON.stringify(scopeId)};\n`
            output += 'export default __sfc__;\n'
          } else {
            output += scriptCode + '\n'
          }
        } else {
          // Options API — stitch script + template render function
          if (scriptCode) {
            output += scriptCode.replace(/export\s+default\s*\{/, 'const __component__ = {') + '\n'
          } else {
            output += 'const __component__ = {};\n'
          }

          if (templateCode) {
            output += templateCode + '\n'
            output += '__component__.render = render;\n'
          }

          if (scoped) {
            output += `__component__.__scopeId = ${JSON.stringify(scopeId)};\n`
          }

          output += 'export default __component__;\n'
        }

        const isTs = descriptor.script?.lang === 'ts' || descriptor.scriptSetup?.lang === 'ts'
        return { contents: output, loader: isTs ? 'ts' : 'js' }
      })
    },
  }
}
