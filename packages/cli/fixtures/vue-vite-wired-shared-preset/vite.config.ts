import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { remarqPreset } from './shared/build-config'
export default defineConfig({ plugins: [vue(), remarqPreset()] })
