import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://xrplgiruwjvrkzqtkphl.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhycGxnaXJ1d2p2cmt6cXRrcGhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0NDM4NjcsImV4cCI6MjA4OTAxOTg2N30.yABjVveEpMmghIIJE_N35ALLL2JVduNdQf_L32L6A9M'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
