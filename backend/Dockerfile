FROM node:20-alpine

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --production=false --network-timeout 600000

COPY tsconfig.json ./
COPY src/ ./src/

RUN mkdir -p data

EXPOSE 4242

CMD ["npx", "tsx", "src/server.ts"]
