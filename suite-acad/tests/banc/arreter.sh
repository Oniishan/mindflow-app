#!/bin/bash
touch /tmp/sarun/stop-edge; sleep 1.5
export WINEPREFIX=${WINEPREFIX:-/tmp/wineprefix}; wineserver -k 2>/dev/null; true
