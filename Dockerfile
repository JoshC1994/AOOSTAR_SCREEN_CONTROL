FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache bash coreutils lm-sensors && (apk add --no-cache radeontop || true) && (apk add --no-cache intel-gpu-tools || true)

COPY package.json bun.lock* package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

VOLUME ["/app/data"]

CMD ["npx", "tsx", "server.ts"]
