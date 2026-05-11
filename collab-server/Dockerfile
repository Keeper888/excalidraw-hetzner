FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --production=false

COPY src/ ./src/

EXPOSE 4180

CMD ["npx", "tsx", "src/index.ts"]
