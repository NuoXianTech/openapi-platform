import assert from 'node:assert/strict'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import * as Vue from 'vue'
import ts from 'typescript'
import { parse, compileScript } from 'vue/compiler-sfc'

const uiRequire = createRequire(realpathSync(resolve('node_modules/@nuxt/ui/package.json')))
const route = Vue.reactive({ path: '/docs', meta: { layout: false, appTheme: undefined } })
let head
let appConfig, tv
const themes = {}
const passthrough = { inheritAttrs:false, setup:(_,{slots})=>()=>slots.default?.({open:true,close(){}}) }
const primitive = kind => ({inheritAttrs:false,setup:(_,{attrs,slots})=>()=>Vue.h('div',{'data-kind':kind,...attrs},slots.default?.())})
const reka = {...uiRequire('reka-ui'),DialogRoot:passthrough,DialogPortal:passthrough,Primitive:primitive('card')}
for (const key of ['DialogTrigger','DialogOverlay','DialogContent','DialogTitle','DialogDescription','DialogClose','VisuallyHidden']) reka[key]=primitive(key)
const helpers = {
  ...Object.fromEntries(Object.entries(Vue).filter(([key]) => /^[A-Za-z_$][\w$]*$/.test(key))),
  useRoute: () => route,
  useSiteSettings: () => ({ settings: Vue.ref({ siteName: 'OpenAPI', siteImg: '', siteDescription: '' }) }),
  useI18n: () => ({ locale: Vue.ref('zh-CN'), setLocale: async () => {} }),
  useAuth: () => ({ user: Vue.ref(null) }),
  useHead: value => { head = value },
  defineAppConfig: value => value
}
let themeContext, themeConstants
function requireMock(id) {
  if (id === 'vue') return Vue
  if (['defu', '@vueuse/core', 'tailwind-variants'].includes(id)) return uiRequire(id)
  if (id === 'reka-ui') return reka
  if (id === '#build/app.config') return {__esModule:true,default:appConfig}
  if (id.startsWith('#build/ui/')) return {__esModule:true,default:themes[id.split('/').at(-1)]}
  if (id.includes('utils/tv')) return tv
  if (id.includes('useForwardProps')) return {useForwardProps:props=>props}
  if (id.includes('useFieldGroup')) return {FieldGroupReset:passthrough}
  if (id.includes('useLocale')) return {useLocale:()=>({t:key=>key})}
  if (id.includes('usePortal')) return {usePortal:()=>Vue.computed(()=>({disabled:true}))}
  if (id.includes('utils/overlay')) return {pointerDownOutside(){}}
  if (id === './Button.vue') return {__esModule:true,default:primitive('button')}
  if (id === '#imports') return { useAppConfig: () => appConfig }
  if (id.includes('utils/index')) return { get: (obj, path) => path.split('.').reduce((value, key) => value?.[key], obj) }
  if (id.includes('useComponentProps')) return themeContext
  if (id.includes('constants/app-ui')) return themeConstants
  if (id === '@nuxt/ui/locale') return { en: {}, zh_cn: {} }
  if (id.includes('locale-defaults')) return { DEFAULT_LOCALE: 'zh-CN' }
  if (id === './SiteBrand.vue') return { __esModule: true, default: { render: () => Vue.h('span', 'OpenAPI') } }
  throw new Error('Unexpected import ' + id)
}
function evaluate(source) {
  const module = { exports: {} }
  const js = ts.transpileModule(source.replaceAll('import.meta.client', 'false'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require','module','exports',...Object.keys(helpers),js)(requireMock,module,module.exports,...Object.values(helpers))
  return module.exports
}
function component(filename) {
  const { descriptor } = parse(readFileSync(filename,'utf8'),{filename})
  return evaluate(compileScript(descriptor,{id:filename,inlineTemplate:true}).content).default
}
themeConstants = evaluate(readFileSync('app/constants/app-ui.ts','utf8'))
appConfig = evaluate(readFileSync('app/app.config.ts','utf8')).default
tv = evaluate(readFileSync('node_modules/@nuxt/ui/dist/runtime/utils/tv.js','utf8'))
themeContext = evaluate(readFileSync('node_modules/@nuxt/ui/dist/runtime/composables/useComponentProps.js','utf8'))
// `nuxt prepare` writes these templates to the project's default buildDir.
// The dev cache under node_modules is not available in clean CI checkouts.
for (const name of ['modal', 'slideover', 'card']) {
  themes[name] = evaluate(readFileSync(resolve('.nuxt/ui', `${name}.ts`), 'utf8')).default
}
const Modal=component('node_modules/@nuxt/ui/dist/runtime/components/Modal.vue')
const Slideover=component('node_modules/@nuxt/ui/dist/runtime/components/Slideover.vue')
const Card=component('node_modules/@nuxt/ui/dist/runtime/components/Card.vue')
const Theme = component('node_modules/@nuxt/ui/dist/runtime/components/Theme.vue')
const AuthShell = component('app/components/common/AppAuthShell.vue')
const App = component('app/app.vue')
const node = (type,text='') => ({type,text,props:{},children:[],parent:null})
function remove(el) { if(el.parent) el.parent.children.splice(el.parent.children.indexOf(el),1); el.parent=null }
const renderer=Vue.createRenderer({
  createElement:type=>node(type), createText:text=>node('#text',text), createComment:text=>node('#comment',text),
  setText:(el,text)=>{el.text=text}, setElementText:(el,text)=>{el.text=text;el.children=[]},
  parentNode:el=>el.parent, nextSibling:el=>el.parent?.children[el.parent.children.indexOf(el)+1]??null,
  patchProp:(el,key,_previous,value)=>{el.props[key]=value},
  insert(el,parent,anchor=null){if(el.parent)remove(el);const index=anchor?parent.children.indexOf(anchor):-1;parent.children.splice(index<0?parent.children.length:index,0,el);el.parent=parent},
  remove
})

const walk=el=>[el,...el.children.flatMap(walk)]
const Probe=Vue.defineComponent({
 props:['id'],
 setup(props){
  return ()=>Vue.h('section',{'data-probe':props.id},[
   Vue.h(Modal,{open:true,title:'Dialog',description:'Details',close:false,ui:{content:'sm:max-w-xl'}},{body:()=>Vue.h('p','dialog content')}),
   Vue.h(Slideover,{open:true,title:'Slide',description:'Details',close:false,class:'local-trigger',ui:{content:'sm:max-w-[34rem]'}},{default:()=>Vue.h('button','open'),body:()=>Vue.h('p','slide content')}),
   Vue.h(Slideover,{open:true,title:'Programmatic',description:'Details',close:false,ui:{content:'sm:max-w-md'}},{body:()=>Vue.h('p','programmatic content')}),
   Vue.h(Card,{ui:{root:'local-card'}},{default:()=>Vue.h('p','card body')})
  ])
 }
})
const root=node('root')
const app=renderer.createApp(App)
app.component('UTheme',Theme)
app.component('UApp',{inheritAttrs:false,setup:(_props,{slots})=>()=>Vue.h('div',[slots.default?.(),Vue.h(Probe,{id:'overlay-outlet'})])})
app.component('NuxtLayout',{setup:(_props,{slots})=>()=>slots.default?.()})
app.component('CommonPageOutlet',{setup:()=>()=>route.meta.appTheme==='auth'?Vue.h(AuthShell,{showBrand:false},{default:()=>Vue.h(Probe,{id:'page'})}):Vue.h(Probe,{id:'page'})})
app.config.warnHandler=message=>{throw Error(message)}
app.mount(root)
for(const [path,layout,appTheme,expected] of [
 ['/docs',false,undefined,'public'],
 ['/admin/overview',{name:'dashboard',props:{dashboardId:'admin'}},undefined,'dashboard'],
 ['/user/overview','dashboard',undefined,'dashboard'],
 ['/login',false,'auth','auth'],
 ['/stats',false,undefined,'public']
]){
 route.path=path;route.meta.layout=layout;route.meta.appTheme=appTheme
 await Vue.nextTick();await Vue.nextTick()
 assert.equal(head.htmlAttrs['data-app-theme'](),expected)
 for(const id of ['page','overlay-outlet']){
  const rendered=walk(walk(root).find(n=>n.props['data-probe']===id))
  const dialogs=rendered.filter(n=>n.props['data-kind']==='DialogContent')
  assert.equal(dialogs.length,3)
  assert.ok(dialogs[0].props.class.includes('design-dialog')&&dialogs[0].props.class.includes('sm:max-w-xl'))
  assert.ok(dialogs[1].props.class.includes('design-slideover')&&dialogs[1].props.class.includes('sm:max-w-[34rem]'))
  assert.ok(dialogs[2].props.class.includes('design-slideover')&&dialogs[2].props.class.includes('sm:max-w-md'))
  const trigger=rendered.find(n=>n.props['data-kind']==='DialogTrigger')
  assert.ok(trigger.props.class.includes('local-trigger'))
  assert.ok(!trigger.props.class.includes('design-slideover'),'content marker must not move onto a trigger')
  const card=rendered.find(n=>n.props['data-kind']==='card')
  assert.ok(card.props.class.includes('design-card')&&card.props.class.includes('local-card'))
 }
}
app.unmount()
console.log('Actual App/UTheme/Modal/Slideover/Card rendering passed across public, both dashboard layouts, auth and back; page and overlay outlet retain slot markers with local overrides.')
