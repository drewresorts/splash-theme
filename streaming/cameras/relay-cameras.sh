#!/usr/bin/env bash
# Sends the shop's cameras to the streaming server, one live feed each.
# Runs on the shop computer (Mac or Linux), which must be on the same network
# as the cameras. Setup: streaming/README.md → "Shop cameras".
#
#   cameras.txt  one camera per line: a feed name, then its RTSP address
#   relay.env    the server address and the publish password
#
# Each camera is restarted by itself if it drops (power cut, Wi-Fi blip).
# Needs ffmpeg (Mac: brew install ffmpeg). Stop with Ctrl+C.

set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
LIST="${1:-$DIR/cameras.txt}"
[ -f "$DIR/relay.env" ] && . "$DIR/relay.env"

: "${STREAM_DOMAIN:?Put STREAM_DOMAIN in relay.env (see relay.env.example)}"
: "${PUBLISH_PASS:?Put PUBLISH_PASS in relay.env (see relay.env.example)}"
PUBLISH_USER="${PUBLISH_USER:-publisher}"
command -v ffmpeg >/dev/null || { echo "ffmpeg is missing. On a Mac: brew install ffmpeg"; exit 1; }
[ -f "$LIST" ] || { echo "No camera list at $LIST (copy cameras.example.txt to cameras.txt)"; exit 1; }

say() { echo "$(date '+%H:%M:%S') $*"; }

relay() {
  name=$1
  src=$2
  while true; do
    say "$name: connecting"
    # Video only, passed straight through (the camera must send H.264), so the
    # computer does almost no work. The site plays feeds muted anyway.
    ffmpeg -hide_banner -loglevel error -nostdin \
      -rtsp_transport tcp -timeout 10000000 -i "$src" \
      -map 0:v:0 -c:v copy -an \
      -f flv "rtmp://$STREAM_DOMAIN/$name?user=$PUBLISH_USER&pass=$PUBLISH_PASS"
    say "$name: dropped, trying again in 5 seconds"
    sleep 5
  done
}

trap 'kill 0' INT TERM
count=0
while read -r name src _; do
  case "$name" in '' | '#'*) continue ;; esac
  if [ -z "${src:-}" ]; then
    say "skipping '$name': no camera address after the name"
    continue
  fi
  relay "$name" "$src" &
  count=$((count + 1))
done <"$LIST"

[ "$count" -gt 0 ] || { echo "No cameras listed in $LIST"; exit 1; }
say "sending $count camera(s) to $STREAM_DOMAIN. Feeds play at https://$STREAM_DOMAIN/NAME/"
wait
