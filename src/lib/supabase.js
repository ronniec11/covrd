import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://vzqopjbwkxpawogdtvmf.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ6cW9wamJ3a3hwYXdvZ2R0dm1mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNjI2NjEsImV4cCI6MjA4OTkzODY2MX0.f34d9XvNldLCSe2ZwSUZZva1gpJVYpAhONzZdzVdkUE'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
})
