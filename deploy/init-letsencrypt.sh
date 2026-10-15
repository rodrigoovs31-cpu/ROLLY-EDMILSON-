#!/usr/bin/env bash
# Obtiene el certificado HTTPS gratuito de Let's Encrypt (solo la primera vez).
# Antes: el dominio (y www si lo usas) debe apuntar con un registro A a la IP de este servidor,
# y los puertos 80 y 443 deben estar abiertos.
#   ./deploy/init-letsencrypt.sh            certificado real
#   STAGING=1 ./deploy/init-letsencrypt.sh  prueba (sin límite de intentos de Let's Encrypt)
set -euo pipefail
cd "$(dirname "$0")/.."

env_value() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | tr -d '"'"'"; }
[ -f .env ] || { echo "Falta .env (cp .env.example .env)"; exit 1; }
DOMAIN="$(env_value DOMAIN)"
EMAIL="$(env_value LETSENCRYPT_EMAIL)"
[ -n "$DOMAIN" ] && [ -n "$EMAIL" ] || { echo "Completa DOMAIN y LETSENCRYPT_EMAIL en .env"; exit 1; }

DOMAINS=(-d "$DOMAIN")
if getent hosts "www.$DOMAIN" >/dev/null; then DOMAINS+=(-d "www.$DOMAIN"); else echo "Aviso: www.$DOMAIN no tiene DNS; el certificado será solo para $DOMAIN"; fi
EXTRA=()
[ "${STAGING:-0}" = "1" ] && EXTRA+=(--staging)

mkdir -p deploy/certbot/conf deploy/certbot/www
echo "1/3 Arrancando nginx (con un certificado temporal)…"
docker compose up -d nginx

echo "2/3 Pidiendo el certificado a Let's Encrypt para: ${DOMAINS[*]}"
docker compose run --rm --entrypoint certbot certbot certonly \
  --webroot -w /var/www/certbot "${DOMAINS[@]}" \
  --email "$EMAIL" --agree-tos --no-eff-email --non-interactive \
  --key-type ecdsa --cert-name "$DOMAIN" "${EXTRA[@]}"

echo "3/3 Activando el certificado en nginx…"
docker compose exec nginx sh -c 'ssl-link.sh && nginx -s reload'
docker compose up -d certbot
echo "Listo: https://$DOMAIN  (se renueva solo)"
