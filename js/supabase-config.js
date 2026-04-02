// =============================================
// WEGWIJZER — Supabase configuratie
// =============================================

var SUPABASE_URL = 'https://anxdxiigivkkckrwogwl.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFueGR4aWlnaXZra2NrcndvZ3dsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMzY0NTQsImV4cCI6MjA5MDcxMjQ1NH0.C_eFytFrmuQLgkM70c_f4C__m6xxjfSnufqEStnTRKI';

// Initialiseer Supabase client
// window.supabase wordt aangemaakt door de CDN script, we hernoemen onze client
var supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
