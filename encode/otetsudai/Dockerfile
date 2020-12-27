FROM node:14-alpine

RUN apk update && apk add --no-cache \
      ffmpeg

COPY . /
RUN npm install

ENTRYPOINT ["npm", "start"]