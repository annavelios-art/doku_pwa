import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://tkktqhbjgqeahulimgkm.supabase.co'
const supabaseKey = 'sb_publishable_YNBVEMytlo0quNvAyiEBvA_iylXa3Aq'

export const supabase = createClient(supabaseUrl, supabaseKey)
