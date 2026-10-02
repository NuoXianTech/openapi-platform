import { parse, compileScript } from 'vue/compiler-sfc'
import ts from 'typescript'

/** Compile real setup scripts for lifecycle tests without pretending to render UI. */
export function vueSetupPlugin() {
  return {
    name: 'test-vue-setup',
    transform(source: string, id: string) {
      if (!id.endsWith('.vue')) return
      const { descriptor } = parse(source, { filename: id })
      const script = compileScript(descriptor, { id })
      return {
        code: ts.transpileModule(script.content, {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
        }).outputText,
        map: null
      }
    }
  }
}
