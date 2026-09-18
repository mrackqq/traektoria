# Образ для Railway и Render.
#
# Важное отличие от serverless-платформ: у сервиса есть постоянный диск.
# Состояние анкеты и прогресса лежит в файлах, и каталог данных задаётся
# через TRAJECTORY_DATA_DIR — на площадке он указывает на смонтированный том,
# иначе профиль исчезал бы между запросами.
#
# Ключ OpenRouter сюда не попадает никогда: он задаётся переменной окружения
# на площадке. В образе и в репозитории его нет.

FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Каталог данных по умолчанию совпадает с точкой монтирования тома.
ENV TRAJECTORY_DATA_DIR=/data

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next-build ./.next-build
COPY --from=build /app/next.config.mjs ./
COPY --from=build /app/scripts ./scripts

RUN mkdir -p /data

# Порт площадка передаёт через PORT; next start его читает сам.
EXPOSE 3000
CMD ["npm", "start"]
