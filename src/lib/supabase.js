import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://vgntjbfqsvwhawewhkkf.supabase.co'
const supabaseKey = 'sb_publishable_vblR_4BurNiyOwkoIqwCMw_jnuXNyMS'

export const supabase = createClient(supabaseUrl, supabaseKey)