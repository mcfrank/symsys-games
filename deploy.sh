#!/usr/bin/env bash
# Build with Cloud Build and deploy to Cloud Run in hs-hs-langcog-gemini.
# One-time setup (service account, Artifact Registry repo) is in the README.
set -euo pipefail

PROJECT=hs-hs-langcog-gemini
REGION=${REGION:-us-west2}
SERVICE=symsys-games
IMAGE=us-central1-docker.pkg.dev/$PROJECT/symsys-games/symsys-games:$(git rev-parse --short HEAD)$(git diff --quiet HEAD || echo -dirty)

# Comma-separated Google accounts allowed into /dashboard.
ADMIN_EMAILS=${ADMIN_EMAILS:-mcfrank@stanford.edu,ngoodman@stanford.edu,bkrejci@stanford.edu}
# OAuth client shared with the Turing test app (same project); its authorized
# JavaScript origins must include this service's URL.
GOOGLE_OAUTH_CLIENT_ID=${GOOGLE_OAUTH_CLIENT_ID:-246740721864-enerq8jieean4r1qq9gsrqoiktsl5llg.apps.googleusercontent.com}
# Keep one instance warm during the class week; set MIN_INSTANCES=0 afterwards.
MIN_INSTANCES=${MIN_INSTANCES:-1}

gcloud builds submit --project "$PROJECT" --tag "$IMAGE" .

# max-instances=1: the class state lives in one process (snapshotted to Firestore).
gcloud run deploy "$SERVICE" \
  --project "$PROJECT" --region "$REGION" --image "$IMAGE" \
  --service-account "symsys-games-run@$PROJECT.iam.gserviceaccount.com" \
  --allow-unauthenticated \
  --min-instances "$MIN_INSTANCES" --max-instances 1 --concurrency 1000 --timeout 3600 --session-affinity \
  --cpu 1 --memory 1Gi --cpu-boost --no-cpu-throttling \
  --set-env-vars "^|^GOOGLE_GENAI_USE_VERTEXAI=true|GOOGLE_CLOUD_PROJECT=$PROJECT|GOOGLE_CLOUD_LOCATION=global|GEMINI_PARTICIPANT_MODELS=gemini-2.5-flash,gemini-3.8-flash|ADMIN_EMAILS=$ADMIN_EMAILS|GOOGLE_OAUTH_CLIENT_ID=$GOOGLE_OAUTH_CLIENT_ID${EXTRA_ENV:+|$EXTRA_ENV}"
