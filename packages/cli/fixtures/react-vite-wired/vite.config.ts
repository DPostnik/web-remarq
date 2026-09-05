import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import remarq from '@web-remarq/unplugin/vite'
// The brace form older CLI versions printed - must keep working.
export default defineConfig({ plugins: [react(), remarq({ include: ['src/**/*.{jsx,tsx}'] })] })
