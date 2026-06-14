const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;

function initializeSupabase() {
  if (!supabaseUrl || !supabaseServiceKey) {
    console.log('Supabase credentials not configured');
    return null;
  }
  try {
    supabase = createClient(supabaseUrl, supabaseServiceKey);
    console.log('Supabase initialized successfully');
    return supabase;
  } catch (error) {
    console.error('Supabase initialization failed:', error.message);
    return null;
  }
}

function getSupabase() {
  return supabase;
}

module.exports = { initializeSupabase, getSupabase };
