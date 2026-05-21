// ============================================================================
// TICKET SUPPORT TRIAGE - Intelligent first-responder for support tickets
// ============================================================================

const { EmbedBuilder } = require("discord.js");

// Ticket category ID - where support tickets are created
const TICKET_CATEGORY_ID = "1319718509432803489";
const SR_ADMIN_ROLE_ID = "1218303201464422631"; // Sr. Admin role to ping

async function handleTicketTriage(message, supabase, genAI, liveRules) {
  try {
    // Only process in ticket channels
    if (!message.channel.parentId || message.channel.parentId !== TICKET_CATEGORY_ID) {
      return false;
    }

    // Don't process messages from ANY bot
    if (message.author.bot) {
      return false;
    }

    // Get all messages in channel
    const allMessages = await message.channel.messages.fetch({ limit: 50 });
    
    // Find the player's first message (first non-bot message in the channel)
    const playerMessages = allMessages
      .filter(msg => !msg.author.bot)
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    
    const isFirstPlayerMessage = playerMessages.length > 0 && playerMessages.last().id === message.id;

    // Step A: Send reassurance message ONLY on first player message
    if (isFirstPlayerMessage) {
      const reassuranceEmbed = new EmbedBuilder()
        .setTitle("✅ Ticket Received")
        .setDescription("Thank you for opening a ticket! Mrs. Cobble is analyzing your request.\n\nIf it's a quick rule question, I can answer it right away. Otherwise, an admin will be with you shortly.")
        .setColor(0x4caf50) // Green
        .setFooter({ text: "Mrs. Cobble Support System" })
        .setTimestamp();

      await message.reply({
        embeds: [reassuranceEmbed]
      });
    }

    // Step B: Check if any admin (Sr. Admin or SCUM Admin) or Owner has already replied
    const hasAnyAdminResponse = allMessages.some(msg => 
      msg.member && 
      msg.member.roles.cache.some(role => ["Sr. Admin", "SCUM Admin", "Owner"].includes(role.name))
    );

    // Kill switch: If admin already responded, let them handle it
    if (hasAnyAdminResponse) {
      return false;
    }

    // Step C: Check if ticket is older than 30 mins with NO admin response
    const ticketOpenTime = allMessages.last().createdTimestamp; // Oldest message = ticket open time
    const ticketAgeMinutes = (Date.now() - ticketOpenTime) / (1000 * 60);
    const thirtyMinutesWithoutAdmin = ticketAgeMinutes >= 30 && !hasAnyAdminResponse;

    // Step D: Analyze ticket with Gemini
    const systemPrompt = buildTriagePrompt(liveRules);
    
    const model = genAI.getGenerativeModel({ model: "claude-sonnet-4-20250514" });
    
    const userMessage = `
      A player opened a support ticket with this message:
      
      "${message.content}"
      
      Analyze this and respond ONLY with a valid JSON object (no markdown, no backticks, just raw JSON):
      {
        "isAngry": boolean,
        "isRuleQuestion": boolean,
        "ruleAnswer": "string or null",
        "confidence": number
      }
    `;

    const result = await model.generateContent({
      contents: [
        { role: "user", parts: [{ text: userMessage }] }
      ],
      systemInstruction: systemPrompt
    });

    const responseText = result.response.text();
    
    let triageData;
    try {
      const cleanedText = responseText.replace(/```json|```/g, "").trim();
      triageData = JSON.parse(cleanedText);
    } catch (parseErr) {
      console.error("Failed to parse triage JSON:", parseErr);
      triageData = { isAngry: false, isRuleQuestion: false, confidence: 0 };
    }

    // Step E: Execute based on triage result

    // SCENARIO 1: Rule question → Mrs. Cobble answers directly (NO ADMIN PING)
    if (triageData.isRuleQuestion && triageData.ruleAnswer) {
      const answerEmbed = new EmbedBuilder()
        .setTitle("📋 Rule Answer - Mrs. Cobble")
        .setDescription(triageData.ruleAnswer)
        .setColor(0xd4a574)
        .setFooter({ text: "You can close this ticket if this answered your question!" })
        .setTimestamp();

      await message.reply({
        embeds: [answerEmbed]
      });
      return true;
    }

    // SCENARIO 2: Angry/Frustrated → PING SR. ADMIN IMMEDIATELY
    if (triageData.isAngry) {
      const urgentEmbed = new EmbedBuilder()
        .setTitle("⚠️ PRIORITY TICKET - PLAYER IS FRUSTRATED")
        .setDescription(message.content)
        .setColor(0xFF6B6B)
        .setAuthor({ name: message.author.username, iconURL: message.author.avatarURL() })
        .addFields(
          { name: "Channel", value: `<#${message.channelId}>`, inline: true },
          { name: "Confidence", value: `${(triageData.confidence * 100).toFixed(0)}%`, inline: true }
        )
        .setTimestamp();

      await message.reply({
        content: `<@&${SR_ADMIN_ROLE_ID}> This player is frustrated and needs immediate attention.`,
        embeds: [urgentEmbed],
        allowedMentions: { roles: [SR_ADMIN_ROLE_ID] }
      });
      return true;
    }

    // SCENARIO 3: General issue + 30+ mins with no admin → PING SR. ADMIN (ESCALATION)
    if (thirtyMinutesWithoutAdmin) {
      const escalationEmbed = new EmbedBuilder()
        .setTitle("⏰ TICKET ESCALATION - 30+ Minutes No Response")
        .setDescription(message.content)
        .setColor(0xFF9800) // Orange
        .setAuthor({ name: message.author.username, iconURL: message.author.avatarURL() })
        .addFields(
          { name: "Ticket Age", value: `${Math.floor(ticketAgeMinutes)} minutes`, inline: true },
          { name: "Channel", value: `<#${message.channelId}>`, inline: true }
        )
        .setTimestamp();

      await message.reply({
        content: `<@&${SR_ADMIN_ROLE_ID}> This ticket has been waiting for over 30 minutes. Please respond.`,
        embeds: [escalationEmbed],
        allowedMentions: { roles: [SR_ADMIN_ROLE_ID] }
      });
      return true;
    }

    // SCENARIO 4: General issue + less than 30 mins → DO NOTHING, WAIT SILENTLY
    // Mrs. Cobble has already sent the reassurance message, now we just wait for admin
    return true;

  } catch (error) {
    console.error("Ticket triage error:", error);
    try {
      await message.reply({
        content: `<@&${SR_ADMIN_ROLE_ID}> There was an error processing this ticket. Please review manually.`,
        allowedMentions: { roles: [SR_ADMIN_ROLE_ID] }
      });
    } catch (replyErr) {
      console.error("Failed to send error notification:", replyErr);
    }
    return true;
  }
}

function buildTriagePrompt(liveRules) {
  let rulesText = "SERVER RULES:\n\n";
  if (typeof liveRules === 'object' && liveRules !== null) {
    for (const [section, content] of Object.entries(liveRules)) {
      rulesText += `[${section}]\n${content}\n\n`;
    }
  }

  return `You are Mrs. Cobble, a support triage assistant for a SCUM game server Discord.

You are analyzing a player's support ticket message. Your job is to determine:
1. Is the player upset, angry, frustrated, or reporting a critical issue that needs human attention?
2. Is the player simply asking a question about server rules?
3. If it IS a rule question, can you answer it with the rules provided below?

${rulesText}

CRITICAL INSTRUCTIONS:
- Respond ONLY with valid JSON. No markdown, no code blocks, no explanation.
- The JSON must have exactly these fields: isAngry (boolean), isRuleQuestion (boolean), ruleAnswer (string or null), confidence (0-1)
- isAngry = true if the player seems upset, frustrated, angry, or reporting critical bugs/griefing
- isRuleQuestion = true ONLY if they're asking about server rules
- ruleAnswer = your answer if isRuleQuestion is true, otherwise null
- confidence = how confident you are in your assessment (0.0 to 1.0)

Example JSON response:
{"isAngry": false, "isRuleQuestion": true, "ruleAnswer": "Based on our rules, vehicles...", "confidence": 0.95}

Now analyze the ticket message and respond ONLY with JSON.`;
}

module.exports = {
  handleTicketTriage,
  TICKET_CATEGORY_ID
};
