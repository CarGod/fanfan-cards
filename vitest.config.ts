import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    /*
     * 也收 .tsx。
     *
     * 组件测试进来是因为「自己画的下拉」——换掉原生控件之后，键盘操作、焦点管理、
     * 点外面关掉这些原本白给的行为，全变成了我们要自己保证的东西。
     */
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
