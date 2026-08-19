FROM node:22-alpine AS dependencies

WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22-alpine AS builder

WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_ENABLE_API_BEARER_AUTH=false
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY \
    NEXT_PUBLIC_ENABLE_API_BEARER_AUTH=$NEXT_PUBLIC_ENABLE_API_BEARER_AUTH

RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

CMD ["node", "server.js"]
