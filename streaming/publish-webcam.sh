#!/usr/bin/env bash
# Pushes a local webcam (or any video device) into MediaMTX as the `cam` stream.
# Override the env vars below to match your setup.
#
# Linux/macOS USB webcam example:
#   ./publish-webcam.sh
#
# Windows DirectShow example:
#   INPUT_OPTS="-f dshow -i video=\"USB Camera\":audio=\"Microphone\"" ./publish-webcam.sh
#
# RTSP IP camera example (no transcode, just relay):
#   INPUT_OPTS="-rtsp_transport tcp -i rtsp://user:pass@192.168.1.20:554/stream" \
#     VIDEO_CODEC="copy" AUDIO_CODEC="copy" ./publish-webcam.sh

set -euo pipefail

PUBLISH_HOST="${PUBLISH_HOST:-127.0.0.1}"
PUBLISH_PORT="${PUBLISH_PORT:-8554}"
PUBLISH_USER="${PUBLISH_USER:-publisher}"
PUBLISH_PASS="${PUBLISH_PASS:-changeme}"
STREAM_NAME="${STREAM_NAME:-cam}"

VIDEO_DEVICE="${VIDEO_DEVICE:-/dev/video0}"
RESOLUTION="${RESOLUTION:-1280x720}"
FRAMERATE="${FRAMERATE:-30}"
BITRATE="${BITRATE:-2500k}"
GOP="${GOP:-60}"

if [[ "$(uname -s)" == "Darwin" ]]; then
  INPUT_OPTS="${INPUT_OPTS:-"-f avfoundation -framerate ${FRAMERATE} -video_size ${RESOLUTION} -i 0:none"}"
else
  INPUT_OPTS="${INPUT_OPTS:-"-f v4l2 -framerate ${FRAMERATE} -video_size ${RESOLUTION} -i ${VIDEO_DEVICE}"}"
fi

VIDEO_CODEC="${VIDEO_CODEC:-libx264}"
AUDIO_CODEC="${AUDIO_CODEC:-aac}"

URL="rtsp://${PUBLISH_USER}:${PUBLISH_PASS}@${PUBLISH_HOST}:${PUBLISH_PORT}/${STREAM_NAME}"

exec ffmpeg -hide_banner ${INPUT_OPTS} \
  -c:v "${VIDEO_CODEC}" -preset veryfast -tune zerolatency -profile:v baseline \
  -b:v "${BITRATE}" -maxrate "${BITRATE}" -bufsize "${BITRATE}" -g "${GOP}" -pix_fmt yuv420p \
  -c:a "${AUDIO_CODEC}" -b:a 96k -ar 44100 \
  -f rtsp -rtsp_transport tcp "${URL}"
