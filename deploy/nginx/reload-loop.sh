#!/bin/sh
# Recarga nginx cada 6 horas para tomar los certificados renovados por certbot.
while :; do
  sleep 6h
  /usr/local/bin/ssl-link.sh && nginx -s reload
done
