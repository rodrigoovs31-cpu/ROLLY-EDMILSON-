#!/bin/sh
# Lo ejecuta la imagen oficial de nginx antes de arrancar (carpeta /docker-entrypoint.d/).
exec /usr/local/bin/ssl-link.sh
