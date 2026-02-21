import { TemplateError } from '@stravigor/kernel/exceptions/errors'
import type { Token } from './tokenizer.ts'

export interface CompilationResult {
  code: string
  layout?: string
}

interface StackEntry {
  type: 'if' | 'each' | 'section'
  line: number
  blockName?: string
}

function escapeJs(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

export function compile(tokens: Token[]): CompilationResult {
  const lines: string[] = []
  const stack: StackEntry[] = []
  let layout: string | undefined

  lines.push('let __out = "";')
  lines.push('const __blocks = {};')

  for (const token of tokens) {
    switch (token.type) {
      case 'text':
        lines.push(`__out += "${escapeJs(token.value)}";`)
        break

      case 'escaped':
        lines.push(`__out += __escape(${token.value});`)
        break

      case 'raw':
        lines.push(`__out += (${token.value});`)
        break

      case 'comment':
        // Stripped from output
        break

      case 'vue_island': {
        const attrs = token.attrs ?? {}
        const propParts: string[] = []
        for (const [name, attr] of Object.entries(attrs)) {
          if (attr.bound) {
            propParts.push(`${JSON.stringify(name)}: (${attr.value})`)
          } else {
            propParts.push(`${JSON.stringify(name)}: ${JSON.stringify(attr.value)}`)
          }
        }
        const propsExpr = `{${propParts.join(', ')}}`
        const tag = escapeJs(token.tag!)
        lines.push('__out += \'<div data-vue="' + tag + '"\'')
        lines.push(
          '  + " data-props=\'" + JSON.stringify(' + propsExpr + ").replace(/'/g, '&#39;') + \"'\""
        )
        lines.push("  + '></div>';")

        break
      }

      case 'directive':
        compileDirective(token, lines, stack, l => {
          layout = l
        })
        break
    }
  }

  if (stack.length > 0) {
    const unclosed = stack[stack.length - 1]!
    throw new TemplateError(`Unclosed @${unclosed.type} block (opened at line ${unclosed.line})`)
  }

  lines.push('return { output: __out, blocks: __blocks };')

  return { code: lines.join('\n'), layout }
}

function compileDirective(
  token: Token,
  lines: string[],
  stack: StackEntry[],
  setLayout: (name: string) => void
): void {
  switch (token.directive) {
    case 'if':
      if (!token.args) throw new TemplateError(`@if requires a condition at line ${token.line}`)
      lines.push(`if (${token.args}) {`)
      stack.push({ type: 'if', line: token.line })
      break

    case 'elseif':
      if (!token.args) throw new TemplateError(`@elseif requires a condition at line ${token.line}`)
      if (!stack.length || stack[stack.length - 1]!.type !== 'if') {
        throw new TemplateError(`@elseif without matching @if at line ${token.line}`)
      }
      lines.push(`} else if (${token.args}) {`)
      break

    case 'else':
      if (!stack.length || stack[stack.length - 1]!.type !== 'if') {
        throw new TemplateError(`@else without matching @if at line ${token.line}`)
      }
      lines.push(`} else {`)
      break

    case 'each': {
      if (!token.args) throw new TemplateError(`@each requires arguments at line ${token.line}`)
      const match = token.args.match(/^\s*(\w+)\s+in\s+(.+)$/)
      if (!match) {
        throw new TemplateError(`@each syntax error at line ${token.line}: expected "item in list"`)
      }
      const itemName = match[1]!
      const listExpr = match[2]!.trim()
      lines.push(`{`)
      lines.push(`  const __list = (${listExpr});`)
      lines.push(`  for (let $index = 0; $index < __list.length; $index++) {`)
      lines.push(`    const ${itemName} = __list[$index];`)
      lines.push(`    const $first = $index === 0;`)
      lines.push(`    const $last = $index === __list.length - 1;`)
      stack.push({ type: 'each', line: token.line })
      break
    }

    case 'layout': {
      if (!token.args) throw new TemplateError(`@layout requires a name at line ${token.line}`)
      const name = token.args.replace(/^['"]|['"]$/g, '').trim()
      setLayout(name)
      break
    }

    case 'section': {
      if (!token.args) throw new TemplateError(`@section requires a name at line ${token.line}`)
      const name = token.args.replace(/^['"]|['"]$/g, '').trim()
      const nameStr = JSON.stringify(name)
      // Capture content between @section and @end into __blocks.
      // Does not output inline — content flows to parent layout via result.blocks.
      lines.push(`__blocks[${nameStr}] = (function() { let __out = "";`)
      stack.push({ type: 'section', line: token.line, blockName: name })
      break
    }

    case 'show': {
      if (!token.args) throw new TemplateError(`@show requires a name at line ${token.line}`)
      const name = token.args.replace(/^['"]|['"]$/g, '').trim()
      const nameStr = JSON.stringify(name)
      // Output block content: prefer child-provided variable, fall back to __blocks.
      lines.push(`if (typeof ${name} !== 'undefined' && ${name} !== null) {`)
      lines.push(`  __out += ${name};`)
      lines.push(`} else {`)
      lines.push(`  __out += __blocks[${nameStr}] || '';`)
      lines.push(`}`)
      break
    }

    case 'include': {
      if (!token.args) throw new TemplateError(`@include requires arguments at line ${token.line}`)
      const match = token.args.match(/^\s*['"]([^'"]+)['"]\s*(?:,\s*(.+))?\s*$/)
      if (!match) {
        throw new TemplateError(
          `@include syntax error at line ${token.line}: expected "'name'" or "'name', data"`
        )
      }
      const name = match[1]!
      const dataExpr = match[2] ? match[2].trim() : '{}'
      lines.push(`__out += await __include(${JSON.stringify(name)}, ${dataExpr});`)
      break
    }

    case 'islands': {
      const src = token.args ? token.args.replace(/^['"]|['"]$/g, '').trim() : '/islands.js'
      // Use __islandsSrc (set by IslandBuilder via ViewEngine.setGlobal) for versioned URL, fallback to static src
      lines.push(
        `__out += '<script src="' + (typeof __islandsSrc !== 'undefined' ? __islandsSrc : '${escapeJs(src)}') + '"><\\/script>';`
      )
      break
    }

    case 'csrf':
      lines.push(
        `__out += '<input type="hidden" name="_token" value="' + __escape(csrfToken) + '">';`
      )
      break

    case 'end': {
      if (!stack.length) {
        throw new TemplateError(`Unexpected @end at line ${token.line} — no open block`)
      }
      const top = stack.pop()!
      if (top.type === 'section') {
        lines.push(`  return __out; })();`)
      } else if (top.type === 'each') {
        lines.push(`  }`) // close for loop
        lines.push(`}`) // close block scope
      } else {
        lines.push(`}`)
      }
      break
    }
  }
}
