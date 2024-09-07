FROM node:14-alpine AS build

WORKDIR /usr/src/app

COPY package.json package-lock.json ./

RUN npm install

COPY . .

FROM node:14-alpine

WORKDIR /usr/src/app

COPY --from=build /usr/src/app /usr/src/app

ENV NODE_ENV=production

RUN npm install --only=production

EXPOSE 3000

USER node

CMD ["node", "index.js"]
