import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import remarq from '@web-remarq/unplugin/vite'
export default defineConfig({ plugins: [vue(), remarq()] })
