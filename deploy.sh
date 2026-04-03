#!/bin/bash
# Wegwijzer — Edge Function deploy script (bash/Git Bash)
# Gebruik: ./deploy.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "FOUT: .env bestand niet gevonden. Maak .env aan met:"
  echo "  SUPABASE_ACCESS_TOKEN=jouw_token"
  echo "  SUPABASE_PROJECT_REF=jouw_project_ref"
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

if [ -z "$SUPABASE_ACCESS_TOKEN" ] || [ -z "$SUPABASE_PROJECT_REF" ]; then
  echo "FOUT: SUPABASE_ACCESS_TOKEN of SUPABASE_PROJECT_REF ontbreekt in .env"
  exit 1
fi

echo "Deploying edge function 'chat' naar project $SUPABASE_PROJECT_REF..."
npx supabase functions deploy chat --no-verify-jwt --project-ref "$SUPABASE_PROJECT_REF"
echo "Klaar!"
