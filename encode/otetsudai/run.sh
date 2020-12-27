#!/bin/sh

docker run -d \
  -v gakuen-vol:/media \
  --name tsuku \
  gakuen_tsuku

# docker run -d -v gakuen-vol:/media --name tsuku gakuen_tsuku
# Volume location: \\wsl$\docker-desktop\mnt\host\wsl\docker-desktop-data\data\docker\volumes\gakuen-vol