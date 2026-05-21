// ============================================================================
// EVENT RSVP HANDLER - Handles RSVP button clicks and updates messages
// ============================================================================

const { addRSVP, removeRSVP, getUserRSVPs, getEventById, getRSVPCount } = require("./event-db");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

async function handleEventRSVPButton(interaction, supabase, client) {
  if (!interaction.customId.startsWith("event_rsvp_")) {
    return false;
  }

  const eventId = interaction.customId.replace("event_rsvp_", "");
  const discordId = interaction.user.id;

  try {
    // Check if user already RSVP'd
    const userRsvps = await getUserRSVPs(supabase, discordId);
    const alreadyRsvped = userRsvps.includes(eventId);

    const event = await getEventById(supabase, eventId);
    if (!event) {
      await interaction.reply({
        content: "❌ Event not found.",
        ephemeral: true
      });
      return true;
    }

    if (alreadyRsvped) {
      // Remove RSVP (toggle off)
      await removeRSVP(supabase, eventId, discordId);
      await interaction.reply({
        content: "❌ You've been removed from the RSVP list.",
        ephemeral: true
      });
    } else {
      // Add RSVP (toggle on)
      await addRSVP(supabase, eventId, discordId);
      await interaction.reply({
        content: `✅ You're in! See you at **${event.title}**!`,
        ephemeral: true
      });
    }

    // Update the event message with new RSVP count
    if (event.calendar_message_id && client) {
      try {
        const channel = interaction.channel;
        const message = await channel.messages.fetch(event.calendar_message_id);
        
        // Get updated RSVP count
        const { data: rsvpData } = await supabase
          .from("event_rsvps")
          .select("*")
          .eq("event_id", eventId);
        const rsvpCount = rsvpData?.length || 0;

        // Rebuild embed with updated count
        const eventDate = new Date(event.event_date);
        const timeStr = eventDate.toLocaleString("en-US", { 
          month: "short", 
          day: "numeric", 
          hour: "numeric", 
          minute: "2-digit", 
          hour12: true 
        });
        
        const updatedEmbed = new EmbedBuilder()
          .setTitle(`📅 ${event.title}`)
          .addFields(
            { name: "📍 Location & Details", value: event.location ? event.location.substring(0, 1024) : "TBD", inline: false },
            { name: "🕐 Time", value: eventDate.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }) + " PDT", inline: false },
            { name: "👥 RSVPs", value: `${rsvpCount} players`, inline: false }
          )
          .setColor(0xd4a574);

        // Add image if it exists
        if (event.image_url && event.image_url.trim().length > 0) {
          try {
            updatedEmbed.setImage(event.image_url);
          } catch (imgErr) {
            console.warn("Invalid image URL:", event.image_url);
          }
        }

        // Rebuild button row
        const buttonRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`event_rsvp_${event.id}`)
            .setLabel(`RSVP (${rsvpCount})`)
            .setStyle(ButtonStyle.Success)
            .setEmoji("✅"),
          new ButtonBuilder()
            .setCustomId(`event_delete_${event.id}`)
            .setLabel("Delete Event")
            .setStyle(ButtonStyle.Danger)
            .setEmoji("🗑️")
        );

        await message.edit({
          embeds: [updatedEmbed],
          components: [buttonRow]
        });
        console.log("Event message updated with new RSVP count:", rsvpCount);
      } catch (err) {
        console.error("Failed to update event message:", err);
        // Don't fail the RSVP if message update fails
      }
    }

    return true;
  } catch (error) {
    console.error("RSVP button error:", error);
    await interaction.reply({
      content: "❌ Error processing RSVP. Please try again.",
      ephemeral: true
    });
    return true;
  }
}

module.exports = {
  handleEventRSVPButton
};
