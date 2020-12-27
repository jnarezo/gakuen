#!/bin/sh

docker run -d \
  -v gakuen-vol:/media \
  --name jouhou \
  gakuen_jouhou

# docker run -d -v gakuen-vol:/media --name jouhou gakuen_jouhou
# Volume location: \\wsl$\docker-desktop\mnt\host\wsl\docker-desktop-data\data\docker\volumes\gakuen-vol