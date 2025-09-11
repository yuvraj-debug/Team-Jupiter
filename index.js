require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, ChannelType, Events, Collection, AuditLogEvent, Role } = require('discord.js');
const fs = require('fs');
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');

// MongoDB Connection
const MONGODB_URI = 'mongodb+srv://yuvraj:yuvr2012@orbitx.x17pmve.mongodb.net/discordbot?retryWrites=true&w=majority&appName=orbitx';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// MongoDB Schemas
const warningSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  guildId: { type: String, required: true },
  reason: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  moderator: { type: String, required: true },
  warningId: { type: String, required: true }
});

const whitelistSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  addedBy: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

const immuneSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  addedBy: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  reason: { type: String, default: 'No reason provided' }
});

const ticketSchema = new mongoose.Schema({
  channelId: { type: String, required: true, unique: true },
  creator: { type: String, required: true },
  type: { type: String, required: true },
  claimedBy: { type: String, default: null },
  locked: { type: Boolean, default: false },
  closed: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  closedAt: { type: Date, default: null },
  messages: { type: Array, default: [] }
});

const configSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  welcomeChannelId: String,
  logChannelId: String,
  ticketRoleId: String,
  mentionRoleId: String,
  securityRoleId: String,
  adminIds: { type: [String], default: [] },
  authorizedUsers: { type: [String], default: [] },
  lastUpdated: { type: Date, default: Date.now },
  updatedBy: String
});

// Add TTL indexes for auto-cleanup
warningSchema.index({ timestamp: 1 }, { expireAfterSeconds: 7776000 }); // 90 days
ticketSchema.index({ closedAt: 1 }, { expireAfterSeconds: 2592000 }); // 30 days

const Warning = mongoose.model('Warning', warningSchema);
const Whitelist = mongoose.model('Whitelist', whitelistSchema);
const Immune = mongoose.model('Immune', immuneSchema);
const Ticket = mongoose.model('Ticket', ticketSchema);
const Config = mongoose.model('Config', configSchema);

// Keep-alive server for Render
const keepAlive = express();
const keepAlivePort = process.env.KEEP_ALIVE_PORT || 8080;

keepAlive.get('/', (req, res) => {
  res.send('Bot is alive!');
});

keepAlive.listen(keepAlivePort, () => {
  console.log(`Keep-alive server running on port ${keepAlivePort}`);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildWebhooks,
        GatewayIntentBits.GuildIntegrations,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// Configuration cache
let configCache = {
    welcomeChannelId: null,
    logChannelId: null,
    ticketRoleId: null,
    mentionRoleId: null,
    securityRoleId: null,
    adminIds: [],
    authorizedUsers: []
};

// Memory storage for temporary data
const memoryData = {
    recentDeletions: new Map(),
    deletedChannels: new Map(),
    userMessageCount: new Map(),
    userJoinTimestamps: new Map(),
    userInviteCount: new Map(),
    commandCooldowns: new Map(),
    configCache: new Map()
};

// Load data from MongoDB
async function loadConfig(guildId) {
    try {
        const config = await Config.findOne({ guildId }) || await Config.create({ guildId });
        configCache = { ...configCache, ...config.toObject() };
        memoryData.configCache.set(guildId, configCache);
        return configCache;
    } catch (error) {
        console.error('Error loading config:', error);
        return configCache;
    }
}

// Save config to MongoDB
async function saveConfig(guildId, updates, updatedBy) {
    try {
        const config = await Config.findOneAndUpdate(
            { guildId },
            { ...updates, lastUpdated: new Date(), updatedBy },
            { upsert: true, new: true }
        );
        configCache = { ...configCache, ...config.toObject() };
        memoryData.configCache.set(guildId, configCache);
        return configCache;
    } catch (error) {
        console.error('Error saving config:', error);
        throw error;
    }
}

// Enhanced logging function with beautiful embeds
async function logAction(action, details, color = 0x0099FF, user = null, options = {}) {
    const config = memoryData.configCache.get(options.guildId) || configCache;
    if (!config.logChannelId) return;

    try {
        const logChannel = client.channels.cache.get(config.logChannelId);
        if (!logChannel) return;

        const timestamp = new Date();
        const logId = Math.random().toString(36).substring(2, 10).toUpperCase();
        
        let title, emoji;
        switch (action) {
            case 'BOT_READY':
                title = 'System Startup'; emoji = '🎮'; color = 0x00FF00; break;
            case 'MEMBER_JOIN':
                title = 'Member Joined'; emoji = '👋'; color = 0x00FF00; break;
            case 'MEMBER_LEAVE':
                title = 'Member Left'; emoji = '👋'; color = 0xFFA500; break;
            case 'TICKET_CREATE':
                title = 'Ticket Created'; emoji = '🎫'; color = 0x0099FF; break;
            case 'TICKET_CLAIM':
                title = 'Ticket Claimed'; emoji = '✅'; color = 0x00FF00; break;
            case 'TICKET_CLOSE':
                title = 'Ticket Closed'; emoji = '🔒'; color = 0xFFA500; break;
            case 'TICKET_DELETE':
                title = 'Ticket Deleted'; emoji = '🗑️'; color = 0xFF0000; break;
            case 'WARNING_ISSUED':
                title = 'Warning Issued'; emoji = '⚠️'; color = 0xFFA500; break;
            case 'SECURITY_BAN':
                title = 'Security Ban'; emoji = '🔨'; color = 0xFF0000; break;
            case 'LINK_BLOCK':
                title = 'Link Blocked'; emoji = '🔗'; color = 0xFF0000; break;
            case 'INVITE_BLOCK':
                title = 'Invite Blocked'; emoji = '📨'; color = 0xFF0000; break;
            case 'MASS_MENTION_WARNING':
                title = 'Mass Mention'; emoji = '@️⃣'; color = 0xFFA500; break;
            case 'CONFIG_UPDATE':
                title = 'Config Updated'; emoji = '⚙️'; color = 0x9B59B6; break;
            case 'COMMAND_EXECUTED':
                title = 'Command Executed'; emoji = '⌨️'; color = 0x3498DB; break;
            case 'DM_WARNING_SENT':
                title = 'Warning DM Sent'; emoji = '✉️'; color = 0x3498DB; break;
            case 'DM_WARNING_FAILED':
                title = 'Warning DM Failed'; emoji = '❌'; color = 0xFF0000; break;
            default:
                title = action; emoji = '📝'; break;
        }

        const logEmbed = new EmbedBuilder()
            .setColor(color)
            .setTitle(`${emoji} ${title}`)
            .setDescription(details)
            .setFooter({ text: `Log ID: ${logId} • ${timestamp.toLocaleTimeString()}` })
            .setTimestamp();

        if (user) {
            logEmbed.setAuthor({ 
                name: `${user.tag} (${user.id})`, 
                iconURL: user.displayAvatarURL({ dynamic: true }) 
            });
        }

        if (options.fields) {
            logEmbed.addFields(options.fields);
        }

        if (options.thumbnail) {
            logEmbed.setThumbnail(options.thumbnail);
        }

        await logChannel.send({ embeds: [logEmbed] });
        
    } catch (error) {
        console.error('Error sending log to channel:', error);
    }
}

// Send warning DM to user
async function sendWarningDM(user, guild, warningData, moderator) {
    try {
        const warningEmbed = new EmbedBuilder()
            .setColor(0xFFA500)
            .setTitle('⚠️ **Warning Received** ⚠️')
            .setDescription(`You have received a warning in **${guild.name}**`)
            .addFields(
                { 
                    name: '📝 **Reason**', 
                    value: warningData.reason || 'No reason provided', 
                    inline: false 
                },
                { 
                    name: '🛡️ **Moderator**', 
                    value: moderator.user?.tag || 'System', 
                    inline: true 
                },
                { 
                    name: '📊 **Total Warnings**', 
                    value: `${warningData.warnings}/3`, 
                    inline: true 
                },
                { 
                    name: '🆔 **Warning ID**', 
                    value: `\`${warningData.warningId}\``, 
                    inline: true 
                },
                { 
                    name: '⏰ **Date & Time**', 
                    value: `<t:${Math.floor(Date.now() / 1000)}:F>`, 
                    inline: true 
                },
                { 
                    name: '🚨 **Next Action**', 
                    value: warningData.warnings >= 3 ? '**Kick from server**' : 'Warning', 
                    inline: true 
                }
            )
            .setThumbnail('https://cdn-icons-png.flaticon.com/512/753/753345.png')
            .setFooter({ 
                text: `Server: ${guild.name} | Please follow the server rules`, 
                iconURL: guild.iconURL() 
            })
            .setTimestamp();

        const actionRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('Appeal Warning')
                    .setStyle(ButtonStyle.Secondary)
                    .setCustomId('appeal_warning')
                    .setEmoji('📝'),
                new ButtonBuilder()
                    .setLabel('Server Rules')
                    .setStyle(ButtonStyle.Link)
                    .setURL('https://discord.com/channels/' + guild.id)
                    .setEmoji('📜')
            );

        await user.send({ 
            content: '## ⚠️ **Official Warning Notice** ⚠️',
            embeds: [warningEmbed],
            components: [actionRow]
        });

        await logAction('DM_WARNING_SENT', 
            `Successfully sent warning DM to ${user.tag}\n**Warning ID:** ${warningData.warningId}\n**Reason:** ${warningData.reason}`,
            0x00FF00, user, { guildId: guild.id }
        );

        return true;
    } catch (error) {
        console.error('Failed to send warning DM:', error);
        await logAction('DM_WARNING_FAILED', 
            `Could not send warning DM to ${user.tag}\n**Error:** ${error.message}\n**User DMs might be closed.**`,
            0xFF0000, user, { guildId: guild.id }
        );
        return false;
    }
}

// Send kick DM to user
async function sendKickDM(user, guild, reason) {
    try {
        const kickEmbed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('🚫 **You have been kicked** 🚫')
            .setDescription(`You have been kicked from **${guild.name}**`)
            .addFields(
                { 
                    name: '📝 **Reason**', 
                    value: reason || 'Excessive warnings (3/3)', 
                    inline: false 
                },
                { 
                    name: '⏰ **Date & Time**', 
                    value: `<t:${Math.floor(Date.now() / 1000)}:F>`, 
                    inline: true 
                },
                { 
                    name: '📊 **Total Warnings**', 
                    value: '3/3 (Maximum reached)', 
                    inline: true 
                }
            )
            .setThumbnail('https://cdn-icons-png.flaticon.com/512/1828/1828843.png')
            .setFooter({ 
                text: `You can rejoin if you believe this was a mistake`, 
                iconURL: guild.iconURL() 
            })
            .setTimestamp();

        await user.send({ 
            content: '## 🚫 **Server Kick Notification** 🚫',
            embeds: [kickEmbed]
        });

        return true;
    } catch (error) {
        console.error('Failed to send kick DM:', error);
        return false;
    }
}

// Check if user has ticket management permissions
function hasTicketPermission(member, ticketData = null) {
    const config = memoryData.configCache.get(member.guild.id) || configCache;
    
    // Admins always have permission
    if (config.adminIds.includes(member.id)) return true;
    
    // Check if user has the ticket manager role
    if (config.ticketRoleId && member.roles.cache.has(config.ticketRoleId)) return true;
    
    // Ticket creator can manage their own ticket
    if (ticketData && ticketData.creator === member.id) return true;
    
    // User who claimed the ticket can manage it
    if (ticketData && ticketData.claimedBy === member.id) return true;
    
    return false;
}

// Check if user is authorized for admin commands
function isAuthorized(userId, guildId) {
    const config = memoryData.configCache.get(guildId) || configCache;
    return config.adminIds.includes(userId) || config.authorizedUsers.includes(userId);
}

// Create or get mention permission role
async function setupMentionRole(guild) {
    try {
        const config = memoryData.configCache.get(guild.id) || configCache;
        let mentionRole = config.mentionRoleId ? guild.roles.cache.get(config.mentionRoleId) : null;
        
        if (!mentionRole) {
            mentionRole = guild.roles.cache.find(role => role.name === 'Mention Permissions');
            if (mentionRole) {
                await saveConfig(guild.id, { mentionRoleId: mentionRole.id }, 'System');
            }
        }
        
        if (!mentionRole) {
            mentionRole = await guild.roles.create({
                name: 'Mention Permissions',
                color: 'Blue',
                permissions: [
                    PermissionsBitField.Flags.MentionEveryone,
                    PermissionsBitField.Flags.UseApplicationCommands
                ],
                reason: 'Role for users allowed to mention @everyone and roles'
            });
            await saveConfig(guild.id, { mentionRoleId: mentionRole.id }, 'System');
            await logAction('ROLE_CREATED', `Created mention permission role: ${mentionRole.name}`, 0x00FF00, null, { guildId: guild.id });
        }
        
        return mentionRole;
    } catch (error) {
        console.error('Error setting up mention role:', error);
        await logAction('ROLE_SETUP_ERROR', `Failed to setup mention role: ${error.message}`, 0xFF0000, null, { guildId: guild.id });
    }
}

// Welcome System
client.on(Events.GuildMemberAdd, async (member) => {
    try {
        const config = memoryData.configCache.get(member.guild.id) || configCache;
        
        // Anti-raid protection
        const now = Date.now();
        const joinTimestamps = memoryData.userJoinTimestamps.get(member.guild.id) || [];
        const recentJoins = joinTimestamps.filter(time => now - time < 10000);
        recentJoins.push(now);
        memoryData.userJoinTimestamps.set(member.guild.id, recentJoins);
        
        if (recentJoins.length >= 5) {
            await enableLockdown(member.guild);
            await logAction('RAID_DETECTED', `Raid detected! ${recentJoins.length} users joined in 10 seconds. Server locked down.`, 0xFF0000, null, { guildId: member.guild.id });
        }
        
        if (config.welcomeChannelId) {
            const welcomeChannel = member.guild.channels.cache.get(config.welcomeChannelId);
            if (welcomeChannel) {
                const welcomeEmbed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle('🎉 Welcome to Team Jupiter! 🎉')
                    .setDescription(`${member.user}, :wave: hey! welcome to **Team Jupiter**, the ultimate gaming experience!\nWe hope you enjoy your stay and have an amazing time here. Make sure to check out the community and get involved!\n\n:sword: **Team Jupiter**`)
                    .setThumbnail(member.user.displayAvatarURL())
                    .setImage('https://images-ext-1.discordapp.net/external/1vFDeXmdRWn_3XIfN2wncqUh5FRIRmfPmXOPiczCvRw/https/i.pinimg.com/736x/a9/eb/a3/a9eba3be002462632df36598cf737e53.jpg?format=webp&width=828&height=466')
                    .setFooter({ text: `Member #${member.guild.memberCount}`, iconURL: member.guild.iconURL() })
                    .setTimestamp();
                    
                await welcomeChannel.send({ 
                    content: `${member.user}`, 
                    embeds: [welcomeEmbed] 
                });
            }
        }
        
        await logAction('MEMBER_JOIN', 
            `**User:** ${member.user.tag} (${member.user.id})\n**Account Created:** <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>\n**Server Member Count:** ${member.guild.memberCount}`,
            0x00FF00, member.user, { guildId: member.guild.id, thumbnail: member.user.displayAvatarURL() }
        );
    } catch (error) {
        console.error('Error in welcome system:', error);
    }
});

// Member Leave Logging
client.on(Events.GuildMemberRemove, async (member) => {
    try {
        await logAction('MEMBER_LEAVE',
            `**User:** ${member.user.tag} (${member.user.id})\n**Joined:** <t:${Math.floor(member.joinedTimestamp / 1000)}:R>\n**Roles:** ${member.roles.cache.size - 1} roles`,
            0xFFA500, member.user, { guildId: member.guild.id, thumbnail: member.user.displayAvatarURL() }
        );
    } catch (error) {
        console.error('Error in member leave handler:', error);
    }
});

// Message Delete Logging
client.on(Events.MessageDelete, async (message) => {
    if (!message.guild || message.author?.bot) return;
    
    try {
        await logAction('MESSAGE_DELETE',
            `**Channel:** ${message.channel}\n**Content:** ${message.content || '*No text content*'}\n**Attachments:** ${message.attachments.size} files`,
            0xFF0000, message.author, { 
                guildId: message.guild.id,
                fields: [
                    { name: 'Message ID', value: message.id, inline: true },
                    { name: 'Channel ID', value: message.channel.id, inline: true }
                ]
            }
        );
    } catch (error) {
        console.error('Error in message delete handler:', error);
    }
});

// Message Edit Logging
client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
    if (!newMessage.guild || newMessage.author?.bot || oldMessage.content === newMessage.content) return;
    
    try {
        await logAction('MESSAGE_EDIT',
            `**Channel:** ${newMessage.channel}\n**Before:** ${oldMessage.content || '*No content*'}\n**After:** ${newMessage.content || '*No content*'}`,
            0xFFA500, newMessage.author, { 
                guildId: newMessage.guild.id,
                fields: [
                    { name: 'Message ID', value: newMessage.id, inline: true },
                    { name: 'Channel', value: newMessage.channel.toString(), inline: true }
                ]
            }
        );
    } catch (error) {
        console.error('Error in message edit handler:', error);
    }
});

// Enable server lockdown
async function enableLockdown(guild) {
    try {
        const channels = guild.channels.cache;
        
        for (const [id, channel] of channels) {
            if (channel.isTextBased()) {
                await channel.permissionOverwrites.edit(guild.roles.everyone, {
                    SendMessages: false,
                    AddReactions: false
                });
            }
        }
        
        await logAction('LOCKDOWN_ENABLED', 'Server lockdown enabled due to possible raid', 0xFF0000, null, { guildId: guild.id });
        setTimeout(() => disableLockdown(guild), 10 * 60 * 1000);
    } catch (error) {
        console.error('Error enabling lockdown:', error);
    }
}

// Disable server lockdown
async function disableLockdown(guild) {
    try {
        const channels = guild.channels.cache;
        
        for (const [id, channel] of channels) {
            if (channel.isTextBased()) {
                await channel.permissionOverwrites.edit(guild.roles.everyone, {
                    SendMessages: null,
                    AddReactions: null
                });
            }
        }
        
        await logAction('LOCKDOWN_DISABLED', 'Server lockdown disabled', 0x00FF00, null, { guildId: guild.id });
    } catch (error) {
        console.error('Error disabling lockdown:', error);
    }
}

// Check if user is whitelisted
async function isWhitelisted(userId) {
    try {
        return await Whitelist.exists({ userId });
    } catch (error) {
        console.error('Error checking whitelist:', error);
        return false;
    }
}

// Add user to whitelist
async function addToWhitelist(userId, addedBy) {
    try {
        await Whitelist.create({ userId, addedBy });
        return true;
    } catch (error) {
        console.error('Error adding to whitelist:', error);
        return false;
    }
}

// Remove user from whitelist
async function removeFromWhitelist(userId) {
    try {
        await Whitelist.deleteOne({ userId });
        return true;
    } catch (error) {
        console.error('Error removing from whitelist:', error);
        return false;
    }
}

// Check if user is immune
async function isImmune(userId) {
    try {
        return await Immune.exists({ userId });
    } catch (error) {
        console.error('Error checking immune status:', error);
        return false;
    }
}

// Add user to immune list
async function addToImmune(userId, addedBy, reason = 'No reason provided') {
    try {
        await Immune.create({ userId, addedBy, reason });
        return true;
    } catch (error) {
        console.error('Error adding to immune list:', error);
        return false;
    }
}

// Remove user from immune list
async function removeFromImmune(userId) {
    try {
        await Immune.deleteOne({ userId });
        return true;
    } catch (error) {
        console.error('Error removing from immune list:', error);
        return false;
    }
}

// Get immune users
async function getImmuneUsers() {
    try {
        return await Immune.find().populate('userId', 'username');
    } catch (error) {
        console.error('Error getting immune users:', error);
        return [];
    }
}

// Generate a unique warning ID
function generateWarningId() {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
}

// Add warning to user
async function addWarning(user, guild, reason, moderator) {
    try {
        // Check if user is immune
        if (await isImmune(user.id)) {
            return { warnings: -1, warningId: null }; // -1 indicates immune user
        }
        
        const warningId = generateWarningId();
        
        await Warning.create({
            userId: user.id,
            guildId: guild.id,
            reason,
            moderator: moderator.id,
            warningId
        });
        
        const warnings = await Warning.countDocuments({ userId: user.id, guildId: guild.id });
        
        // Send warning DM to user
        await sendWarningDM(user, guild, { reason, warnings, warningId }, moderator);
        
        // Check if user has reached 3 warnings
        if (warnings >= 3) {
            try {
                const member = await guild.members.fetch(user.id);
                await member.kick('Received 3 warnings');
                
                await logAction('MEMBER_KICKED', 
                    `**User:** ${user.tag} (${user.id})\n**Reason:** Excessive warnings (3/3)\n**Moderator:** ${moderator.user?.tag || 'System'}`,
                    0xFF0000, user, { guildId: guild.id }
                );
                
                // Send kick DM
                await sendKickDM(user, guild, 'Excessive warnings (3/3)');
                
                // Clear warnings after kick
                await Warning.deleteMany({ userId: user.id, guildId: guild.id });
                
            } catch (error) {
                console.error('Failed to kick user:', error);
                await logAction('KICK_FAILED', 
                    `Failed to kick ${user.tag} for excessive warnings\n**Error:** ${error.message}`,
                    0xFF0000, user, { guildId: guild.id }
                );
            }
        }
        
        return { warnings, warningId };
    } catch (error) {
        console.error('Error adding warning:', error);
        return { warnings: 0, warningId: null };
    }
}

// Get user warnings
async function getWarnings(userId, guildId) {
    try {
        return await Warning.find({ userId, guildId }).sort({ timestamp: -1 });
    } catch (error) {
        console.error('Error getting warnings:', error);
        return [];
    }
}

// Clear user warnings
async function clearWarnings(userId, guildId) {
    try {
        await Warning.deleteMany({ userId, guildId });
        return true;
    } catch (error) {
        console.error('Error clearing warnings:', error);
        return false;
    }
}

// Remove specific warning by ID
async function removeWarning(warningId, guildId) {
    try {
        const result = await Warning.deleteOne({ warningId, guildId });
        return result.deletedCount > 0;
    } catch (error) {
        console.error('Error removing warning:', error);
        return false;
    }
}

// Ticket System
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton()) return;
    
    // Ticket creation
    if (interaction.customId === 'general_support' || interaction.customId === 'team_apply' || interaction.customId === 'ally_merge') {
        try {
            // Check if user already has an open ticket
            const openTicket = await Ticket.findOne({ 
                creator: interaction.user.id, 
                closed: false 
            });
            
            if (openTicket) {
                await interaction.reply({ 
                    content: '❌ You already have an open ticket! Please close it before creating a new one.', 
                    ephemeral: true 
                });
                return;
            }
            
            const config = memoryData.configCache.get(interaction.guild.id) || configCache;
            const ticketType = interaction.customId;
            const ticketNumber = Math.floor(1000 + Math.random() * 9000);
            const ticketChannelName = `${ticketType}-${ticketNumber}`;
            
            // Get the ticket viewer role
            const ticketViewerRole = config.ticketRoleId ? interaction.guild.roles.cache.get(config.ticketRoleId) : null;
            
            // Build permission overwrites
            const permissionOverwrites = [
                {
                    id: interaction.guild.id,
                    deny: [PermissionsBitField.Flags.ViewChannel]
                },
                {
                    id: interaction.user.id,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.ReadMessageHistory,
                        PermissionsBitField.Flags.AttachFiles
                    ]
                }
            ];
            
            // Add ticket viewer role permissions if it exists
            if (ticketViewerRole) {
                permissionOverwrites.push({
                    id: ticketViewerRole.id,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.ReadMessageHistory,
                        PermissionsBitField.Flags.ManageMessages,
                        PermissionsBitField.Flags.ManageChannels
                    ]
                });
            }
            
            // Add admin permissions
            for (const adminId of config.adminIds) {
                try {
                    const adminMember = await interaction.guild.members.fetch(adminId);
                    permissionOverwrites.push({
                        id: adminMember.id,
                        allow: [
                            PermissionsBitField.Flags.ViewChannel,
                            PermissionsBitField.Flags.SendMessages,
                            PermissionsBitField.Flags.ReadMessageHistory,
                            PermissionsBitField.Flags.ManageMessages,
                            PermissionsBitField.Flags.ManageChannels
                        ]
                    });
                } catch (error) {
                    console.error(`Could not fetch admin member ${adminId}:`, error);
                }
            }
            
            const ticketChannel = await interaction.guild.channels.create({
                name: ticketChannelName,
                type: ChannelType.GuildText,
                parent: interaction.channel.parent,
                permissionOverwrites: permissionOverwrites
            });
            
            // Store ticket info in MongoDB
            await Ticket.create({
                channelId: ticketChannel.id,
                creator: interaction.user.id,
                type: ticketType,
                createdAt: new Date()
            });
            
            const claimButton = new ButtonBuilder()
                .setCustomId('claim_ticket')
                .setLabel('Claim')
                .setStyle(ButtonStyle.Success)
                .setEmoji('✅');
                
            const deleteButton = new ButtonBuilder()
                .setCustomId('delete_ticket')
                .setLabel('Delete')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🗑️');
                
            const row = new ActionRowBuilder().addComponents(claimButton, deleteButton);
            
            const ticketEmbed = new EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle('🎫 Ticket Created')
                .setDescription(`Hello ${interaction.user}! Support will be with you shortly.\n\n**Ticket Type:** ${ticketType.replace(/_/g, ' ').toUpperCase()}\n**Ticket ID:** ${ticketNumber}\n**Status:** 🟢 Open`)
                .setFooter({ text: `User ID: ${interaction.user.id}` })
                .setTimestamp();
                
            // Ping the user, ticket viewer role, and the specific user ID
            let pingContent = `${interaction.user}`;
            if (ticketViewerRole) {
                pingContent += ` ${ticketViewerRole}`;
            }
            pingContent += ` <@1414824820901679155>`; // Specific user ping
                
            await ticketChannel.send({ 
                content: pingContent,
                embeds: [ticketEmbed], 
                components: [row] 
            });
            
            await interaction.reply({ 
                content: `🎫 Ticket created! ${ticketChannel}`, 
                ephemeral: true 
            });
            
            await logAction('TICKET_CREATE', 
                `**User:** ${interaction.user.tag} (${interaction.user.id})\n**Ticket Type:** ${ticketType}\n**Ticket ID:** ${ticketNumber}\n**Channel:** ${ticketChannel}`,
                0x0099FF, interaction.user, { guildId: interaction.guild.id }
            );
        } catch (error) {
            console.error('Error creating ticket:', error);
            await interaction.reply({ 
                content: '❌ Failed to create ticket. Please contact an administrator.', 
                ephemeral: true 
            });
        }
    }
    
    // Ticket management buttons
    if (interaction.customId === 'claim_ticket' || interaction.customId === 'delete_ticket') {
        const ticketData = await Ticket.findOne({ channelId: interaction.channel.id });
        if (!ticketData) {
            await interaction.reply({ 
                content: '❌ This is not a valid ticket channel.', 
                ephemeral: true 
            });
            return;
        }
        
        if (interaction.customId === 'claim_ticket') {
            if (ticketData.claimedBy) {
                await interaction.reply({ 
                    content: `❌ This ticket is already claimed by <@${ticketData.claimedBy}>`, 
                    ephemeral: true 
                });
                return;
            }
            
            await Ticket.updateOne(
                { channelId: interaction.channel.id },
                { claimedBy: interaction.user.id }
            );
            
            await interaction.channel.permissionOverwrites.edit(interaction.user.id, {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true
            });
            
            // Add ✅ emoji to the front of the channel name
            const currentName = interaction.channel.name;
            await interaction.channel.setName(`✅ ${currentName}`);
            
            await interaction.reply(`✅ ${interaction.user} has claimed this ticket.`);
            await logAction('TICKET_CLAIM', 
                `**Ticket:** ${interaction.channel.name}\n**Claimed by:** ${interaction.user.tag} (${interaction.user.id})`,
                0x00FF00, interaction.user, { guildId: interaction.guild.id }
            );
        }
        
        if (interaction.customId === 'delete_ticket') {
            // Anyone can delete tickets now - no permission check needed
            
            // Mark ticket as closed before deletion
            await Ticket.updateOne(
                { channelId: interaction.channel.id },
                { 
                    closed: true,
                    closedAt: new Date()
                }
            );
            
            // Acknowledge the interaction immediately
            await interaction.deferReply();
            
            // Create transcript before deletion
            let transcript = '';
            try {
                const messages = await interaction.channel.messages.fetch({ limit: 100 });
                transcript = messages.map(msg => 
                    `[${msg.createdAt.toLocaleString()}] ${msg.author.tag} (${msg.author.id}): ${msg.content}${msg.attachments.size > 0 ? ` [Attachment: ${msg.attachments.first().name}]` : ''}`
                ).reverse().join('\n');
            } catch (transcriptError) {
                console.error('Error creating transcript:', transcriptError);
                transcript = 'Failed to create transcript';
            }
            
            // Send closure DM to user
            try {
                const user = await client.users.fetch(ticketData.creator);
                const closureEmbed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('🎫 Ticket Closed')
                    .setDescription('Your ticket has been closed by our support team.')
                    .addFields(
                        { name: 'User', value: user.tag, inline: true },
                        { name: 'Ticket ID', value: interaction.channel.name, inline: true },
                        { name: 'Closed At', value: new Date().toLocaleString(), inline: true },
                        { name: 'Closed By', value: interaction.user.tag, inline: true },
                        { name: 'Ticket Type', value: ticketData.type.replace(/_/g, ' ').toUpperCase(), inline: true },
                        { name: 'Duration', value: `${Math.round((new Date() - ticketData.createdAt) / 60000)} minutes`, inline: true }
                    )
                    .setTimestamp();
                    
                await user.send({ 
                    content: 'Here is the transcript of your closed ticket:',
                    embeds: [closureEmbed],
                    files: [{
                        attachment: Buffer.from(transcript),
                        name: `ticket-${interaction.channel.name}-transcript.txt`
                    }]
                });
            } catch (dmError) {
                console.error('Could not send DM to user:', dmError);
            }
            
            // Log to ticket log channel
            const config = memoryData.configCache.get(interaction.guild.id) || configCache;
            if (config.logChannelId) {
                const logChannel = interaction.guild.channels.cache.get(config.logChannelId);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setColor(0x0099FF)
                        .setTitle('📋 Ticket Transcript')
                        .setDescription(`Ticket closed by ${interaction.user.tag}`)
                        .addFields(
                            { name: 'User', value: `<@${ticketData.creator}>`, inline: true },
                            { name: 'Ticket', value: interaction.channel.name, inline: true },
                            { name: 'Closed By', value: interaction.user.tag, inline: true },
                            { name: 'Duration', value: `${Math.round((new Date() - ticketData.createdAt) / 60000)} minutes`, inline: true },
                            { name: 'Claimed By', value: ticketData.claimedBy ? `<@${ticketData.claimedBy}>` : 'No one', inline: true }
                        )
                        .setTimestamp();
                        
                    await logChannel.send({ 
                        embeds: [logEmbed],
                        files: [{
                            attachment: Buffer.from(transcript),
                            name: `transcript-${interaction.channel.name}.txt`
                        }]
                    });
                }
            }
            
            await interaction.channel.delete();
            await logAction('TICKET_DELETE', 
                `**Ticket:** ${interaction.channel.name}\n**Closed by:** ${interaction.user.tag} (${interaction.user.id})\n**Duration:** ${Math.round((new Date() - ticketData.createdAt) / 60000)} minutes`,
                0xFF0000, interaction.user, { guildId: interaction.guild.id }
            );
        }
    }
});

// Enhanced Security System
client.on(Events.ChannelDelete, async (channel) => {
    if (!channel.guild) return;
    
    try {
        const config = memoryData.configCache.get(channel.guild.id) || configCache;
        if (!config.securityRoleId) return;
        
        const auditLogs = await channel.guild.fetchAuditLogs({ 
            type: AuditLogEvent.ChannelDelete, 
            limit: 1 
        });
        
        const entry = auditLogs.entries.first();
        
        if (entry && entry.executor) {
            const executor = entry.executor;
            
            // Skip if bot or whitelisted user
            if (executor.bot || await isWhitelisted(executor.id)) return;
            
            // Track deletion attempts
            const now = Date.now();
            const userDeletions = memoryData.recentDeletions.get(executor.id) || [];
            userDeletions.push(now);
            memoryData.recentDeletions.set(executor.id, userDeletions.filter(time => now - time < 5000));
            
            // Check if user has made multiple deletions in short time
            const recentCount = memoryData.recentDeletions.get(executor.id).length;
            
            if (recentCount >= 2) {
                // Ban user for excessive deletions
                try {
                    await channel.guild.members.ban(executor.id, { 
                        reason: 'Excessive channel deletion attempts' 
                    });
                    await logAction('SECURITY_BAN', `Banned ${executor.tag} for excessive channel deletions`, 0xFF0000, executor, { guildId: channel.guild.id });
                } catch (banError) {
                    console.error('Failed to ban user:', banError);
                }
            }
            
            // Recreate the deleted channel
            try {
                const newChannel = await channel.guild.channels.create({
                    name: channel.name,
                    type: channel.type,
                    parent: channel.parent,
                    permissionOverwrites: channel.permissionOverwrites.cache,
                    topic: channel.topic,
                    nsfw: channel.nsfw,
                    rateLimitPerUser: channel.rateLimitPerUser,
                    position: channel.position,
                    reason: 'Auto-recreated after deletion'
                });
                
                await logAction('CHANNEL_RECREATED', `Recreated channel #${channel.name} deleted by ${executor.tag}`, 0x00FF00, null, { guildId: channel.guild.id });
            } catch (recreateError) {
                console.error('Failed to recreate channel:', recreateError);
                await logAction('CHANNEL_RECREATE_FAILED', `Failed to recreate channel #${channel.name}: ${recreateError.message}`, 0xFF0000, null, { guildId: channel.guild.id });
            }
            
            await logAction('CHANNEL_DELETE_ATTEMPT', `Prevented channel deletion by ${executor.tag} (${recentCount} attempts)`, 0xFFA500, executor, { guildId: channel.guild.id });
        }
    } catch (error) {
        console.error('Error in channel delete handler:', error);
    }
});

// Additional security events
client.on(Events.ChannelCreate, async (channel) => {
    if (!channel.guild) return;
    
    try {
        const config = memoryData.configCache.get(channel.guild.id) || configCache;
        if (!config.securityRoleId) return;
        
        const auditLogs = await channel.guild.fetchAuditLogs({ 
            type: AuditLogEvent.ChannelCreate, 
            limit: 1 
        });
        
        const entry = auditLogs.entries.first();
        
        if (entry && entry.executor && !await isWhitelisted(entry.executor.id) && !entry.executor.bot) {
            await channel.delete();
            await logAction('CHANNEL_CREATE_BLOCKED', `Prevented channel creation by non-whitelisted user: ${entry.executor.tag}`, 0xFF0000, entry.executor, { guildId: channel.guild.id });
        }
    } catch (error) {
        console.error('Error in channel create handler:', error);
    }
});

client.on(Events.RoleCreate, async (role) => {
    if (!role.guild) return;
    
    try {
        const config = memoryData.configCache.get(role.guild.id) || configCache;
        if (!config.securityRoleId) return;
        
        const auditLogs = await role.guild.fetchAuditLogs({ 
            type: AuditLogEvent.RoleCreate, 
            limit: 1 
        });
        
        const entry = auditLogs.entries.first();
        
        if (entry && entry.executor && !await isWhitelisted(entry.executor.id) && !entry.executor.bot) {
            await role.delete();
            await logAction('ROLE_CREATE_BLOCKED', `Prevented role creation by non-whitelisted user: ${entry.executor.tag}`, 0xFF0000, entry.executor, { guildId: role.guild.id });
        }
    } catch (error) {
        console.error('Error in role create handler:', error);
    }
});

client.on(Events.RoleDelete, async (role) => {
    if (!role.guild) return;
    
    try {
        const config = memoryData.configCache.get(role.guild.id) || configCache;
        if (!config.securityRoleId) return;
        
        const auditLogs = await role.guild.fetchAuditLogs({ 
            type: AuditLogEvent.RoleDelete, 
            limit: 1 
        });
        
        const entry = auditLogs.entries.first();
        
        if (entry && entry.executor && !await isWhitelisted(entry.executor.id) && !entry.executor.bot) {
            await logAction('ROLE_DELETE_BLOCKED', `Prevented role deletion by non-whitelisted user: ${entry.executor.tag}`, 0xFF0000, entry.executor, { guildId: role.guild.id });
        }
    } catch (error) {
        console.error('Error in role delete handler:', error);
    }
});

// Anti-spam system
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.guild) return;
    
    const config = memoryData.configCache.get(message.guild.id) || configCache;
    
    // Anti-spam protection
    const userId = message.author.id;
    const now = Date.now();
    
    // Get user's message count
    let userMessages = memoryData.userMessageCount.get(userId) || [];
    
    // Filter messages from the last 5 seconds
    userMessages = userMessages.filter(time => now - time < 5000);
    userMessages.push(now);
    memoryData.userMessageCount.set(userId, userMessages);
    
    // If user sent more than 5 messages in 5 seconds, mute them
    if (userMessages.length > 5) {
        try {
            const member = await message.guild.members.fetch(userId);
            
            // Timeout user for 5 minutes
            await member.timeout(5 * 60 * 1000, 'Spamming messages');
            
            await message.channel.send(`${message.author} has been muted for 5 minutes for spamming.`);
            await logAction('ANTI_SPAM', 
                `**User:** ${message.author.tag} (${message.author.id})\n**Messages:** ${userMessages.length} in 5 seconds\n**Action:** 5 minute timeout`,
                0xFF0000, message.author, { guildId: message.guild.id }
            );
            
            // Reset message count
            memoryData.userMessageCount.delete(userId);
        } catch (error) {
            console.error('Error muting user for spam:', error);
        }
    }
    
    // Link blocking
    const urlRegex = /https?:\/\/[^\s]+/g;
    if (urlRegex.test(message.content) && !await isWhitelisted(message.author.id)) {
        await message.delete();
        
        const warningEmbed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('⚠️ Link Blocked')
            .setDescription('Links are not allowed in this server. Your message has been deleted.')
            .setTimestamp();
        
        try {
            const warningMsg = await message.channel.send({ 
                content: `${message.author}`, 
                embeds: [warningEmbed] 
            });
            
            // Delete warning after 5 seconds
            setTimeout(() => warningMsg.delete().catch(() => {}), 5000);
        } catch (error) {
            console.error('Error sending link warning:', error);
        }
        
        await logAction('LINK_BLOCK', 
            `**User:** ${message.author.tag} (${message.author.id})\n**Content:** ${message.content}\n**Channel:** ${message.channel}`,
            0xFF0000, message.author, { guildId: message.guild.id }
        );
        
        // Add warning for link violation
        await addWarning(message.author, message.guild, 'Link violation', message.member);
    }
    
    // Invite link protection
    const inviteRegex = /(discord\.gg|discordapp\.com\/invite|discord\.com\/invite)\/[a-zA-Z0-9]+/g;
    if (inviteRegex.test(message.content) && !await isWhitelisted(message.author.id)) {
        await message.delete();
        
        const warningEmbed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('⚠️ Invite Blocked')
            .setDescription('Discord invites are not allowed in this server. Your message has been deleted.')
            .setTimestamp();
        
        try {
            const warningMsg = await message.channel.send({ 
                content: `${message.author}`, 
                embeds: [warningEmbed] 
            });
            
            // Delete warning after 5 seconds
            setTimeout(() => warningMsg.delete().catch(() => {}), 5000);
        } catch (error) {
            console.error('Error sending invite warning:', error);
        }
        
        await logAction('INVITE_BLOCK', 
            `**User:** ${message.author.tag} (${message.author.id})\n**Content:** ${message.content}\n**Channel:** ${message.channel}`,
            0xFF0000, message.author, { guildId: message.guild.id }
        );
        
        // Add warning for invite violation
        await addWarning(message.author, message.guild, 'Discord invite violation', message.member);
    }
    
    // Mass mention detection
    const mentionCount = (message.mentions.users.size + message.mentions.roles.size);
    const hasEveryone = message.mentions.everyone || message.mentions.here;
    
    if ((hasEveryone || mentionCount > 3) && !await isWhitelisted(message.author.id)) {
        // Check if user has permission to mention everyone
        if (message.member.permissions.has(PermissionsBitField.Flags.MentionEveryone)) return;
        
        await message.delete();
        
        const warningEmbed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('⚠️ Mass Mention Detected')
            .setDescription('Mentioning @everyone, @here, or multiple users/roles is not allowed without proper permissions.')
            .setTimestamp();
        
        try {
            const warningMsg = await message.channel.send({ 
                content: `${message.author}`, 
                embeds: [warningEmbed] 
            });
            
            // Delete warning after 5 seconds
            setTimeout(() => warningMsg.delete().catch(() => {}), 5000);
        } catch (error) {
            console.error('Error sending mass mention warning:', error);
        }
        
        // Add warning for mass mention
        await addWarning(message.author, message.guild, 'Mass mention violation', message.member);
        
        await logAction('MASS_MENTION_WARNING', 
            `**User:** ${message.author.tag} (${message.author.id})\n**Mentions:** ${mentionCount} users/roles\n**Channel:** ${message.channel}`,
            0xFFA500, message.author, { guildId: message.guild.id }
        );
    }
});

// Slash Commands
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isCommand()) return;
    
    const { commandName, options, guildId, user } = interaction;
    
    // Log command execution
    await logAction('COMMAND_EXECUTED', 
        `**Command:** /${commandName}\n**User:** ${user.tag} (${user.id})\n**Channel:** ${interaction.channel}`,
        0x3498DB, user, { guildId: guildId }
    );
    
    // Special handling for whitelist/immune commands - only allow specific users
    if (commandName === 'whitelist' || commandName === 'immune') {
        if (!isAuthorized(user.id, guildId)) {
            await interaction.reply({ 
                content: '❌ You are not authorized to use this command.', 
                ephemeral: true 
            });
            await logAction('UNAUTHORIZED_COMMAND', `${user.tag} attempted to use /${commandName} without authorization`, 0xFF0000, user, { guildId: guildId });
            return;
        }
    }
    
    // For all other commands, use the existing permission check
    if (commandName !== 'whitelist' && commandName !== 'immune') {
        if (!isAuthorized(user.id, guildId)) {
            await interaction.reply({ 
                content: '❌ You are not authorized to use this command.', 
                ephemeral: true 
            });
            return;
        }
    }
    
    if (commandName === 'set_welcome_channel') {
        const channel = options.getChannel('channel');
        if (channel) {
            await saveConfig(guildId, { welcomeChannelId: channel.id }, user.id);
            
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ Welcome Channel Set')
                .setDescription(`Welcome channel has been set to ${channel}`)
                .addFields(
                    { name: 'Set By', value: user.tag, inline: true },
                    { name: 'Channel ID', value: channel.id, inline: true }
                )
                .setTimestamp();
                
            await interaction.reply({ embeds: [embed] });
            await logAction('CONFIG_UPDATE', `Welcome channel set to ${channel.name} by ${user.tag}`, 0x00FF00, user, { guildId: guildId });
        }
    }
    
    if (commandName === 'set_log_channel') {
        const channel = options.getChannel('channel');
        if (channel) {
            await saveConfig(guildId, { logChannelId: channel.id }, user.id);
            
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ Log Channel Set')
                .setDescription(`Log channel has been set to ${channel}`)
                .addFields(
                    { name: 'Set By', value: user.tag, inline: true },
                    { name: 'Channel ID', value: channel.id, inline: true }
                )
                .setTimestamp();
                
            await interaction.reply({ embeds: [embed] });
            await logAction('CONFIG_UPDATE', `Log channel set to ${channel.name} by ${user.tag}`, 0x00FF00, user, { guildId: guildId });
        }
    }
    
    if (commandName === 'set_ticket_role') {
        const role = options.getRole('role');
        if (role) {
            await saveConfig(guildId, { ticketRoleId: role.id }, user.id);
            
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ Ticket Role Set')
                .setDescription(`Ticket manager role has been set to ${role}`)
                .addFields(
                    { name: 'Set By', value: user.tag, inline: true },
                    { name: 'Role ID', value: role.id, inline: true }
                )
                .setTimestamp();
                
            await interaction.reply({ embeds: [embed] });
            await logAction('CONFIG_UPDATE', `Ticket role set to ${role.name} by ${user.tag}`, 0x00FF00, user, { guildId: guildId });
        }
    }
    
    if (commandName === 'admin_add') {
        const member = options.getUser('user');
        if (member) {
            const config = memoryData.configCache.get(guildId) || configCache;
            const newAdminIds = [...new Set([...config.adminIds, member.id])];
            await saveConfig(guildId, { adminIds: newAdminIds }, user.id);
            
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ Admin Added')
                .setDescription(`${member} has been added as an admin`)
                .addFields(
                    { name: 'Added By', value: user.tag, inline: true },
                    { name: 'User ID', value: member.id, inline: true }
                )
                .setTimestamp();
                
            await interaction.reply({ embeds: [embed] });
            await logAction('CONFIG_UPDATE', `Admin added: ${member.tag} by ${user.tag}`, 0x00FF00, user, { guildId: guildId });
        }
    }
    
    if (commandName === 'admin_remove') {
        const member = options.getUser('user');
        if (member) {
            const config = memoryData.configCache.get(guildId) || configCache;
            const newAdminIds = config.adminIds.filter(id => id !== member.id);
            await saveConfig(guildId, { adminIds: newAdminIds }, user.id);
            
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Admin Removed')
                .setDescription(`${member} has been removed as an admin`)
                .addFields(
                    { name: 'Removed By', value: user.tag, inline: true },
                    { name: 'User ID', value: member.id, inline: true }
                )
                .setTimestamp();
                
            await interaction.reply({ embeds: [embed] });
            await logAction('CONFIG_UPDATE', `Admin removed: ${member.tag} by ${user.tag}`, 0xFF0000, user, { guildId: guildId });
        }
    }
    
    if (commandName === 'config_view') {
        const config = memoryData.configCache.get(guildId) || configCache;
        
        const embed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle('⚙️ Current Configuration')
            .addFields(
                { name: 'Welcome Channel', value: config.welcomeChannelId ? `<#${config.welcomeChannelId}>` : 'Not set', inline: true },
                { name: 'Log Channel', value: config.logChannelId ? `<#${config.logChannelId}>` : 'Not set', inline: true },
                { name: 'Ticket Role', value: config.ticketRoleId ? `<@&${config.ticketRoleId}>` : 'Not set', inline: true },
                { name: 'Admin Users', value: config.adminIds.length > 0 ? config.adminIds.map(id => `<@${id}>`).join(', ') : 'None', inline: false },
                { name: 'Last Updated', value: config.lastUpdated ? `<t:${Math.floor(config.lastUpdated.getTime() / 1000)}:R>` : 'Never', inline: true }
            )
            .setTimestamp();
            
        await interaction.reply({ embeds: [embed] });
    }
    
    if (commandName === 'whitelist') {
        const userToWhitelist = options.getUser('user');
        if (userToWhitelist) {
            const success = await addToWhitelist(userToWhitelist.id, user.id);
            
            if (success) {
                const embed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle('✅ User Whitelisted')
                    .setDescription(`${userToWhitelist} has been added to the whitelist.`)
                    .addFields(
                        { name: 'Added By', value: user.tag, inline: true },
                        { name: 'User ID', value: userToWhitelist.id, inline: true }
                    )
                    .setTimestamp();
                    
                await interaction.reply({ embeds: [embed] });
                await logAction('WHITELIST_ADD', `${user.tag} whitelisted ${userToWhitelist.tag}`, 0x00FF00, user, { guildId: guildId });
            } else {
                await interaction.reply({ 
                    content: '❌ Failed to whitelist user.', 
                    ephemeral: true 
                });
            }
        }
    }
    
    if (commandName === 'unwhitelist') {
        const userToUnwhitelist = options.getUser('user');
        if (userToUnwhitelist) {
            const success = await removeFromWhitelist(userToUnwhitelist.id);
            
            if (success) {
                const embed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('❌ User Unwhitelisted')
                    .setDescription(`${userToUnwhitelist} has been removed from the whitelist.`)
                    .addFields(
                        { name: 'Removed By', value: user.tag, inline: true },
                        { name: 'User ID', value: userToUnwhitelist.id, inline: true }
                    )
                    .setTimestamp();
                    
                await interaction.reply({ embeds: [embed] });
                await logAction('WHITELIST_REMOVE', `${user.tag} unwhitelisted ${userToUnwhitelist.tag}`, 0xFF0000, user, { guildId: guildId });
            } else {
                await interaction.reply({ 
                    content: '❌ Failed to unwhitelist user.', 
                    ephemeral: true 
                });
            }
        }
    }
    
    if (commandName === 'immune') {
        const userToImmune = options.getUser('user');
        const reason = options.getString('reason') || 'No reason provided';
        
        if (userToImmune) {
            const success = await addToImmune(userToImmune.id, user.id, reason);
            
            if (success) {
                const embed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle('✅ User Made Immune')
                    .setDescription(`${userToImmune} is now immune to warnings.`)
                    .addFields(
                        { name: 'Reason', value: reason, inline: true },
                        { name: 'Added By', value: user.tag, inline: true },
                        { name: 'User ID', value: userToImmune.id, inline: true }
                    )
                    .setTimestamp();
                    
                await interaction.reply({ embeds: [embed] });
                await logAction('IMMUNE_ADD', `${user.tag} made ${userToImmune.tag} immune to warnings`, 0x00FF00, user, { guildId: guildId });
            } else {
                await interaction.reply({ 
                    content: '❌ Failed to make user immune.', 
                    ephemeral: true 
                });
            }
        }
    }
    
    if (commandName === 'unimmune') {
        const userToUnimmune = options.getUser('user');
        
        if (userToUnimmune) {
            const success = await removeFromImmune(userToUnimmune.id);
            
            if (success) {
                const embed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('❌ Immunity Removed')
                    .setDescription(`${userToUnimmune} is no longer immune to warnings.`)
                    .addFields(
                        { name: 'Removed By', value: user.tag, inline: true },
                        { name: 'User ID', value: userToUnimmune.id, inline: true }
                    )
                    .setTimestamp();
                    
                await interaction.reply({ embeds: [embed] });
                await logAction('IMMUNE_REMOVE', `${user.tag} removed immunity from ${userToUnimmune.tag}`, 0xFF0000, user, { guildId: guildId });
            } else {
                await interaction.reply({ 
                    content: '❌ Failed to remove immunity.', 
                    ephemeral: true 
                });
            }
        }
    }
    
    if (commandName === 'view_immune') {
        const immuneUsers = await Immune.find();
        
        if (immuneUsers.length === 0) {
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ No Immune Users')
                .setDescription('There are currently no immune users.')
                .setTimestamp();
                
            await interaction.reply({ embeds: [embed] });
            return;
        }
        
        const immuneList = immuneUsers.slice(0, 10).map((u, i) => 
            `**${i+1}.** <@${u.userId}> - Added by <@${u.addedBy}> (<t:${Math.floor(u.timestamp.getTime() / 1000)}:R>)\n   Reason: ${u.reason}`
        ).join('\n\n');
        
        const embed = new EmbedBuilder()
            .setColor(0xFFFF00)
            .setTitle('🛡️ Immune Users')
            .setDescription(immuneList)
            .setFooter({ text: `Showing ${Math.min(immuneUsers.length, 10)} of ${immuneUsers.length} immune users` })
            .setTimestamp();
            
        await interaction.reply({ embeds: [embed] });
    }
    
    if (commandName === 'warn') {
        const userToWarn = options.getUser('user');
        const reason = options.getString('reason');
        
        if (userToWarn && reason) {
            // Check if trying to warn self
            if (userToWarn.id === user.id) {
                await interaction.reply({ 
                    content: '❌ You cannot warn yourself.', 
                    ephemeral: true 
                });
                return;
            }
            
            // Check if trying to warn a bot
            if (userToWarn.bot) {
                await interaction.reply({ 
                    content: '❌ You cannot warn bots.', 
                    ephemeral: true 
                });
                return;
            }
            
            // Check if user is immune
            if (await isImmune(userToWarn.id)) {
                const immuneEmbed = new EmbedBuilder()
                    .setColor(0xFFFF00)
                    .setTitle('🛡️ Immune User')
                    .setDescription(`${userToWarn.tag} is immune to warnings and cannot be warned.`)
                    .addFields(
                        { name: 'User', value: `${userToWarn} (${userToWarn.tag})`, inline: true },
                        { name: 'Moderator', value: `${user}`, inline: true },
                        { name: 'Attempted Reason', value: reason, inline: false }
                    )
                    .setThumbnail(userToWarn.displayAvatarURL())
                    .setFooter({ text: `User ID: ${userToWarn.id}` })
                    .setTimestamp();
                
                await interaction.reply({ embeds: [immuneEmbed] });
                await logAction('IMMUNE_BLOCK', `${user.tag} attempted to warn immune user ${userToWarn.tag}`, 0xFFFF00, user, { guildId: guildId });
                return;
            }
            
            // Check if user is whitelisted
            if (await isWhitelisted(userToWarn.id)) {
                await interaction.reply({ 
                    content: '❌ This user is whitelisted and cannot be warned.', 
                    ephemeral: true 
                });
                return;
            }
            
            const { warnings, warningId } = await addWarning(userToWarn, interaction.guild, reason, interaction.member);
            
            if (warnings === -1) {
                const immuneEmbed = new EmbedBuilder()
                    .setColor(0xFFFF00)
                    .setTitle('🛡️ Immune User')
                    .setDescription(`${userToWarn.tag} is immune to warnings and cannot be warned.`)
                    .setThumbnail(userToWarn.displayAvatarURL())
                    .setFooter({ text: `User ID: ${userToWarn.id}` })
                    .setTimestamp();
                
                await interaction.reply({ embeds: [immuneEmbed] });
                return;
            }
            
            if (warnings > 0) {
                const warnEmbed = new EmbedBuilder()
                    .setColor(0xFFA500)
                    .setTitle('⚠️ Warning Issued')
                    .setDescription(`A warning has been issued to ${userToWarn.tag}`)
                    .addFields(
                        { name: 'User', value: `${userToWarn} (${userToWarn.tag})`, inline: true },
                        { name: 'Moderator', value: `${user}`, inline: true },
                        { name: 'Warning ID', value: `\`${warningId}\``, inline: true },
                        { name: 'Reason', value: reason, inline: false },
                        { name: 'Total Warnings', value: `${warnings}/3`, inline: true },
                        { name: 'Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
                        { name: 'Next Action', value: warnings >= 3 ? 'Kick from server' : 'Warning', inline: true }
                    )
                    .setThumbnail(userToWarn.displayAvatarURL())
                    .setFooter({ text: `User ID: ${userToWarn.id}` })
                    .setTimestamp();
                
                await interaction.reply({ embeds: [warnEmbed] });
                await logAction('WARNING_ISSUED', `${user.tag} warned ${userToWarn.tag} for: ${reason} (Total: ${warnings}/3)`, 0xFFA500, user, { guildId: guildId });
                
                if (warnings >= 3) {
                    const kickEmbed = new EmbedBuilder()
                        .setColor(0xFF0000)
                        .setTitle('🚫 Member Kicked')
                        .setDescription(`${userToWarn.tag} has been kicked for accumulating 3 warnings`)
                        .addFields(
                            { name: 'User', value: `${userToWarn} (${userToWarn.tag})`, inline: true },
                            { name: 'Moderator', value: `${user}`, inline: true },
                            { name: 'Reason', value: 'Excessive warnings (3/3)', inline: true },
                            { name: 'Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                        )
                        .setThumbnail(userToWarn.displayAvatarURL())
                        .setFooter({ text: `User ID: ${userToWarn.id}` })
                        .setTimestamp();
                    
                    await interaction.followUp({ embeds: [kickEmbed] });
                }
            } else {
                await interaction.reply({ 
                    content: '❌ Failed to issue warning.', 
                    ephemeral: true 
                });
            }
        }
    }
    
    if (commandName === 'setup_tickets') {
        const panelEmbed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle('🎫 Support Ticket System')
            .setDescription('**Click The Below Button To Open Ticket**\n\n🔥 **General Support**\n💜 **Team Apply**\n🤝 **Ally/Merge**\n\n*Note: Don\'t make ticket for fun = 1 day timeout + Noted For Future*')
            .setFooter({ text: 'Team Jupiter Support System', iconURL: interaction.guild.iconURL() })
            .setTimestamp();
            
        const generalButton = new ButtonBuilder()
            .setCustomId('general_support')
            .setLabel('General Support')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🔥');
            
        const teamButton = new ButtonBuilder()
            .setCustomId('team_apply')
            .setLabel('Team Apply')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('💜');
            
        const allyButton = new ButtonBuilder()
            .setCustomId('ally_merge')
            .setLabel('Ally/Merge')
            .setStyle(ButtonStyle.Success)
            .setEmoji('🤝');
            
        const row = new ActionRowBuilder().addComponents(generalButton, teamButton, allyButton);
        
        await interaction.channel.send({ embeds: [panelEmbed], components: [row] });
        
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('✅ Ticket Panel Created')
            .setDescription('Ticket panel has been successfully created!')
            .setTimestamp();
            
        await interaction.reply({ embeds: [embed], ephemeral: true });
        await logAction('TICKET_SETUP', `${user.tag} setup ticket panel`, 0x00FF00, user, { guildId: guildId });
    }
    
    if (commandName === 'clear_warnings') {
        const userToClear = options.getUser('user');
        if (userToClear) {
            const success = await clearWarnings(userToClear.id, guildId);
            
            if (success) {
                const embed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle('✅ Warnings Cleared')
                    .setDescription(`Cleared all warnings for ${userToClear.tag}`)
                    .addFields(
                        { name: 'User', value: `${userToClear} (${userToClear.tag})`, inline: true },
                        { name: 'Moderator', value: `${user}`, inline: true },
                        { name: 'Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                    )
                    .setThumbnail(userToClear.displayAvatarURL())
                    .setFooter({ text: `User ID: ${userToClear.id}` })
                    .setTimestamp();
                    
                await interaction.reply({ embeds: [embed] });
                await logAction('WARNINGS_CLEARED', `${user.tag} cleared warnings for ${userToClear.tag}`, 0x00FF00, user, { guildId: guildId });
            } else {
                await interaction.reply({ 
                    content: '❌ Failed to clear warnings.', 
                    ephemeral: true 
                });
            }
        }
    }
    
    if (commandName === 'view_warnings') {
        const userToView = options.getUser('user') || user;
        
        const warnings = await getWarnings(userToView.id, guildId);
        
        if (warnings.length === 0) {
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ No Warnings')
                .setDescription(`${userToView.tag} has no warnings.`)
                .setThumbnail(userToView.displayAvatarURL())
                .setFooter({ text: `User ID: ${userToView.id}` })
                .setTimestamp();
                
            await interaction.reply({ embeds: [embed] });
            return;
        }
        
        const warningList = warnings.slice(0, 10).map((w, i) => 
            `**${i+1}.** ${w.reason} - <t:${Math.floor(w.timestamp.getTime() / 1000)}:R> (ID: \`${w.warningId}\`)`
        ).join('\n');
        
        const embed = new EmbedBuilder()
            .setColor(0xFFA500)
            .setTitle(`⚠️ Warnings for ${userToView.tag}`)
            .setDescription(warningList)
            .addFields(
                { name: 'Total Warnings', value: warnings.length.toString(), inline: true },
                { name: 'Next Action', value: warnings.length >= 3 ? 'Kick from server' : 'Warning', inline: true }
            )
            .setThumbnail(userToView.displayAvatarURL())
            .setFooter({ text: `User ID: ${userToView.id} | Showing ${Math.min(warnings.length, 10)} of ${warnings.length} warnings` })
            .setTimestamp();
            
        await interaction.reply({ embeds: [embed] });
    }
    
    if (commandName === 'remove_warning') {
        const warningId = options.getString('warning_id');
        
        if (warningId) {
            const success = await removeWarning(warningId, guildId);
            
            if (success) {
                const embed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle('✅ Warning Removed')
                    .setDescription(`Successfully removed warning with ID: \`${warningId}\``)
                    .addFields(
                        { name: 'Moderator', value: `${user}`, inline: true },
                        { name: 'Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                    )
                    .setTimestamp();
                    
                await interaction.reply({ embeds: [embed] });
                await logAction('WARNING_REMOVED', `${user.tag} removed warning with ID: ${warningId}`, 0x00FF00, user, { guildId: guildId });
            } else {
                await interaction.reply({ 
                    content: '❌ Failed to remove warning. Make sure the warning ID is correct.', 
                    ephemeral: true 
                });
            }
        }
    }
    
    if (commandName === 'welcome_test') {
        try {
            const welcomeEmbed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('🎉 Welcome to Team Jupiter! 🎉')
                .setDescription(`${user}, :wave: hey! welcome to **Team Jupiter**, the ultimate gaming experience!\nWe hope you enjoy your stay and have an amazing time here. Make sure to check out the community and get involved!\n\n:sword: **Team Jupiter**`)
                .setThumbnail(user.displayAvatarURL())
                .setImage('https://images-ext-1.discordapp.net/external/1vFDeXmdRWn_3XIfN2wncqUh5FRIRmfPmXOPiczCvRw/https/i.pinimg.com/736x/a9/eb/a3/a9eba3be002462632df36598cf737e53.jpg?format=webp&width=828&height=466')
                .setFooter({ text: `Member #${interaction.guild.memberCount}`, iconURL: interaction.guild.iconURL() })
                .setTimestamp();
                
            await interaction.reply({ 
                content: `**Welcome Message Preview:**`, 
                embeds: [welcomeEmbed] 
            });
            
            await logAction('WELCOME_TEST', `${user.tag} tested the welcome message`, 0x00FF00, user, { guildId: guildId });
        } catch (error) {
            console.error('Error testing welcome message:', error);
            await interaction.reply({ 
                content: '❌ Failed to test welcome message.', 
                ephemeral: true 
            });
        }
    }
    
    if (commandName === 'lockdown') {
        const action = options.getString('action');
        
        if (action === 'enable') {
            await enableLockdown(interaction.guild);
            await interaction.reply('✅ Server lockdown enabled.');
        } else if (action === 'disable') {
            await disableLockdown(interaction.guild);
            await interaction.reply('✅ Server lockdown disabled.');
        }
    }
});

// Register slash commands for a specific guild
client.on(Events.ClientReady, async () => {
    console.log(`✅ Logged in as ${client.user.tag}!`);
    
    // Set bot status
    client.user.setActivity('Team Jupiter', { type: 'WATCHING' });
    
    // Load config for all guilds
    for (const [id, guild] of client.guilds.cache) {
        await loadConfig(id);
    }
    
    await logAction('BOT_READY', `Bot is online as ${client.user.tag}\n**Servers:** ${client.guilds.cache.size}\n**Users:** ${client.users.cache.size}`, 0x00FF00, client.user, { guildId: client.guilds.cache.first()?.id });
    
    // Delete all old commands for the specific guild
    const guilds = client.guilds.cache;
    for (const [id, guild] of guilds) {
        try {
            // Get all commands for this guild
            const commands = await guild.commands.fetch();
            
            // Delete all existing commands
            for (const command of commands.values()) {
                await guild.commands.delete(command.id);
                console.log(`Deleted command: ${command.name} from guild: ${guild.name}`);
            }
        } catch (error) {
            console.error('Error deleting old commands:', error);
        }
    }
    
    // Register new commands for all guilds
    const commands = [
        {
            name: 'set_welcome_channel',
            description: 'Set the welcome channel',
            options: [
                {
                    name: 'channel',
                    type: 7,
                    description: 'The channel to set as welcome channel',
                    required: true,
                    channel_types: [ChannelType.GuildText]
                }
            ]
        },
        {
            name: 'set_log_channel',
            description: 'Set the log channel',
            options: [
                {
                    name: 'channel',
                    type: 7,
                    description: 'The channel to set as log channel',
                    required: true,
                    channel_types: [ChannelType.GuildText]
                }
            ]
        },
        {
            name: 'set_ticket_role',
            description: 'Set the ticket manager role',
            options: [
                {
                    name: 'role',
                    type: 8,
                    description: 'The role to set as ticket manager',
                    required: true
                }
            ]
        },
        {
            name: 'admin_add',
            description: 'Add a user as admin',
            options: [
                {
                    name: 'user',
                    type: 6,
                    description: 'The user to add as admin',
                    required: true
                }
            ]
        },
        {
            name: 'admin_remove',
            description: 'Remove a user from admin',
            options: [
                {
                    name: 'user',
                    type: 6,
                    description: 'The user to remove from admin',
                    required: true
                }
            ]
        },
        {
            name: 'config_view',
            description: 'View current configuration'
        },
        {
            name: 'whitelist',
            description: 'Whitelist a user for admin actions',
            options: [
                {
                    name: 'user',
                    type: 6,
                    description: 'The user to whitelist',
                    required: true
                }
            ]
        },
        {
            name: 'unwhitelist',
            description: 'Remove a user from whitelist',
            options: [
                {
                    name: 'user',
                    type: 6,
                    description: 'The user to unwhitelist',
                    required: true
                }
            ]
        },
        {
            name: 'immune',
            description: 'Make a user immune to warnings',
            options: [
                {
                    name: 'user',
                    type: 6,
                    description: 'The user to make immune',
                    required: true
                },
                {
                    name: 'reason',
                    type: 3,
                    description: 'Reason for immunity',
                    required: false
                }
            ]
        },
        {
            name: 'unimmune',
            description: 'Remove immunity from a user',
            options: [
                {
                    name: 'user',
                    type: 6,
                    description: 'The user to remove immunity from',
                    required: true
                }
            ]
        },
        {
            name: 'view_immune',
            description: 'View all immune users'
        },
        {
            name: 'warn',
            description: 'Warn a user for rule violations',
            options: [
                {
                    name: 'user',
                    type: 6,
                    description: 'The user to warn',
                    required: true
                },
                {
                    name: 'reason',
                    type: 3,
                    description: 'Reason for the warning',
                    required: true
                }
            ]
        },
        {
            name: 'setup_tickets',
            description: 'Setup the ticket panel'
        },
        {
            name: 'clear_warnings',
            description: 'Clear warnings for a user',
            options: [
                {
                    name: 'user',
                    type: 6,
                    description: 'The user to clear warnings for',
                    required: true
                }
            ]
        },
        {
            name: 'view_warnings',
            description: 'View warnings for a user',
            options: [
                {
                    name: 'user',
                    type: 6,
                    description: 'The user to view warnings for',
                    required: false
                }
            ]
        },
        {
            name: 'remove_warning',
            description: 'Remove a specific warning by ID',
            options: [
                {
                    name: 'warning_id',
                    type: 3,
                    description: 'The ID of the warning to remove',
                    required: true
                }
            ]
        },
        {
            name: 'welcome_test',
            description: 'Test the welcome message'
        },
        {
            name: 'lockdown',
            description: 'Enable or disable server lockdown',
            options: [
                {
                    name: 'action',
                    type: 3,
                    description: 'The action to perform',
                    required: true,
                    choices: [
                        {
                            name: 'enable',
                            value: 'enable'
                        },
                        {
                            name: 'disable',
                            value: 'disable'
                        }
                    ]
                }
            ]
        }
    ];
    
    try {
        // Register commands for all guilds
        for (const [id, guild] of client.guilds.cache) {
            await guild.commands.set(commands);
            console.log(`✅ Slash commands registered for guild: ${guild.name}`);
        }
    } catch (error) {
        console.error('❌ Error registering commands:', error);
    }
});

// Graceful shutdown handling
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  
  // Destroy client
  if (client && client.destroy) {
    client.destroy();
  }
  
  // Close MongoDB connection
  mongoose.connection.close();
  
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  
  // Destroy client
  if (client && client.destroy) {
    client.destroy();
  }
  
  // Close MongoDB connection
  mongoose.connection.close();
  
  process.exit(0);
});

// Error handling
client.on(Events.Error, (error) => {
    console.error('❌ Discord client error:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled promise rejection:', error);
});

// Auto-restart mechanism (for unexpected crashes)
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught exception:', error);
    process.exit(1);
});

// Login
if (!process.env.BOT_TOKEN) {
    console.error('❌ Bot token not found in .env file');
    process.exit(1);
}

client.login(process.env.BOT_TOKEN);
