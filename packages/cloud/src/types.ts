export interface CloudStorageOptions {
  supabaseUrl: string
  supabaseAnonKey: string
  projectKey: string
  onError?: 'throw' | 'memory-fallback'
}
