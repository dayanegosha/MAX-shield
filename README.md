# .max shield

Бот для проверки ссылок и файлов в чатах мессенджера MAX.

Бот получает сообщения, отправляет найденные ссылки и файлы в очередь, проверяет их через Kaspersky OpenTIP и возвращает результат в чат. История проверок хранится в PostgreSQL, фоновые задачи обрабатывает RabbitMQ.

## запуск

Нужны Docker и Docker Compose. Создайте `.env` в корне проекта:

```env
BOT_TOKEN=token
DATABASE_URL=postgres://user:password@postgres:5432/maxshield
AMQP_URL=amqp://user:password@rabbit:5672
QUEUE_NAME=check
KASPERSKY_API_KEY=key
KASPERSKY_URL_API=https://opentip.kaspersky.com/api/v1/search/domain
KASPERSKY_TIMEOUT_MS=3000
```

Затем запустите сервисы:

```sh
docker compose up --build
```

Для остановки используйте `docker compose down`, для просмотра логов — `docker compose logs -f`.

Основные части проекта находятся в `src/bot`, `src/worker`, `src/services` и `src/db`.

## лицензия

[Apache 2.0](LICENSE)
