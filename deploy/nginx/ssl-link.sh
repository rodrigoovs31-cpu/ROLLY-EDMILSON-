#!/bin/sh
# Elige qué certificado usa nginx:
#   - el de Let's Encrypt si ya existe (/etc/letsencrypt/live/$DOMAIN/)
#   - si no, uno temporal autofirmado, para que nginx arranque y Let's Encrypt pueda validar el dominio.
set -eu
: "${DOMAIN:?Falta la variable DOMAIN}"
LIVE="/etc/letsencrypt/live/${DOMAIN}"
SSL=/etc/nginx/ssl
mkdir -p "$SSL"

if [ -s "$LIVE/fullchain.pem" ] && [ -s "$LIVE/privkey.pem" ]; then
  ln -sf "$LIVE/fullchain.pem" "$SSL/fullchain.pem"
  ln -sf "$LIVE/privkey.pem" "$SSL/privkey.pem"
  echo "ssl-link: usando el certificado de Let's Encrypt para ${DOMAIN}"
else
  if [ ! -s "$SSL/selfsigned.crt" ]; then
    openssl req -x509 -nodes -newkey rsa:2048 -days 7 \
      -keyout "$SSL/selfsigned.key" -out "$SSL/selfsigned.crt" \
      -subj "/CN=${DOMAIN}" >/dev/null 2>&1
  fi
  ln -sf "$SSL/selfsigned.crt" "$SSL/fullchain.pem"
  ln -sf "$SSL/selfsigned.key" "$SSL/privkey.pem"
  echo "ssl-link: AVISO certificado temporal autofirmado para ${DOMAIN} (ejecuta deploy/init-letsencrypt.sh)"
fi
