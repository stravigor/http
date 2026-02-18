import { resolve, join } from 'node:path'
import {
  readdirSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  watch as fsWatch,
  type FSWatcher,
} from 'node:fs'
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib'
import { vueSfcPlugin } from './vue_plugin.ts'
import ViewEngine from '../engine.ts'
import type { BunPlugin } from 'bun'

export interface IslandBuilderOptions {
  /** Directory containing .vue SFC files. Default: './resources/islands' */
  islandsDir?: string
  /** Directory where the bundle is output. Default: './public/builds' */
  outDir?: string
  /** Output filename. Default: 'islands.js' */
  outFile?: string
  /** Enable minification. Default: true in production */
  minify?: boolean
  /** Enable pre-compression (gzip + brotli). Default: true */
  compress?: boolean
  /** Base URL path for the islands script. Default: '/builds/' */
  basePath?: string
}

export interface IslandManifest {
  file: string
  version: string
  src: string
  size: number
  gzip?: number
  brotli?: number
}

export class IslandBuilder {
  private islandsDir: string
  private outDir: string
  private outFile: string
  private minify: boolean
  private compress: boolean
  private basePath: string
  private watcher: FSWatcher | null = null
  private _version: string | null = null
  private _manifest: IslandManifest | null = null

  constructor(options: IslandBuilderOptions = {}) {
    this.islandsDir = resolve(options.islandsDir ?? './resources/islands')
    this.outDir = resolve(options.outDir ?? './public/builds')
    this.outFile = options.outFile ?? 'islands.js'
    this.minify = options.minify ?? Bun.env.NODE_ENV === 'production'
    this.compress = options.compress ?? true
    this.basePath = options.basePath ?? '/builds/'
  }

  /** The content hash of the last build, or null if not yet built. */
  get version(): string | null {
    return this._version
  }

  /** The versioned script src (e.g. '/islands.js?v=abc12345'), or the plain path if not yet built. */
  get src(): string {
    const base = this.basePath + this.outFile
    return this._version ? `${base}?v=${this._version}` : base
  }

  /** The build manifest with file info and sizes, or null if not yet built. */
  get manifest(): IslandManifest | null {
    return this._manifest
  }

  /** Discover all .vue files in the islands directory (recursively). */
  private discoverIslands(): { name: string; path: string }[] {
    let entries: string[]
    try {
      entries = readdirSync(this.islandsDir, { recursive: true }) as string[]
    } catch {
      return []
    }

    return entries
      .filter(f => f.endsWith('.vue'))
      .sort()
      .map(f => ({
        name: f.slice(0, -4).replace(/\\/g, '/'),
        path: join(this.islandsDir, f),
      }))
  }

  /** Check if a setup file exists in the islands directory. */
  private hasSetupFile(): string | null {
    for (const ext of ['ts', 'js']) {
      const p = join(this.islandsDir, `setup.${ext}`)
      if (existsSync(p)) return p
    }
    return null
  }

  /** Generate the virtual entry point that imports all islands + mount logic. */
  private generateEntry(islands: { name: string; path: string }[]): string {
    const setupPath = this.hasSetupFile()
    const lines: string[] = []

    lines.push(`import { createApp, defineComponent, h, Teleport } from 'vue';`)
    lines.push('')

    if (setupPath) {
      lines.push(`import __setup from '${setupPath}';`)
      lines.push('')
    }

    // Import each island component
    for (let i = 0; i < islands.length; i++) {
      lines.push(`import __c${i} from '${islands[i]!.path}';`)
    }

    lines.push('')
    lines.push('var components = {')
    for (let i = 0; i < islands.length; i++) {
      lines.push(`  '${islands[i]!.name}': __c${i},`)
    }
    lines.push('};')

    lines.push('')
    lines.push('function mountIslands() {')
    lines.push('  var islands = [];')
    lines.push("  document.querySelectorAll('[data-vue]').forEach(function(el) {")
    lines.push('    var name = el.dataset.vue;')
    lines.push('    if (!name) return;')
    lines.push('    var Component = components[name];')
    lines.push('    if (!Component) {')
    lines.push("      console.warn('[islands] Unknown component: ' + name);")
    lines.push('      return;')
    lines.push('    }')
    lines.push("    var props = JSON.parse(el.dataset.props || '{}');")
    lines.push('    islands.push({ Component: Component, props: props, el: el });')
    lines.push('  });')
    lines.push('')
    lines.push('  if (islands.length === 0) return;')
    lines.push('')
    lines.push('  var Root = defineComponent({')
    lines.push('    render: function() {')
    lines.push('      return islands.map(function(island) {')
    lines.push(
      '        return h(Teleport, { to: island.el }, [h(island.Component, island.props)]);'
    )
    lines.push('      });')
    lines.push('    }')
    lines.push('  });')
    lines.push('')
    lines.push('  var app = createApp(Root);')
    if (setupPath) {
      lines.push('  if (typeof __setup === "function") __setup(app);')
    }
    lines.push('  var root = document.createElement("div");')
    lines.push('  root.style.display = "contents";')
    lines.push('  document.body.appendChild(root);')
    lines.push('  app.mount(root);')
    lines.push('}')
    lines.push('')
    lines.push("if (document.readyState === 'loading') {")
    lines.push("  document.addEventListener('DOMContentLoaded', mountIslands);")
    lines.push('} else {')
    lines.push('  mountIslands();')
    lines.push('}')

    return lines.join('\n')
  }

  /** Compute a short content hash for cache busting. */
  private computeHash(content: Uint8Array): string {
    const hasher = new Bun.CryptoHasher('md5')
    hasher.update(content)
    return hasher.digest('hex').slice(0, 8)
  }

  /** Generate pre-compressed versions of the bundle. */
  private async generateCompressed(
    outPath: string,
    content: Uint8Array
  ): Promise<{ gzip?: number; brotli?: number }> {
    const sizes: { gzip?: number; brotli?: number } = {}

    // Gzip
    const gzipped = Bun.gzipSync(content as Uint8Array<ArrayBuffer>)
    await Bun.write(outPath + '.gz', gzipped)
    sizes.gzip = gzipped.length

    // Brotli
    try {
      const brotli = brotliCompressSync(Buffer.from(content), {
        params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
      })
      await Bun.write(outPath + '.br', brotli)
      sizes.brotli = brotli.length
    } catch {
      // Brotli may not be available in all environments
    }

    return sizes
  }

  /** Remove stale compressed files. */
  private cleanCompressed(outPath: string): void {
    for (const ext of ['.gz', '.br']) {
      try {
        unlinkSync(outPath + ext)
      } catch {
        // File may not exist
      }
    }
  }

  /** Update the ViewEngine global so @islands() picks up the versioned src. */
  private syncViewEngine(): void {
    try {
      ViewEngine.setGlobal('__islandsSrc', this.src)
    } catch {
      // ViewEngine may not be initialized yet
    }
  }

  /** Build the islands bundle. Returns true if islands were found and built. */
  async build(): Promise<boolean> {
    const islands = this.discoverIslands()

    if (islands.length === 0) {
      return false
    }

    // Ensure output directory exists
    mkdirSync(this.outDir, { recursive: true })

    const entrySource = this.generateEntry(islands)

    // Virtual entry plugin — resolves the synthetic entry from memory
    const virtualEntryPlugin: BunPlugin = {
      name: 'virtual-entry',
      setup(build) {
        build.onResolve({ filter: /^virtual:islands-entry$/ }, () => ({
          path: 'virtual:islands-entry',
          namespace: 'island-entry',
        }))

        build.onLoad({ filter: /.*/, namespace: 'island-entry' }, () => ({
          contents: entrySource,
          loader: 'js',
        }))
      },
    }

    const result = await Bun.build({
      entrypoints: ['virtual:islands-entry'],
      outdir: this.outDir,
      naming: this.outFile,
      minify: this.minify,
      target: 'browser',
      plugins: [virtualEntryPlugin, vueSfcPlugin()],
      define: {
        __VUE_OPTIONS_API__: 'true',
        __VUE_PROD_DEVTOOLS__: 'false',
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
      },
    })

    if (!result.success) {
      const messages = result.logs.map(l => l.message ?? String(l)).join('\n')
      throw new Error(`Island build failed:\n${messages}`)
    }

    // Read the output, compute version hash, optionally compress
    const outPath = join(this.outDir, this.outFile)
    const content = new Uint8Array(await Bun.file(outPath).arrayBuffer())

    this._version = this.computeHash(content)

    let compressedSizes: { gzip?: number; brotli?: number } = {}
    if (this.compress) {
      compressedSizes = await this.generateCompressed(outPath, content)
    } else {
      this.cleanCompressed(outPath)
    }

    this._manifest = {
      file: this.outFile,
      version: this._version,
      src: this.src,
      size: content.length,
      ...compressedSizes,
    }

    // Write manifest
    await Bun.write(
      join(this.outDir, this.outFile.replace(/\.js$/, '.manifest.json')),
      JSON.stringify(this._manifest, null, 2)
    )

    // Sync version with ViewEngine
    this.syncViewEngine()

    const sizeKB = (content.length / 1024).toFixed(1)
    const gzKB = compressedSizes.gzip
      ? ` | gzip: ${(compressedSizes.gzip / 1024).toFixed(1)}kB`
      : ''
    const brKB = compressedSizes.brotli
      ? ` | br: ${(compressedSizes.brotli / 1024).toFixed(1)}kB`
      : ''

    console.log(
      `[islands] Built ${islands.length} component(s) → ${this.outFile} (${sizeKB}kB${gzKB}${brKB}) v=${this._version}`
    )
    return true
  }

  /** Watch the islands directory and rebuild on changes. */
  watch(): void {
    if (this.watcher) return

    this.build().catch(err => console.error('[islands] Build error:', err))

    this.watcher = fsWatch(this.islandsDir, { recursive: true }, (_event, filename) => {
      if (filename && !filename.endsWith('.vue') && !filename.startsWith('setup.')) return
      console.log('[islands] Change detected, rebuilding...')
      this.build().catch(err => console.error('[islands] Rebuild error:', err))
    })

    console.log(`[islands] Watching ${this.islandsDir}`)
  }

  /** Stop watching. */
  unwatch(): void {
    this.watcher?.close()
    this.watcher = null
  }
}
