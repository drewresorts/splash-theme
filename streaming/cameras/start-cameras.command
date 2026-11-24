#!/usr/bin/env bash
# Double-click on a Mac to start sending the cameras (it opens a Terminal window;
# keep it open). To start it whenever the Mac turns on, add this file to
# System Settings → General → Login Items.
cd "$(dirname "$0")" && exec ./relay-cameras.sh
