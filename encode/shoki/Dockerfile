# Google Shaka Packager
FROM google/shaka-packager as baseshaka

FROM node:14-alpine
RUN apk update && apk add --no-cache \
      libstdc++ \
      python
COPY . /
# Copy packager result binaries to our final image.
COPY --from=baseshaka /usr/bin/packager \
                      /usr/bin/mpd_generator \
                      /usr/bin/pssh-box.py \
                      /usr/bin/
# Copy pyproto directory, which is needed by pssh-box.py script. This line
# cannot be combined with the line above as Docker's copy command skips the
# directory itself. See https://github.com/moby/moby/issues/15858 for details.
COPY --from=baseshaka /usr/bin/pyproto /usr/bin/pyproto
RUN npm install

ENTRYPOINT ["npm", "start"]