#!/bin/bash
export $(cat .env | xargs)
# Versie 2.45.5 want nieuwere versies worden geblokkeerd door Device Guard policy
npx supabase@2.45.5 functions deploy chat --no-verify-jwt --project-ref anxdxiigivkkckrwogwl
