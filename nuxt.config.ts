import { copyFile, cp, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, resolve } from 'node:path'
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME } from './shared/config/locale-defaults'

// https://nuxt.com/docs/api/configuration/nuxt-config
const require = createRequire(import.meta.url)
const { name: appName, version: appVersion } = require('./package.json') as {
  name: string
  version: string
}

const isProduction = process.env.NODE_ENV === 'production'
const databaseMigrationsDir = 'server/db/migrations/postgresql'
const runtimeScripts = [
  'scripts/migrate.mjs', 'scripts/database-migrator.mjs',
  'scripts/start.mjs', 'scripts/doctor.mjs',
  'scripts/runtime-config.mjs', 'scripts/runtime-checks.mjs',
  'scripts/pglite-client.mjs'
]
const databaseMigratorModule = resolve('scripts/database-migrator.mjs')
const deploymentPackage = {
  name: appName,
  version: appVersion,
  private: true,
  type: 'module',
  engines: { node: '>=24 <25' },
  scripts: {
    start: 'node server/start.mjs',
    migrate: 'node server/migrate.mjs',
    doctor: 'node server/doctor.mjs'
  }
}
const privatePageRouteRule = {
  headers: {
    'cache-control': 'private, no-store'
  }
}

export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxtjs/i18n',
    '@nuxt/ui',
    '@vueuse/nuxt',
  ],
  devtools: {
    enabled: !isProduction,
  },
  app: {
    pageTransition: { name: 'page', mode: 'out-in' }
  },

  css: ['~/assets/css/main.css'],
  imports: {
    // Apply shared feedback defaults to existing callers while the wrapper
    // explicitly imports Nuxt UI's native store and lifecycle.
    imports: [{ name: 'useToast', from: '~/composables/use-toast', priority: 10 }]
  },
  ui: {
    fonts: false,
    experimental: {
      componentDetection: true
    }
  },
  // 运行时密钥走 runtimeConfig（Nuxt 官方推荐范式）。默认值一律留空字符串、
  // 绝不引用 process.env —— 空默认值不会把任何 .env 值烤进 build 产物；
  // 运行时用 Nuxt 同构变量覆盖（auth.secret → NUXT_AUTH_SECRET，
  // apiKeySecret → NUXT_API_KEY_SECRET）。
  // 切忌把默认值设成异名 env（如 secret: process.env.AUTH_SECRET）：那会在 build 时
  // 求值并烤进产物，且运行时只认 NUXT_AUTH_*、纯名字失效 —— Nuxt 文档明示的头号坑。
  runtimeConfig: {
    apiKeySecret: '',
    public: {
      appVersion
    },
    auth: {
      secret: ''
    },
    proxy: {
      source: '',
      trustedCidrs: '',
      forwardedHops: 1
    },
    redis: {
      url: '',
      keyPrefix: 'openapi:',
      connectTimeoutMs: 2_000
    }
  },
  routeRules: {
    '/admin': privatePageRouteRule,
    '/admin/**': privatePageRouteRule,
    '/user': privatePageRouteRule,
    '/user/**': privatePageRouteRule,
    '/login': privatePageRouteRule,
    '/register': privatePageRouteRule,
    '/oauth': privatePageRouteRule,
    '/oauth/**': privatePageRouteRule,
    '/verify-email': privatePageRouteRule,
    '/confirm-email-change': privatePageRouteRule,
    '/forgot-password': privatePageRouteRule,
    '/reset-password': privatePageRouteRule
  },
  compatibilityDate: '2026-06-30',
  nitro: {
    preset: 'node-server',
    errorHandler: '~~/server/error.ts',
    externals: {
      // This module lives outside server/, so Nitro otherwise emits a broken
      // relative import for it from .nuxt/dev on Windows.
      inline: [databaseMigratorModule, resolve('scripts/runtime-config.mjs'), resolve('scripts/runtime-checks.mjs'), resolve('scripts/pglite-client.mjs')]
    },
    compressPublicAssets: {
      gzip: true,
      brotli: true
    },
    hooks: {
      async compiled(nitro) {
        const artifactTasks = [
          cp(
            resolve(databaseMigrationsDir),
            resolve(nitro.options.output.serverDir, 'db/migrations/postgresql'),
            { recursive: true, force: true }
          ),
          ...runtimeScripts.map(script => copyFile(
            resolve(script),
            resolve(nitro.options.output.serverDir, basename(script))
          ))
        ]

        if (!nitro.options.dev) {
          artifactTasks.push(writeFile(
            resolve(nitro.options.output.dir, 'package.json'),
            `${JSON.stringify(deploymentPackage, null, 2)}\n`,
            'utf8'
          ))
        }

        await Promise.all(artifactTasks)
      }
    }
  },
  vite: {
    optimizeDeps: {
      include: [
        '@internationalized/date',
        '@unovis/vue'
      ]
    }
  },
  i18n: {
    defaultLocale: DEFAULT_LOCALE,
    strategy: 'no_prefix',
    langDir: 'locales',
    bundle: {
      fullInstall: false,
      runtimeOnly: true
    },
    locales: [{
      code: 'en-US',
      language: 'en-US',
      name: 'English',
      files: [
        'en-US/common.json',
        'en-US/auth.json',
        'en-US/public.json',
        'en-US/user.json',
        'en-US/admin/core.json',
        'en-US/admin/logs.json',
        'en-US/admin/credits.json',
        'en-US/admin/users.json',
        'en-US/admin/content.json',
        'en-US/admin/apis.json',
        'en-US/admin/system.json'
      ]
    }, {
      code: DEFAULT_LOCALE,
      language: DEFAULT_LOCALE,
      name: '简体中文',
      files: [
        'zh-CN/common.json',
        'zh-CN/auth.json',
        'zh-CN/public.json',
        'zh-CN/user.json',
        'zh-CN/admin/core.json',
        'zh-CN/admin/logs.json',
        'zh-CN/admin/credits.json',
        'zh-CN/admin/users.json',
        'zh-CN/admin/content.json',
        'zh-CN/admin/apis.json',
        'zh-CN/admin/system.json'
      ]
    }],
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: LOCALE_COOKIE_NAME,
      redirectOn: 'root'
    }
  },

  icon: {
    serverBundle: {
      collections: ['lucide', 'mdi']
    },
  },
})
