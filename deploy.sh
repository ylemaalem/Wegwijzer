#!/bin/bash
export $(cat .env | xargs)
npx supabase functions deploy chat --no-verify-jwt --project-ref anxdxiigivkkckrwogwl
