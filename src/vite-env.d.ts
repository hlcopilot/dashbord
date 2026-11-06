/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 生产环境 Worker 根地址，如 https://stock-api.xxx.workers.dev；本地开发留空 */
  readonly VITE_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module 'vue-echarts' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}
