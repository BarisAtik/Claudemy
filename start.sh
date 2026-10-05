#!/usr/bin/env sh
cd "$(dirname "$0")"
( sleep 1; (command -v xdg-open >/dev/null && xdg-open http://localhost:4777) || (command -v open >/dev/null && open http://localhost:4777) ) >/dev/null 2>&1 &
exec node server.js
