#!/usr/bin/env bash
# Деплой AURA HILLS на VDS (shared.metodoxia25.net).
# Запуск на сервере:  bash /srv/aura-hills/deploy/deploy-vds.sh
# Требования: /srv/aura-hills — git clone репо (ветка main);
# .env в корне репо с POLZA_API_KEY и AI_MODEL.
set -euo pipefail
cd "$(dirname "$0")/.."   # корень репо = приложение

git pull --ff-only origin main
npm ci --no-audit --no-fund

# На домене приложение живёт в корне → base '/'
VITE_BASE=/ npm run build

# backend-прокси под pm2; env (POLZA_API_KEY, AI_MODEL, PORT) подхватывается
# из .env в корне репо — pm2 наследует окружение шелла
set -a; source .env; set +a
if pm2 describe aura >/dev/null 2>&1; then
  pm2 restart aura --update-env
else
  pm2 start server/index.mjs --name aura --time
fi
pm2 save >/dev/null

echo "deployed: $(git log --oneline -1)"
