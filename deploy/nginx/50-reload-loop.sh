#!/bin/sh
# Arranca en segundo plano la recarga periódica (certificados renovados).
nohup /usr/local/bin/reload-loop.sh >/dev/null 2>&1 &
