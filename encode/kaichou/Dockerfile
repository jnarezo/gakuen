FROM node:14-alpine

COPY . /
RUN apk update && apk upgrade && npm install

ENTRYPOINT ["npm", "start"]