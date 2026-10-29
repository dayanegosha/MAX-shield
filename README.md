# .max shield

бот для проверки ссылок и файлов в чатах мессенджера MAX.

бот получает сообщения, отправляет найденные ссылки и файлы в очередь, проверяет их через Kaspersky OpenTIP и возвращает результат в чат. история проверок хранится в PostgreSQL, фоновые задачи обрабатывает RabbitMQ.

## запуск

нужны Docker и Docker Compose. создайте `.env` в корне проекта:

```env
BOT_TOKEN=token
KASPERSKY_API_KEY=key
KASPERSKY_URL_API=https://opentip.kaspersky.com/api/v1/search/url
KASPERSKY_TIMEOUT_MS=3000
```

PostgreSQL, RabbitMQ и очередь проверок настроены в `docker-compose.yml`. запустите сервисы:

```sh
docker compose up --build
```

для остановки используйте `docker compose down`, для просмотра логов — `docker compose logs -f`.

основные части проекта находятся в `src/bot`, `src/worker`, `src/services` и `src/db`.

## лицензия

[Apache 2.0](LICENSE)
