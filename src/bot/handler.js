import dotenv from "dotenv";
dotenv.config();

import { Bot, Keyboard } from "@maxhub/max-bot-api";
import { processUrl, handleUserUrl, getUserDangerousStats, getMultipleUsersDangerousStats } from "../db/queries.js";
import { publishToQueue } from "../queue/rabbit.js";
import { extractUrls } from "../utils/extractUrls.js";
import { advices, tests, testThemes } from "./securityData.js";

// MAX может повторно прислать событие добавления; держим ключ 10 секунд.
const processedEvents = new Set();

function getEventKey(chatId, userId = null) {
  return userId ? `user_${chatId}_${userId}` : `bot_${chatId}`;
}

const userStates = new Map();

function createMenuKeyboard() {
  return Keyboard.inlineKeyboard([
    [
      Keyboard.button.callback('🧪 Пройти тест', 'choose_theme'),
      Keyboard.button.callback('💡 Получить совет', 'get_advice')
    ]
  ]);
}

function createThemeKeyboard() {
  const rows = testThemes.map((theme, i) => [
    Keyboard.button.callback(theme.name, `start_test:${i}`)
  ]);
  rows.push([Keyboard.button.callback('Назад', 'back_to_menu', { intent: 'negative' })]);
  return Keyboard.inlineKeyboard(rows);
}

function createQuestionKeyboard(options, qIndex) {
  const rows = options.map((opt, idx) => [
    Keyboard.button.callback(opt, `answer:${qIndex}:${idx}`)
  ]);
  rows.push([Keyboard.button.callback('❌ Отмена', 'cancel_test', { intent: 'negative' })]);
  return Keyboard.inlineKeyboard(rows);
}

async function main() {
  const token = process.env.BOT_TOKEN;
  if (!token || token.trim() === "") {
    console.error("[bot] BOT_TOKEN is missing. Set it in .env or compose env.");
    await new Promise((r) => setTimeout(r, 5000));
    process.exit(1);
  }

  const bot = new Bot(token);

  bot.on("bot_started", async (ctx) => {
    await ctx.reply(
      "Привет! Я MAX-Киберщит — твой надежный помощник в борьбе с киберугрозами!\n\nМоя главная задача — обезопасить тебя и твои беседы от вредоносных ссылок и подозрительных файлов.\n(пропиши /menu чтобы увидеть это сообщение еще раз)\n\nМой функционал:\n\n🔍 Проверка ссылок: Просто пришли мне любую ссылку, и я быстро её проанализирую.\n📎 Проверка файлов: Я проверяю файлы на наличие угроз, прежде чем ты их откроешь.\n👥 Защита группы: Добавь меня в чат или группу, и я автоматически начну проверять все сообщения.\n\nБудь уверен — твоя цифровая безопасность под надёжной защитой! 🚀",
      { attachments: [createMenuKeyboard()] }
    );
  });

  bot.command('menu', async (ctx) => {
    if (ctx.message.recipient.chat_type === 'dialog' && !userStates.has(sender.user_id)) {
      await ctx.reply(
        "Привет! Я MAX-Киберщит — твой надежный помощник в борьбе с киберугрозами!\n\nМоя главная задача — обезопасить тебя и твои беседы от вредоносных ссылок и подозрительных файлов.\n\nМой функционал:\n\n🔍 Проверка ссылок: Просто пришли мне любую ссылку, и я быстро её проанализирую.\n📎 Проверка файлов: Я проверяю файлы на наличие угроз, прежде чем ты их откроешь.\n👥 Защита группы: Добавь меня в чат или группу, и я автоматически начну проверять все сообщения.\n\nБудь уверен — твоя цифровая безопасность под надёжной защитой! 🚀",
        { attachments: [createMenuKeyboard()] }
      );
      userStates.set(sender.user_id, { greeted: true });
    }
  });

  bot.on("message_created", async (ctx) => {
    const msg = ctx.message;
    if (!msg) {
      console.warn("[bot] no message in ctx");
      return;
    }

    const body = msg.body || {};
    const recipient = msg.recipient || {};
    const sender = msg.sender || {};

    try {
      let items = extractUrls(msg.body);
      if(msg?.link && msg.link.type === "forward"){
        items = items.concat(extractUrls(msg.link.message));
      }
      if (!items.length) {
        return;
      }

      if (items.length === 1) {
        const { url, type } = items[0];
        await ctx.reply(
          type === "file"
            ? "📁 Файл получен, начинаю проверку..."
            : `🔍 Проверяю ссылку:\n${url}`,
        );
      } else {
        await ctx.reply(
          `🔍 Найдено ${items.length} объектов (ссылки/файлы), запускаю проверку...`,
        );
      }

      const chatTypeRaw = recipient.chat_type;
      const chatForQueue = {
        chat_id: recipient.chat_id,
        chat_type: chatTypeRaw,
        user_id: recipient.user_id ?? sender.user_id ?? null,
      };

      for (const item of items) {
        const { url, type } = item;

        const urlRow = await processUrl(url, type);

        if (chatTypeRaw !== "dialog" && sender.user_id && urlRow?.url_id) {
          await handleUserUrl(sender.user_id, urlRow.url_id);
        }

        const payload = {
          message_id: body.mid,
          url,
          type,
          chat: chatForQueue,
        };

        if (item.file_id) payload.file_id = item.file_id;
        if (item.file_token) payload.file_token = item.file_token;

        await publishToQueue(payload);
        console.log("[bot] URL queued:", JSON.stringify(payload));
      }
    } catch (e) {
      console.error("[bot] handler error:", e);
    }
  });

  bot.on("bot_added", async (ctx) => {
    try {
      const chatId = ctx.update.chat_id;
      const eventKey = getEventKey(chatId);
      
      if (processedEvents.has(eventKey)) {
        console.log(`[bot] bot_added event for chat ${chatId} already processed, skipping`);
        return;
      }
      
      processedEvents.add(eventKey);
      console.log(`[bot] added to chat ${chatId}`);

      setTimeout(() => {
        processedEvents.delete(eventKey);
      }, 10000);

      await ctx.api.raw.post('messages', {
        body: { 
          text: "👋 Привет! Я бот для проверки безопасности. Я буду автоматически проверять все ссылки и файлы в этом чате на вредоносность. Но чтобы я мог обрабатывать сообщения, назначьте меня администратором, пожалуйста.\n\nЕсли обнаружу подозрительные материалы, я предупрежу участников." 
        },
        query: { chat_id: chatId }
      });

      let allMembers = [];
      let marker = null;
      
      do {
        const params = { count: 100 };
        if (marker) params.marker = marker;
        
        const membersResponse = await ctx.api.raw.get(`chats/${chatId}/members`, {
          query: params
        });
        
        allMembers = allMembers.concat(membersResponse.members);
        marker = membersResponse.marker;
      } while (marker);

      const humanMembers = allMembers.filter(member => !member.is_bot);
      const userIds = humanMembers.map(member => member.user_id);
      
      const dangerousStats = await getMultipleUsersDangerousStats(userIds);
      const statsMap = new Map(
        dangerousStats.map(stat => [stat.max_user_id, parseInt(stat.total_dangerous) || 0])
      );

      let dangerousUsers = [];
      let suspiciousUsers = [];

      for (const member of humanMembers) {
        const userId = member.user_id;
        const totalDangerous = statsMap.get(userId) || 0;

        if (totalDangerous > 5) {
          dangerousUsers.push({ name: member.first_name, id: userId });
        } else if (totalDangerous > 0) {
          suspiciousUsers.push({ name: member.first_name, id: userId });
        }
      }

      let message = "✅ Ни у одного пользователя из данной группы не было замечено случаев отправки вредоносных ссылок или файлов!";
      if (dangerousUsers.length > 0) {
        message = "⚠️ Опасные пользователи в этой группе:\n\n";
        dangerousUsers.forEach(user => {
          message += `• ${user.name} (ID: ${user.id}) - часто скидывал вредоносные ссылки или файлы\n`;
        });
      } else if (suspiciousUsers.length > 0) {
        message = "🔍 Подозрительные пользователи в этой группе:\n\n";
        suspiciousUsers.forEach(user => {
          message += `• ${user.name} (ID: ${user.id}) - бывали случаи отправки вредоносных ссылок или файлов\n`;
        });
      }

      await ctx.reply(message);

      console.log(`[bot] Finished security check for chat ${chatId}. Found ${dangerousUsers.length} dangerous and ${suspiciousUsers.length} suspicious users`);

    } catch (error) {
      console.error('[bot] Error in bot_added handler:', error);
    }
  });

  bot.on("user_added", async (ctx) => {
    try {
      const chatId = ctx.update.chat_id;
      const user = ctx.update.user;
      
      if (user.is_bot) return;

      const eventKey = getEventKey(chatId, user.user_id);
      
      if (processedEvents.has(eventKey)) {
        console.log(`[bot] user_added event for user ${user.user_id} in chat ${chatId} already processed, skipping`);
        return;
      }
      
      processedEvents.add(eventKey);
      console.log(`[bot] user ${user.user_id} added to chat ${chatId}`);

      setTimeout(() => {
        processedEvents.delete(eventKey);
      }, 10000);

      const stats = await getUserDangerousStats(user.user_id);
      const totalDangerous = parseInt(stats?.total_dangerous) || 0;

      let message = `✅ У пользователя ${user.first_name} (ID: ${user.user_id}) не было замечено никакой подозрительной активности.`;
      if (totalDangerous > 5) {
        message = `⚠️ Внимание! Добавлен опасный пользователь ${user.first_name} (ID: ${user.user_id}). Он часто скидывал вредоносные ссылки или файлы.`;
        console.log(`[bot] Sent danger warning for user ${user.user_id} in chat ${chatId}`);
      } else if (totalDangerous > 0) {
        message = `🔍 Внимание! Добавлен подозрительный пользователь ${user.first_name} (ID: ${user.user_id}). У него бывали случаи отправки вредоносных ссылок или файлов.`;
        console.log(`[bot] Sent suspicion warning for user ${user.user_id} in chat ${chatId}`);
      } else {
        console.log(`[bot] User ${user.user_id} is clean, no warning sent`);
      }
      
      await ctx.reply(message);

    } catch (error) {
      console.error('[bot] Error in user_added handler:', error);
    }
  });

  bot.action('choose_theme', async (ctx) => {
    await ctx.reply("Выберите тему теста:", { attachments: [createThemeKeyboard()] });
  });

  bot.action('back_to_menu', async (ctx) => {
    await ctx.reply("Главное меню:", { attachments: [createMenuKeyboard()] });
  });

  bot.action('get_advice', async (ctx) => {
    const advice = advices[Math.floor(Math.random() * advices.length)];
    await ctx.reply(`💡 Совет по кибербезопасности:\n\n${advice}`, {
      attachments: [createMenuKeyboard()]
    });
  });

  bot.action(/start_test:(\d+)/, async (ctx) => {
    const themeIndex = parseInt(ctx.match[1]);
    const userId = ctx.message.sender.user_id;
    const selectedTest = tests[themeIndex];

    const state = {
      test: selectedTest,
      currentQuestion: 0,
      score: 0,
      theme: testThemes[themeIndex].name
    };
    userStates.set(userId, state);

    const q = selectedTest[0];
    await ctx.reply(`Тема: ${testThemes[themeIndex].name}\n\n1. ${q.q}`, {
      attachments: [createQuestionKeyboard(q.o, 0)]
    });
  });

  bot.action(/answer:(\d+):(\d+)/, async (ctx) => {
    const userId = ctx.message.sender.user_id;
    const state = userStates.get(userId);
    if (!state) return;

    const qIndex = parseInt(ctx.match[1]);
    const ansIndex = parseInt(ctx.match[2]);
    const currentQ = state.test[qIndex];
    const isCorrect = ansIndex === currentQ.c;

    if (isCorrect) {
      await ctx.reply("✅ Правильно!");
    } else {
      await ctx.reply(`❌ Неправильно. Правильный ответ: ${currentQ.o[currentQ.c]}`);
    }

    state.score += isCorrect ? 1 : 0;
    state.currentQuestion += 1;

    if (state.currentQuestion < 5) {
      const nextQ = state.test[state.currentQuestion];
      await ctx.reply(`Следующий вопрос:\n${state.currentQuestion + 1}. ${nextQ.q}`, {
        attachments: [createQuestionKeyboard(nextQ.o, state.currentQuestion)]
      });
    } else {
      await ctx.reply(`Тест завершён!\nПравильных ответов: ${state.score} из 5`, {
        attachments: [createMenuKeyboard()]
      });
      userStates.delete(userId);
    }
  });

  bot.action('cancel_test', async (ctx) => {
    const userId = ctx.message.sender.user_id;
    userStates.delete(userId);
    await ctx.reply("Тест отменён.", { attachments: [createMenuKeyboard()] });
  });

  await bot.start();
  console.log("[bot] started");

  // чтобы процесс не завершился
  setInterval(() => {}, 1 << 30);
}

main().catch((err) => {
  console.error("[bot] fatal:", err);
  process.exit(1);
});
