require("dotenv").config();
const { Client, Events, GatewayIntentBits, ActionRowBuilder, StringSelectMenuBuilder, ChannelType } = require("discord.js");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createClient } = require("@supabase/supabase-js");
const { handlePostMenu, handleAnnText } = require("./poster");

const ADMIN_CH = "1518059656302301245";
const ASSIST_CH = "1516269437932670977";

const bot = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

let rules = {};
const channels = new Set();

bot.on(Events.ClientReady, async () => {
  console.log(`✅ The Watcher is online as ${bot.user.tag}`);
  
  const { data } = await db.from("rules").select("*");
  data.forEach(r => rules[r.section] = r.content);
  console.log(`📚 Loaded ${Object.keys(rules).length} rule sections`);
  
  const { data: ch } = await db.from("assistant_channels").select("channel_id");
  ch.forEach(c => channels.add(c.channel_id));
  console.log(`✅ Assistant in ${channels.size} channel(s)`);
});

bot.on(Events.InteractionCreate, async (i) => {
  if (!i.isStringSelectMenu()) return;
  await handlePostMenu(i, rules, bot, db, channels);
});

bot.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot || !msg.guild) return;

  if (msg.content.toLowerCase() === "!post") {
    const own = msg.member.roles.cache.some(r => r.name === "Owners");
    const adm = msg.member.roles.cache.some(r => r.name === "Admin");
    if (!own && !adm) return;
    if (!own && adm && msg.channelId !== ADMIN_CH) return;

    const cats = msg.guild.channels.cache
      .filter(c => c.type === ChannelType.GuildCategory)
      .map(c => ({ label: c.name, value: c.id }))
      .slice(0, 25);

    if (!cats.length) {
      msg.reply("No categories");
      return;
    }

    await msg.reply({
      content: "Which category?",
      components: [new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId("post_cat").setOptions(cats)
      )],
    });
    msg.delete().catch(() => {});
    return;
  }

  if (await handleAnnText(msg)) return;

  if (!channels.has(msg.channelId)) return;
  if (!/rule|limit|how|can i|building|vehicle|steal|cheat|map|restart|shop|bot|server|allow/i.test(msg.content)) return;

  const txt = Object.values(rules).join("\n\n");
  const m = genai.getGenerativeModel({ model: "gemini-2.5-flash" });
  const res = await m.generateContent(`Answer this question about our SCUM server rules:\n\nRULES:\n${txt}\n\nQUESTION: ${msg.content}\n\nAnswer in 1-2 sentences.`);
  msg.reply(res.response.text());
});

bot.login(process.env.DISCORD_TOKEN);

// Keep-alive HTTP server for Railway
const http = require("http");
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("OK");
}).listen(3000, () => console.log("   → HTTP server on :3000"));
