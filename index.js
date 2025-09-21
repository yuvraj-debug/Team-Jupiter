// index.js - Team Jupiter Enterprise Security & Management Bot (Enhanced)
require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    Collection, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ChannelType,
    PermissionFlagsBits,
    Events,
    AuditLogEvent,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const mongoose = require('mongoose');
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;
const fs = require('fs');
const path = require('path');

// Express server for keep-alive
app.get('/', (req, res) => {
    res.send('Team Jupiter Bot is Online!');
});
app.listen(port, () => {
    console.log(`Keep-alive server running on port ${port}`);
});

// Initialize Discord Client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildEmojisAndStickers,
        GatewayIntentBits.GuildIntegrations,
        GatewayIntentBits.GuildWebhooks,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMessageTyping,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageReactions,
        GatewayIntentBits.DirectMessageTyping,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildScheduledEvents,
        GatewayIntentBits.AutoModerationConfiguration,
        GatewayIntentBits.AutoModerationExecution
    ],
    partials: [
        Partials.Channel,
        Partials.GuildMember,
        Partials.Message,
        Partials.User,
        Partials.ThreadMember
    ]
});

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/teamjupiter')
.then(() => {
    console.log('Connected to MongoDB');
}).catch(err => {
    console.error('MongoDB connection error:', err);
});

// Database Schemas
// Guild Settings Schema
const guildSettingsSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true },
    welcomeChannelId: String,
    logChannelId: String,
    ticketChannelId: String,
    antiNukeEnabled: { type: Boolean, default: true },
    maxChannelCreate: { type: Number, default: 2 },
    maxChannelDelete: { type: Number, default: 2 },
    maxRoleCreate: { type: Number, default: 2 },
    maxRoleDelete: { type: Number, default: 2 },
    maxBanAdd: { type: Number, default: 3 },
    lockdownMode: { type: Boolean, default: false }
});
const GuildSettings = mongoose.model('GuildSettings', guildSettingsSchema);

// Whitelist Schema
const whitelistSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    addedBy: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    reason: String
});
const Whitelist = mongoose.model('Whitelist', whitelistSchema);

// Warnings Schema
const warningsSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    guildId: { type: String, required: true },
    reason: { type: String, required: true },
    moderator: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    warningId: { type: String, required: true, unique: true },
    severity: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH'], default: 'MEDIUM' }
});
const Warnings = mongoose.model('Warnings', warningsSchema);

// Tickets Schema
const ticketsSchema = new mongoose.Schema({
    channelId: { type: String, required: true, unique: true },
    creator: { type: String, required: true },
    type: { type: String, required: true },
    claimedBy: String,
    locked: { type: Boolean, default: false },
    closed: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    closedAt: Date,
    messages: [{
        author: String,
        content: String,
        timestamp: Date,
        attachments: [String]
    }]
});
const Tickets = mongoose.model('Tickets', ticketsSchema);

// Security Log Schema
const securityLogSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    action: { type: String, required: true },
    executorId: { type: String, required: true },
    targetId: String,
    reason: String,
    severity: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], default: 'MEDIUM' },
    timestamp: { type: Date, default: Date.now },
    autoAction: { type: Boolean, default: false }
});
const SecurityLog = mongoose.model('SecurityLog', securityLogSchema);

// Client setup
client.commands = new Collection();
client.cooldowns = new Collection();

// Cache for anti-nuke protection
const recentActions = {
    channelCreate: new Map(),
    channelDelete: new Map(),
    roleCreate: new Map(),
    roleDelete: new Map(),
    banAdd: new Map(),
    kickAdd: new Map()
};

// Rate limiting for commands and messages
const userCommandUsage = new Map();
const userMessageCount = new Map();

// Constants
const GOD_MODE_USER_ID = process.env.GOD_MODE_USER_ID || '1202998273376522321';
const TICKET_VIEWER_ROLE_ID = process.env.TICKET_VIEWER_ROLE_ID;
const SPECIAL_ROLE_ID = process.env.SPECIAL_ROLE_ID || '1414824820901679155';
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;

// Utility Functions
function generateWarningId() {
    return 'WRN' + Math.random().toString(36).substring(2, 10).toUpperCase();
}

function generateTicketId() {
    return 'TKT' + Math.random().toString(36).substring(2, 8).toUpperCase();
}

async function isWhitelisted(userId) {
    return await Whitelist.exists({ userId: userId });
}

async function getGuildSettings(guildId) {
    let settings = await GuildSettings.findOne({ guildId: guildId });
    if (!settings) {
        settings = new GuildSettings({
            guildId: guildId,
            welcomeChannelId: process.env.WELCOME_CHANNEL_ID || null,
            logChannelId: process.env.LOG_CHANNEL_ID || null,
            ticketChannelId: process.env.TICKET_CHANNEL_ID || null
        });
        await settings.save();
    }
    return settings;
}

async function logAction(guild, level, title, description, fields = [], ping = false) {
    try {
        const settings = await getGuildSettings(guild.id);
        const logChannelId = settings.logChannelId;
        if (!logChannelId) return;

        const logChannel = guild.channels.cache.get(logChannelId);
        if (!logChannel) return;

        let color;
        switch (level) {
            case 'LOW': color = 0x3498DB; break;      // Blue
            case 'MEDIUM': color = 0xF39C12; break;   // Orange
            case 'HIGH': color = 0xE74C3C; break;     // Red
            case 'CRITICAL': color = 0x992D22; break; // Dark Red
            default: color = 0x3498DB;
        }

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor(color)
            .setTimestamp()
            .setFooter({ text: 'Team Jupiter Security', iconURL: guild.iconURL() });

        if (fields.length > 0) {
            embed.addFields(fields);
        }

        let content = ping ? '@everyone' : '';
        await logChannel.send({ content, embeds: [embed] });
        
        // Also log to database
        const securityLog = new SecurityLog({
            guildId: guild.id,
            action: title,
            executorId: 'SYSTEM',
            reason: description,
            severity: level
        });
        await securityLog.save();
    } catch (error) {
        console.error('Error logging action:', error);
    }
}

async function lockServer(guild, moderatorId, duration = '10m') {
    const settings = await getGuildSettings(guild.id);
    settings.lockdownMode = true;
    await settings.save();
    
    // Parse duration
    let durationMs = 10 * 60 * 1000; // Default 10 minutes
    if (duration.endsWith('m')) {
        durationMs = parseInt(duration) * 60 * 1000;
    } else if (duration.endsWith('h')) {
        durationMs = parseInt(duration) * 60 * 60 * 1000;
    }
    
    // Lock all text channels
    const textChannels = guild.channels.cache.filter(
        channel => channel.type === ChannelType.GuildText
    );
    
    let lockedCount = 0;
    for (const [id, channel] of textChannels) {
        try {
            await channel.permissionOverwrites.edit(guild.id, {
                SendMessages: false,
                AddReactions: false
            });
            lockedCount++;
        } catch (error) {
            console.error(`Error locking channel ${channel.name}:`, error);
        }
    }
    
    // Log the action
    await logAction(
        guild,
        'HIGH',
        '🔒 Server Lockdown Enabled',
        `The server has been locked down for ${duration}.`,
        [
            { name: 'Channels Locked', value: lockedCount.toString(), inline: true },
            { name: 'Duration', value: duration, inline: true },
            { name: 'Moderator', value: `<@${moderatorId}>`, inline: true }
        ]
    );
    
    // Auto-unlock after duration
    setTimeout(async () => {
        await unlockServer(guild, 'System (Auto)');
    }, durationMs);
    
    return lockedCount;
}

async function unlockServer(guild, moderator = 'System') {
    const settings = await getGuildSettings(guild.id);
    settings.lockdownMode = false;
    await settings.save();
    
    // Unlock all text channels
    const textChannels = guild.channels.cache.filter(
        channel => channel.type === ChannelType.GuildText
    );
    
    let unlockedCount = 0;
    for (const [id, channel] of textChannels) {
        try {
            await channel.permissionOverwrites.edit(guild.id, {
                SendMessages: null,
                AddReactions: null
            });
            unlockedCount++;
        } catch (error) {
            console.error(`Error unlocking channel ${channel.name}:`, error);
        }
    }
    
    // Log the action
    await logAction(
        guild,
        'HIGH',
        '🔓 Server Lockdown Disabled',
        `The server lockdown has been lifted.`,
        [
            { name: 'Channels Unlocked', value: unlockedCount.toString(), inline: true },
            { name: 'Moderator', value: moderator, inline: true }
        ]
    );
    
    return unlockedCount;
}

// Enhanced Anti-Nuke Monitoring
async function monitorAuditLogs(guild) {
    try {
        const settings = await getGuildSettings(guild.id);
        if (!settings.antiNukeEnabled) return;
        
        const auditLogs = await guild.fetchAuditLogs({ limit: 10 });
        
        for (const entry of auditLogs.entries.values()) {
            // Skip if user is whitelisted
            if (await isWhitelisted(entry.executor.id)) continue;
            
            const now = Date.now();
            const actionType = entry.action;
            const executorId = entry.executor.id;
            
            // Skip if executor is a bot (unless it's our bot)
            if (entry.executor.bot && entry.executor.id !== client.user.id) continue;
            
            // Track different types of actions
            if ([AuditLogEvent.ChannelCreate, AuditLogEvent.ChannelDelete, 
                 AuditLogEvent.RoleCreate, AuditLogEvent.RoleDelete, 
                 AuditLogEvent.MemberBanAdd, AuditLogEvent.MemberKick].includes(actionType)) {
                
                let actionMap;
                let maxActions;
                let actionName;
                
                switch (actionType) {
                    case AuditLogEvent.ChannelCreate: 
                        actionMap = recentActions.channelCreate; 
                        maxActions = settings.maxChannelCreate;
                        actionName = 'Channel Creation';
                        break;
                    case AuditLogEvent.ChannelDelete: 
                        actionMap = recentActions.channelDelete; 
                        maxActions = settings.maxChannelDelete;
                        actionName = 'Channel Deletion';
                        break;
                    case AuditLogEvent.RoleCreate: 
                        actionMap = recentActions.roleCreate; 
                        maxActions = settings.maxRoleCreate;
                        actionName = 'Role Creation';
                        break;
                    case AuditLogEvent.RoleDelete: 
                        actionMap = recentActions.roleDelete; 
                        maxActions = settings.maxRoleDelete;
                        actionName = 'Role Deletion';
                        break;
                    case AuditLogEvent.MemberBanAdd: 
                        actionMap = recentActions.banAdd; 
                        maxActions = settings.maxBanAdd;
                        actionName = 'User Ban';
                        break;
                    case AuditLogEvent.MemberKick: 
                        actionMap = recentActions.kickAdd; 
                        maxActions = 3; // Default for kicks
                        actionName = 'User Kick';
                        break;
                }
                
                // Get or create user's action record
                if (!actionMap.has(executorId)) {
                    actionMap.set(executorId, { count: 1, timestamp: now, targets: [entry.targetId] });
                } else {
                    const record = actionMap.get(executorId);
                    
                    // Reset if more than 10 seconds have passed
                    if (now - record.timestamp > 10000) {
                        record.count = 1;
                        record.timestamp = now;
                        record.targets = [entry.targetId];
                    } else {
                        record.count++;
                        if (entry.targetId && !record.targets.includes(entry.targetId)) {
                            record.targets.push(entry.targetId);
                        }
                    }
                    
                    actionMap.set(executorId, record);
                    
                    // Check if threshold is exceeded
                    if (record.count >= maxActions) {
                        try {
                            const member = await guild.members.fetch(executorId);
                            if (member && member.bannable) {
                                await member.ban({ reason: 'Auto-ban: Attempted server nuke' });
                                
                                // Log the critical event
                                await logAction(
                                    guild, 
                                    'CRITICAL', 
                                    '🚨 AUTO-BAN TRIGGERED 🚨', 
                                    `User <@${executorId}> was automatically banned for attempted server nuke.`,
                                    [
                                        { name: 'User', value: `<@${executorId}> (${executorId})`, inline: true },
                                        { name: 'Action Type', value: actionName, inline: true },
                                        { name: 'Count', value: `${record.count}/${maxActions}`, inline: true },
                                        { name: 'Timeframe', value: `${Math.floor((now - record.timestamp)/1000)} seconds`, inline: true }
                                    ],
                                    true
                                );
                                
                                // Enable lockdown mode
                                await lockServer(guild, 'System (Auto)', '30m');
                            } else {
                                console.log(`Cannot ban user ${executorId}: Missing permissions or user not found`);
                            }
                        } catch (error) {
                            console.error('Error auto-banning user:', error);
                        }
                        
                        // Reset the count after action
                        record.count = 0;
                        record.targets = [];
                        actionMap.set(executorId, record);
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error monitoring audit logs:', error);
    }
}

// Enhanced audit log logging with better UI - Only log specific actions
async function logAuditAction(guild, entry) {
    try {
        // Only log specific action types
        const actionTypesToLog = [
            AuditLogEvent.ChannelCreate,
            AuditLogEvent.ChannelDelete,
            AuditLogEvent.RoleCreate,
            AuditLogEvent.RoleDelete,
            AuditLogEvent.MemberBanAdd,
            AuditLogEvent.MemberBanRemove,
            AuditLogEvent.MemberKick,
            AuditLogEvent.MemberUpdate,
            AuditLogEvent.MemberRoleUpdate
        ];
        
        if (!actionTypesToLog.includes(entry.action)) {
            return; // Skip logging for this action type
        }
        
        const settings = await getGuildSettings(guild.id);
        const logChannelId = settings.logChannelId;
        if (!logChannelId) return;

        const logChannel = guild.channels.cache.get(logChannelId);
        if (!logChannel) return;

        let actionType = '';
        let color = 0x3498DB;
        let emoji = '📝';
        let targetInfo = '';

        switch (entry.action) {
            case AuditLogEvent.ChannelCreate:
                actionType = 'Channel Created';
                color = 0x00FF00;
                emoji = '🔧';
                targetInfo = `**Name:** ${entry.target.name}\n**Type:** ${ChannelType[entry.target.type]}`;
                break;
            case AuditLogEvent.ChannelDelete:
                actionType = 'Channel Deleted';
                color = 0xFF0000;
                emoji = '🗑️';
                targetInfo = `**Name:** ${entry.target.name}\n**Type:** ${ChannelType[entry.target.type]}`;
                break;
            case AuditLogEvent.RoleCreate:
                actionType = 'Role Created';
                color = 0x00FF00;
                emoji = '🔧';
                targetInfo = `**Name:** ${entry.target.name}`;
                break;
            case AuditLogEvent.RoleDelete:
                actionType = 'Role Deleted';
                color = 0xFF0000;
                emoji = '🗑️';
                targetInfo = `**Name:** ${entry.target.name}`;
                break;
            case AuditLogEvent.MemberBanAdd:
                actionType = 'Member Banned';
                color = 0xFF0000;
                emoji = '🔨';
                targetInfo = `**User:** <@${entry.target.id}>\n**ID:** ${entry.target.id}`;
                break;
            case AuditLogEvent.MemberBanRemove:
                actionType = 'Member Unbanned';
                color = 0x00FF00;
                emoji = '✅';
                targetInfo = `**User:** <@${entry.target.id}>\n**ID:** ${entry.target.id}`;
                break;
            case AuditLogEvent.MemberKick:
                actionType = 'Member Kicked';
                color = 0xFFA500;
                emoji = '👢';
                targetInfo = `**User:** <@${entry.target.id}>\n**ID:** ${entry.target.id}`;
                break;
            case AuditLogEvent.MemberUpdate:
                actionType = 'Member Updated';
                color = 0xFFFF00;
                emoji = '👤';
                targetInfo = `**User:** <@${entry.target.id}>\n**ID:** ${entry.target.id}`;
                break;
            case AuditLogEvent.MemberRoleUpdate:
                actionType = 'Member Roles Updated';
                color = 0xFFFF00;
                emoji = '🎭';
                
                // Get added and removed roles
                const addedRoles = entry.changes.filter(change => change.key === '$add').map(change => change.new);
                const removedRoles = entry.changes.filter(change => change.key === '$remove').map(change => change.new);
                
                targetInfo = `**User:** <@${entry.target.id}>\n**ID:** ${entry.target.id}`;
                
                if (addedRoles.length > 0) {
                    targetInfo += `\n**Added Roles:** ${addedRoles.map(role => `<@&${role.id}>`).join(', ')}`;
                }
                
                if (removedRoles.length > 0) {
                    targetInfo += `\n**Removed Roles:** ${removedRoles.map(role => `<@&${role.id}>`).join(', ')}`;
                }
                break;
            default:
                // Skip unknown actions to prevent spam
                return;
        }

        const embed = new EmbedBuilder()
            .setTitle(`${emoji} ${actionType}`)
            .setColor(color)
            .setDescription(`**Executor:** <@${entry.executor.id}>\n**Reason:** ${entry.reason || 'No reason provided'}\n\n${targetInfo}`)
            .setTimestamp(entry.createdAt)
            .setFooter({ text: `Action Type: ${entry.action} | ID: ${entry.id}`, iconURL: entry.executor.displayAvatarURL() });

        await logChannel.send({ embeds: [embed] });
    } catch (error) {
        console.error('Error logging audit action:', error);
    }
}

// Event: Ready
client.once(Events.ClientReady, async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    
    // Set activity status
    client.user.setActivity('Team Jupiter', { type: 'WATCHING' });
    
    // Start monitoring audit logs
    setInterval(() => {
        client.guilds.cache.forEach(guild => {
            monitorAuditLogs(guild);
        });
    }, 3000); // Check every 3 seconds
});

// Event: Guild Member Add (Welcome System)
client.on('guildMemberAdd', async (member) => {
    // Skip if bot
    if (member.user.bot) return;
    
    try {
        const settings = await getGuildSettings(member.guild.id);
        const welcomeChannelId = settings.welcomeChannelId;
        
        if (!welcomeChannelId) return;
        
        const welcomeChannel = member.guild.channels.cache.get(welcomeChannelId);
        if (!welcomeChannel) return;
        
        // Account age check for anti-raid
        const accountAge = Date.now() - member.user.createdTimestamp;
        const isNewAccount = accountAge < 7 * 24 * 60 * 60 * 1000; // Less than 7 days
        
        if (isNewAccount) {
            await logAction(
                member.guild,
                'MEDIUM',
                '👤 New Account Joined',
                `User ${member.user.tag} has joined with a new account.`,
                [
                    { name: 'User', value: `${member.user.tag} (${member.user.id})`, inline: true },
                    { name: 'Account Age', value: `${Math.floor(accountAge / (24 * 60 * 60 * 1000))} days`, inline: true },
                    { name: 'Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true }
                ]
            );
        }
        
        // Fixed welcome message as specified
        const welcomeEmbed = new EmbedBuilder()
            .setTitle('🎉 Welcome to Team Jupiter! 🎉')
            .setDescription(`${member.user}, :wave: hey! welcome to **Team Jupiter**, the ultimate gaming experience!\nWe hope you enjoy your stay and have an amazing time here. Make sure to check out the community and get involved!\n\n:sword: **Team Jupiter**`)
            .setColor(0x00FF00)
            .setThumbnail(member.user.displayAvatarURL())
            .setImage('https://images-ext-1.discordapp.net/external/5rVht9i1zqPyw9LqXpWk2yfdk-QWz3sC6p6C3K3y3J0/https/images-ext-2.discordapp.net/external/5rVht9i1zqPyw9LqXpWk2yfdk-QWz3sC6p6C3K3y3J0/https/i.imgur.com/abcdefg.jpg')
            .setFooter({ text: `Member #${member.guild.memberCount}`, iconURL: member.guild.iconURL() })
            .setTimestamp();
        
        await welcomeChannel.send({ embeds: [welcomeEmbed] });
        
        // Log the join
        await logAction(
            member.guild,
            'LOW',
            '👋 New Member Joined',
            `User ${member.user.tag} has joined the server.`,
            [
                { name: 'User', value: `${member.user.tag} (${member.user.id})`, inline: true },
                { name: 'Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
                { name: 'Account Age', value: isNewAccount ? '⚠️ New Account' : '✅ Established', inline: true }
            ]
        );
    } catch (error) {
        console.error('Error sending welcome message:', error);
    }
});

// Event: Guild Member Remove
client.on('guildMemberRemove', async (member) => {
    try {
        // Log the leave
        await logAction(
            member.guild,
            'LOW',
            '👋 Member Left',
            `User ${member.user.tag} has left the server.`,
            [
                { name: 'User', value: `${member.user.tag} (${member.user.id})`, inline: true },
                { name: 'Joined', value: member.joinedAt ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:R>` : 'Unknown', inline: true }
            ]
        );
    } catch (error) {
        console.error('Error logging member leave:', error);
    }
});

// Event: Interaction Create (Slash Commands)
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    
    // Check rate limiting for commands
    const now = Date.now();
    const cooldownAmount = 3000; // 3 seconds cooldown
    
    if (!userCommandUsage.has(interaction.user.id)) {
        userCommandUsage.set(interaction.user.id, [now]);
    } else {
        const timestamps = userCommandUsage.get(interaction.user.id);
        const validTimestamps = timestamps.filter(timestamp => now - timestamp < cooldownAmount);
        
        if (validTimestamps.length >= 5) {
            await interaction.reply({ 
                content: '❌ You are using commands too quickly. Please wait a moment.', 
                ephemeral: true 
            });
            return;
        }
        
        validTimestamps.push(now);
        userCommandUsage.set(interaction.user.id, validTimestamps);
    }
    
    // Handle specific commands
    try {
        if (interaction.commandName === 'whitelist') {
            // Only god-mode user can use this command
            if (interaction.user.id !== GOD_MODE_USER_ID) {
                await interaction.reply({ 
                    content: '❌ You do not have permission to use this command.', 
                    ephemeral: true 
                });
                return;
            }
            
            const user = interaction.options.getUser('user');
            const reason = interaction.options.getString('reason') || 'No reason provided';
            
            if (!user) {
                await interaction.reply({ 
                    content: '❌ Please specify a valid user.', 
                    ephemeral: true 
                });
                return;
            }
            
            // Check if already whitelisted
            const existing = await Whitelist.findOne({ userId: user.id });
            if (existing) {
                await interaction.reply({ 
                    content: `❌ <@${user.id}> is already whitelisted.`, 
                    ephemeral: true 
                });
                return;
            }
            
            // Add to whitelist
            const whitelistEntry = new Whitelist({
                userId: user.id,
                addedBy: interaction.user.id,
                reason: reason
            });
            await whitelistEntry.save();
            
            // Success response
            const embed = new EmbedBuilder()
                .setTitle('✅ User Whitelisted')
                .setColor(0x00FF00)
                .setThumbnail(user.displayAvatarURL())
                .addFields(
                    { name: 'User', value: `<@${user.id}> (${user.id})`, inline: true },
                    { name: 'Added By', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'Reason', value: reason, inline: false },
                    { name: 'Timestamp', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
                )
                .setTimestamp();
            
            await interaction.reply({ embeds: [embed] });
            
            // Log the action
            await logAction(
                interaction.guild,
                'HIGH',
                '📝 User Whitelisted',
                `<@${user.id}> has been added to the whitelist.`,
                [
                    { name: 'User', value: `<@${user.id}> (${user.id})`, inline: true },
                    { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'Reason', value: reason, inline: false }
                ]
            );
        }
        
        else if (interaction.commandName === 'unwhitelist') {
            // Only god-mode user can use this command
            if (interaction.user.id !== GOD_MODE_USER_ID) {
                await interaction.reply({ 
                    content: '❌ You do not have permission to use this command.', 
                    ephemeral: true 
                });
                return;
            }
            
            const user = interaction.options.getUser('user');
            if (!user) {
                await interaction.reply({ 
                    content: '❌ Please specify a valid user.', 
                    ephemeral: true 
                });
                return;
            }
            
            // Check if user is whitelisted
            const existing = await Whitelist.findOne({ userId: user.id });
            if (!existing) {
                await interaction.reply({ 
                    content: `❌ <@${user.id}> is not whitelisted.`, 
                    ephemeral: true 
                });
                return;
            }
            
            // Remove from whitelist
            await Whitelist.deleteOne({ userId: user.id });
            
            // Success response
            const embed = new EmbedBuilder()
                .setTitle('❌ User Unwhitelisted')
                .setColor(0xFF0000)
                .setThumbnail(user.displayAvatarURL())
                .addFields(
                    { name: 'User', value: `<@${user.id}> (${user.id})`, inline: true },
                    { name: 'Removed By', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'Timestamp', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
                )
                .setTimestamp();
            
            await interaction.reply({ embeds: [embed] });
            
            // Log the action
            await logAction(
                interaction.guild,
                'HIGH',
                '📝 User Unwhitelisted',
                `<@${user.id}> has been removed from the whitelist.`,
                [
                    { name: 'User', value: `<@${user.id}> (${user.id})`, inline: true },
                    { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true }
                ]
            );
        }
        
        else if (interaction.commandName === 'setup_welcome') {
            const channel = interaction.options.getChannel('channel');
            if (!channel) {
                await interaction.reply({ 
                    content: '❌ Please specify a valid channel.', 
                    ephemeral: true 
                });
                return;
            }
            
            // Update guild settings
            const settings = await getGuildSettings(interaction.guild.id);
            settings.welcomeChannelId = channel.id;
            await settings.save();
            
            // Success response
            const embed = new EmbedBuilder()
                .setTitle('✅ Welcome Channel Set')
                .setColor(0x00FF00)
                .setDescription(`Welcome messages will now be sent to ${channel}.`)
                .setThumbnail(interaction.guild.iconURL())
                .addFields(
                    { name: 'Channel', value: `${channel.name} (${channel.id})`, inline: true },
                    { name: 'Set By', value: `<@${interaction.user.id}>`, inline: true }
                )
                .setTimestamp();
            
            await interaction.reply({ embeds: [embed] });
            
            // Log the action
            await logAction(
                interaction.guild,
                'LOW',
                '⚙️ Welcome Channel Configured',
                `Welcome channel has been set to ${channel}.`,
                [
                    { name: 'Channel', value: `${channel.name} (${channel.id})`, inline: true },
                    { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true }
                ]
            );
        }
        
        else if (interaction.commandName === 'setup_logs') {
            const channel = interaction.options.getChannel('channel');
            if (!channel) {
                await interaction.reply({ 
                    content: '❌ Please specify a valid channel.', 
                    ephemeral: true 
                });
                return;
            }
            
            // Update guild settings
            const settings = await getGuildSettings(interaction.guild.id);
            settings.logChannelId = channel.id;
            await settings.save();
            
            // Success response
            const embed = new EmbedBuilder()
                .setTitle('✅ Log Channel Set')
                .setColor(0x00FF00)
                .setDescription(`Log messages will now be sent to ${channel}.`)
                .setThumbnail(interaction.guild.iconURL())
                .addFields(
                    { name: 'Channel', value: `${channel.name} (${channel.id})`, inline: true },
                    { name: 'Set By', value: `<@${interaction.user.id}>`, inline: true }
                )
                .setTimestamp();
            
            await interaction.reply({ embeds: [embed] });
            
            // Log the action
            await logAction(
                interaction.guild,
                'LOW',
                '⚙️ Log Channel Configured',
                `Log channel has been set to ${channel}.`,
                [
                    { name: 'Channel', value: `${channel.name} (${channel.id})`, inline: true },
                    { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true }
                ]
            );
        }
        
        else if (interaction.commandName === 'setup_tickets') {
            const channel = interaction.options.getChannel('channel');
            if (!channel) {
                await interaction.reply({ 
                    content: '❌ Please specify a valid channel.', 
                    ephemeral: true 
                });
                return;
            }
            
            // Update guild settings
            const settings = await getGuildSettings(interaction.guild.id);
            settings.ticketChannelId = channel.id;
            await settings.save();
            
            // Create ticket panel
            const embed = new EmbedBuilder()
                .setTitle('🎫 Team Jupiter Support')
                .setColor(0x0099FF)
                .setDescription('Please select the type of ticket you would like to create:\n\n• **General Support**: For general questions and support\n• **Team Apply**: To apply for our team\n• **Ally/Merge**: For alliance or server merge requests\n\n**⚠️ Note**: Creating tickets for fun or without reason will result in a 1-day timeout.')
                .setFooter({ text: 'Team Jupiter Support System', iconURL: interaction.guild.iconURL() })
                .setTimestamp();
            
            const buttons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('ticket_general')
                        .setLabel('General Support')
                        .setEmoji('🔥')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('ticket_apply')
                        .setLabel('Team Apply')
                        .setEmoji('💜')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('ticket_ally')
                        .setLabel('Ally/Merge')
                        .setEmoji('🤝')
                        .setStyle(ButtonStyle.Success)
                );
            
            await channel.send({ embeds: [embed], components: [buttons] });
            
            // Success response (ephemeral)
            await interaction.reply({ 
                content: `✅ Ticket panel has been created in ${channel}.`, 
                ephemeral: true 
            });
            
            // Log the action
            await logAction(
                interaction.guild,
                'LOW',
                '⚙️ Ticket System Configured',
                `Ticket panel has been created in ${channel}.`,
                [
                    { name: 'Channel', value: `${channel.name} (${channel.id})`, inline: true },
                    { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true }
                ]
            );
        }
        
        else if (interaction.commandName === 'test_welcome') {
            // Simulate a guild member add event for the command user
            const mockMember = {
                user: interaction.user,
                guild: interaction.guild,
                displayAvatarURL: () => interaction.user.displayAvatarURL()
            };
            
            // Use the same welcome embed logic
            const welcomeEmbed = new EmbedBuilder()
                .setTitle('🎉 Welcome to Team Jupiter! 🎉')
                .setDescription(`${interaction.user}, :wave: hey! welcome to **Team Jupiter**, the ultimate gaming experience!\nWe hope you enjoy your stay and have an amazing time here. Make sure to check out the community and get involved!\n\n:sword: **Team Jupiter**`)
                .setColor(0x00FF00)
                .setThumbnail(interaction.user.displayAvatarURL())
                .setImage('https://images-ext-1.discordapp.net/external/5rVht9i1zqPyw9LqXpWk2yfdk-QWz3sC6p6C3K3y3J0/https/images-ext-2.discordapp.net/external/5rVht9i1zqPyw9LqXpWk2yfdk-QWz3sC6p6C3K3y3J0/https/i.imgur.com/abcdefg.jpg')
                .setFooter({ text: `Member #${interaction.guild.memberCount}`, iconURL: interaction.guild.iconURL() })
                .setTimestamp();
            
            await interaction.reply({ embeds: [welcomeEmbed] });
        }
        
        else if (interaction.commandName === 'warn') {
            const user = interaction.options.getUser('user');
            const reason = interaction.options.getString('reason') || 'No reason provided';
            const severity = interaction.options.getString('severity') || 'MEDIUM';
            
            if (!user) {
                await interaction.reply({ 
                    content: '❌ Please specify a valid user.', 
                    ephemeral: true 
                });
                return;
            }
            
            // Get current warnings for the user
            const warnings = await Warnings.find({ 
                userId: user.id, 
                guildId: interaction.guild.id 
            });
            
            // Create new warning
            const warningId = generateWarningId();
            const warning = new Warnings({
                userId: user.id,
                guildId: interaction.guild.id,
                reason: reason,
                moderator: interaction.user.id,
                warningId: warningId,
                severity: severity
            });
            await warning.save();
            
            const totalWarnings = warnings.length + 1;
            
            // Response embed
            const embed = new EmbedBuilder()
                .setTitle('⚠️ User Warned')
                .setColor(severity === 'HIGH' ? 0xE74C3C : severity === 'MEDIUM' ? 0xF39C12 : 0x3498DB)
                .setThumbnail(user.displayAvatarURL())
                .addFields(
                    { name: 'User', value: `<@${user.id}> (${user.id})`, inline: true },
                    { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'Reason', value: reason, inline: false },
                    { name: 'Severity', value: severity, inline: true },
                    { name: 'Warning ID', value: warningId, inline: true },
                    { name: 'Total Warnings', value: `${totalWarnings}/3`, inline: true }
                )
                .setTimestamp();
            
            await interaction.reply({ embeds: [embed] });
            
            // Log the action
            await logAction(
                interaction.guild,
                severity,
                '⚠️ User Warned',
                `<@${user.id}> has been warned.`,
                [
                    { name: 'User', value: `<@${user.id}> (${user.id})`, inline: true },
                    { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'Reason', value: reason, inline: false },
                    { name: 'Severity', value: severity, inline: true },
                    { name: 'Warning ID', value: warningId, inline: true },
                    { name: 'Total Warnings', value: `${totalWarnings}/3`, inline: true }
                ]
            );
            
            // Auto-kick on 3rd warning
            if (totalWarnings >= 3) {
                try {
                    const member = await interaction.guild.members.fetch(user.id);
                    if (member.kickable) {
                        await member.kick('Auto-kick: Reached 3 warnings');
                        
                        await logAction(
                            interaction.guild,
                            'HIGH',
                            '🚫 User Auto-Kicked',
                            `<@${user.id}> was automatically kicked for reaching 3 warnings.`,
                            [
                                { name: 'User', value: `<@${user.id}> (${user.id})`, inline: true },
                                { name: 'Moderator', value: 'System (Auto)', inline: true },
                                { name: 'Reason', value: 'Reached 3 warnings', inline: false }
                            ]
                        );
                    }
                } catch (error) {
                    console.error('Error auto-kicking user:', error);
                }
            }
        }
        
        else if (interaction.commandName === 'view_warnings') {
            const user = interaction.options.getUser('user');
            
            if (!user) {
                await interaction.reply({ 
                    content: '❌ Please specify a valid user.', 
                    ephemeral: true 
                });
                return;
            }
            
            // Get warnings for the user
            const warnings = await Warnings.find({ 
                userId: user.id, 
                guildId: interaction.guild.id 
            }).sort({ timestamp: -1 });
            
            if (warnings.length === 0) {
                await interaction.reply({ 
                    content: `✅ <@${user.id}> has no warnings.`, 
                    ephemeral: true 
                });
                return;
            }
            
            // Create embed with warning details
            const embed = new EmbedBuilder()
                .setTitle(`⚠️ Warnings for ${user.tag}`)
                .setColor(0xFFA500)
                .setThumbnail(user.displayAvatarURL());
            
            // Add warnings as fields (limit to 25 to avoid exceeding embed limits)
            warnings.slice(0, 25).forEach(warning => {
                let severityEmoji = '⚠️';
                if (warning.severity === 'HIGH') severityEmoji = '🔴';
                else if (warning.severity === 'MEDIUM') severityEmoji = '🟠';
                else if (warning.severity === 'LOW') severityEmoji = '🔵';
                
                embed.addFields({
                    name: `${severityEmoji} ID: ${warning.warningId} | <t:${Math.floor(warning.timestamp / 1000)}:D>`,
                    value: `**Reason:** ${warning.reason}\n**By:** <@${warning.moderator}>\n**Severity:** ${warning.severity}`,
                    inline: false
                });
            });
            
            // Add footer with total count
            embed.setFooter({ text: `Total Warnings: ${warnings.length}` });
            
            await interaction.reply({ embeds: [embed] });
        }
        
        else if (interaction.commandName === 'security_status') {
            // Get counts for various security metrics
            const whitelistCount = await Whitelist.countDocuments();
            const warningCount = await Warnings.countDocuments({ guildId: interaction.guild.id });
            const securityLogCount = await SecurityLog.countDocuments({ guildId: interaction.guild.id });
            
            const settings = await getGuildSettings(interaction.guild.id);
            
            // Create status embed
            const embed = new EmbedBuilder()
                .setTitle('🛡️ Team Jupiter Security Status')
                .setColor(0x0099FF)
                .setThumbnail(interaction.guild.iconURL())
                .addFields(
                    { name: 'Anti-Nuke Protection', value: settings.antiNukeEnabled ? '✅ Active' : '❌ Disabled', inline: true },
                    { name: 'Auto-Recovery System', value: '✅ Active', inline: true },
                    { name: 'Rate Limiting', value: '✅ Active', inline: true },
                    { name: 'Whitelisted Users', value: whitelistCount.toString(), inline: true },
                    { name: 'Total Warnings', value: warningCount.toString(), inline: true },
                    { name: 'Security Logs', value: securityLogCount.toString(), inline: true },
                    { name: 'Lockdown Mode', value: settings.lockdownMode ? '🔒 Active' : '🔓 Inactive', inline: true },
                    { name: 'Ticket System', value: settings.ticketChannelId ? '✅ Active' : '❌ Not Setup', inline: true },
                    { name: 'Welcome System', value: settings.welcomeChannelId ? '✅ Active' : '❌ Not Setup', inline: true },
                    { name: 'Channel Create Limit', value: settings.maxChannelCreate.toString(), inline: true },
                    { name: 'Channel Delete Limit', value: settings.maxChannelDelete.toString(), inline: true },
                    { name: 'Role Create Limit', value: settings.maxRoleCreate.toString(), inline: true },
                    { name: 'Role Delete Limit', value: settings.maxRoleDelete.toString(), inline: true },
                    { name: 'Ban Limit', value: settings.maxBanAdd.toString(), inline: true }
                )
                .setTimestamp();
            
            await interaction.reply({ embeds: [embed] });
        }
        
        else if (interaction.commandName === 'lockdown') {
            const action = interaction.options.getString('action');
            const duration = interaction.options.getString('duration') || '10m';
            
            if (action === 'enable') {
                const lockedCount = await lockServer(interaction.guild, interaction.user.id, duration);
                
                // Response
                const embed = new EmbedBuilder()
                    .setTitle('🔒 Server Lockdown Enabled')
                    .setColor(0xFF0000)
                    .setDescription(`The server has been locked down for ${duration}.`)
                    .setThumbnail(interaction.guild.iconURL())
                    .addFields(
                        { name: 'Channels Locked', value: lockedCount.toString(), inline: true },
                        { name: 'Duration', value: duration, inline: true },
                        { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true }
                    )
                    .setTimestamp();
                
                await interaction.reply({ embeds: [embed] });
            } else if (action === 'disable') {
                const unlockedCount = await unlockServer(interaction.guild, interaction.user.tag);
                
                // Response
                const embed = new EmbedBuilder()
                    .setTitle('🔓 Server Lockdown Disabled')
                    .setColor(0x00FF00)
                    .setDescription(`The server lockdown has been lifted.`)
                    .setThumbnail(interaction.guild.iconURL())
                    .addFields(
                        { name: 'Channels Unlocked', value: unlockedCount.toString(), inline: true },
                        { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true }
                    )
                    .setTimestamp();
                
                await interaction.reply({ embeds: [embed] });
            }
        }
        
        else if (interaction.commandName === 'free') {
            // Free command to clear lockdown
            const unlockedCount = await unlockServer(interaction.guild, interaction.user.tag);
            
            // Response
            const embed = new EmbedBuilder()
                .setTitle('🔓 Server Lockdown Cleared')
                .setColor(0x00FF00)
                .setDescription(`The server lockdown has been lifted.`)
                .setThumbnail(interaction.guild.iconURL())
                .addFields(
                    { name: 'Channels Unlocked', value: unlockedCount.toString(), inline: true },
                    { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true }
                )
                .setTimestamp();
            
            await interaction.reply({ embeds: [embed] });
        }
        
        else if (interaction.commandName === 'anti_nuke') {
            const action = interaction.options.getString('action');
            
            if (action === 'status') {
                const settings = await getGuildSettings(interaction.guild.id);
                
                const embed = new EmbedBuilder()
                .setTitle('🛡️ Anti-Nuke System Status')
                .setColor(0x0099FF)
                .setThumbnail(interaction.guild.iconURL())
                .addFields(
                    { name: 'Status', value: settings.antiNukeEnabled ? '✅ Enabled' : '❌ Disabled', inline: true },
                    { name: 'Channel Create Limit', value: settings.maxChannelCreate.toString(), inline: true },
                    { name: 'Channel Delete Limit', value: settings.maxChannelDelete.toString(), inline: true },
                    { name: 'Role Create Limit', value: settings.maxRoleCreate.toString(), inline: true },
                    { name: 'Role Delete Limit', value: settings.maxRoleDelete.toString(), inline: true },
                    { name: 'Ban Limit', value: settings.maxBanAdd.toString(), inline: true }
                )
                .setTimestamp();
                
                await interaction.reply({ embeds: [embed] });
            } else if (action === 'enable') {
                const settings = await getGuildSettings(interaction.guild.id);
                settings.antiNukeEnabled = true;
                await settings.save();
                
                await interaction.reply({ 
                    content: '✅ Anti-Nuke system has been enabled.', 
                    ephemeral: true 
                });
                
                await logAction(
                    interaction.guild,
                    'HIGH',
                    '🛡️ Anti-Nuke System Enabled',
                    `The anti-nuke system has been enabled by <@${interaction.user.id}>.`
                );
            } else if (action === 'disable') {
                const settings = await getGuildSettings(interaction.guild.id);
                settings.antiNukeEnabled = false;
                await settings.save();
                
                await interaction.reply({ 
                    content: '❌ Anti-Nuke system has been disabled.', 
                    ephemeral: true 
                });
                
                await logAction(
                    interaction.guild,
                    'HIGH',
                    '🛡️ Anti-Nuke System Disabled',
                    `The anti-nuke system has been disabled by <@${interaction.user.id}>.`
                );
            } else if (action === 'configure') {
                const type = interaction.options.getString('type');
                const value = interaction.options.getInteger('value');
                
                const settings = await getGuildSettings(interaction.guild.id);
                
                let fieldName = '';
                switch (type) {
                    case 'channel_create':
                        settings.maxChannelCreate = value;
                        fieldName = 'Channel Creation';
                        break;
                    case 'channel_delete':
                        settings.maxChannelDelete = value;
                        fieldName = 'Channel Deletion';
                        break;
                    case 'role_create':
                        settings.maxRoleCreate = value;
                        fieldName = 'Role Creation';
                        break;
                    case 'role_delete':
                        settings.maxRoleDelete = value;
                        fieldName = 'Role Deletion';
                        break;
                    case 'ban_add':
                        settings.maxBanAdd = value;
                        fieldName = 'User Ban';
                        break;
                }
                
                await settings.save();
                
                await interaction.reply({ 
                    content: `✅ ${fieldName} limit has been set to ${value} actions per 10 seconds.`, 
                    ephemeral: true 
                });
                
                await logAction(
                    interaction.guild,
                    'MEDIUM',
                    '⚙️ Anti-Nuke Configuration Updated',
                    `${fieldName} limit has been set to ${value} actions per 10 seconds.`,
                    [
                        { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
                        { name: 'Limit Type', value: fieldName, inline: true },
                        { name: 'New Value', value: value.toString(), inline: true }
                    ]
                );
            }
        }
    } catch (error) {
        console.error('Error handling interaction:', error);
        await interaction.reply({ 
            content: '❌ An error occurred while executing this command.', 
            ephemeral: true 
        });
    }
});

// Event: Button Interactions (Ticket System)
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    
    try {
        // Ticket creation buttons
        if (interaction.customId.startsWith('ticket_')) {
            const ticketType = interaction.customId.split('_')[1];
            let typeName = '';
            
            switch (ticketType) {
                case 'general': typeName = 'General Support'; break;
                case 'apply': typeName = 'Team Apply'; break;
                case 'ally': typeName = 'Ally/Merge'; break;
            }
            
            // Check if user already has an open ticket
            const existingTicket = await Tickets.findOne({ 
                creator: interaction.user.id, 
                closed: false 
            });
            
            if (existingTicket) {
                await interaction.reply({ 
                    content: `❌ You already have an open ticket: <#${existingTicket.channelId}>`, 
                    ephemeral: true 
                });
                return;
            }
            
            // Create ticket channel
            const ticketId = generateTicketId();
            
            // Build permission overwrites safely
            const permissionOverwrites = [
                {
                    id: interaction.guild.id,
                    deny: [PermissionFlagsBits.ViewChannel]
                },
                {
                    id: interaction.user.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles]
                }
            ];
            
            // Add GOD_MODE_USER_ID if it exists and is a valid user
            if (GOD_MODE_USER_ID) {
                try {
                    const godUser = await interaction.guild.members.fetch(GOD_MODE_USER_ID);
                    if (godUser) {
                        permissionOverwrites.push({
                            id: GOD_MODE_USER_ID,
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ManageChannels]
                        });
                    }
                } catch (error) {
                    console.log('GOD_MODE_USER_ID not found in guild, skipping...');
                }
            }
            
            // Add roles only if they exist in the guild
            if (TICKET_VIEWER_ROLE_ID) {
                try {
                    const viewerRole = await interaction.guild.roles.fetch(TICKET_VIEWER_ROLE_ID);
                    if (viewerRole) {
                        permissionOverwrites.push({
                            id: TICKET_VIEWER_ROLE_ID,
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles]
                        });
                    }
                } catch (error) {
                    console.log('TICKET_VIEWER_ROLE_ID not found in guild, skipping...');
                }
            }
            
            if (SPECIAL_ROLE_ID) {
                try {
                    const specialRole = await interaction.guild.roles.fetch(SPECIAL_ROLE_ID);
                    if (specialRole) {
                        permissionOverwrites.push({
                            id: SPECIAL_ROLE_ID,
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles]
                        });
                    }
                } catch (error) {
                    console.log('SPECIAL_ROLE_ID not found in guild, skipping...');
                }
            }
            
            const ticketChannel = await interaction.guild.channels.create({
                name: `ticket-${ticketId}`,
                type: ChannelType.GuildText,
                parent: interaction.channel.parentId,
                permissionOverwrites: permissionOverwrites
            });
            
            // Create ticket record
            const ticket = new Tickets({
                channelId: ticketChannel.id,
                creator: interaction.user.id,
                type: typeName
            });
            await ticket.save();
            
            // Create ticket embed
            const ticketEmbed = new EmbedBuilder()
                .setTitle(`🎫 ${typeName} Ticket`)
                .setColor(0x0099FF)
                .setDescription(`Thank you for creating a ticket! Support staff will be with you shortly.\n\n**Ticket ID:** ${ticketId}\n**Type:** ${typeName}\n**Status:** 🟢 Open`)
                .addFields(
                    { name: 'User', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'Created', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
                )
                .setFooter({ text: 'Team Jupiter Support', iconURL: interaction.guild.iconURL() })
                .setTimestamp();
            
            // Create action buttons
            const ticketButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`ticket_claim_${ticketChannel.id}`)
                        .setLabel('Claim')
                        .setEmoji('✅')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`ticket_lock_${ticketChannel.id}`)
                        .setLabel('Lock')
                        .setEmoji('🔒')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId(`ticket_close_${ticketChannel.id}`)
                        .setLabel('Delete')
                        .setEmoji('🗑️')
                        .setStyle(ButtonStyle.Danger)
                );
            
            // Send initial message and ping support
            let pingContent = `<@${interaction.user.id}>`;
            
            if (TICKET_VIEWER_ROLE_ID) {
                try {
                    const viewerRole = await interaction.guild.roles.fetch(TICKET_VIEWER_ROLE_ID);
                    if (viewerRole) {
                        pingContent += ` <@&${TICKET_VIEWER_ROLE_ID}>`;
                    }
                } catch (error) {
                    console.log('TICKET_VIEWER_ROLE_ID not found for ping, skipping...');
                }
            }
            
            if (SPECIAL_ROLE_ID) {
                try {
                    const specialRole = await interaction.guild.roles.fetch(SPECIAL_ROLE_ID);
                    if (specialRole) {
                        pingContent += ` <@&${SPECIAL_ROLE_ID}>`;
                    }
                } catch (error) {
                    console.log('SPECIAL_ROLE_ID not found for ping, skipping...');
                }
            }
            
            await ticketChannel.send({
                content: pingContent,
                embeds: [ticketEmbed],
                components: [ticketButtons]
            });
            
            // Reply to button interaction
            await interaction.reply({ 
                content: `✅ Your ticket has been created: ${ticketChannel}`, 
                ephemeral: true 
            });
            
            // Log ticket creation
            await logAction(
                interaction.guild,
                'LOW',
                '🎫 Ticket Created',
                `A new ${typeName} ticket has been created.`,
                [
                    { name: 'User', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'Channel', value: `${ticketChannel}`, inline: true },
                    { name: 'Type', value: typeName, inline: true },
                    { name: 'Ticket ID', value: ticketId, inline: true }
                ]
            );
        }
        
        // Ticket management buttons
        else if (interaction.customId.startsWith('ticket_claim_')) {
            const channelId = interaction.customId.split('_')[2];
            const ticket = await Tickets.findOne({ channelId: channelId });
            
            if (!ticket) {
                await interaction.reply({ 
                    content: '❌ Ticket not found.', 
                    ephemeral: true 
                });
                return;
            }
            
            if (ticket.claimedBy) {
                await interaction.reply({ 
                    content: `❌ This ticket is already claimed by <@${ticket.claimedBy}>.`, 
                    ephemeral: true 
                });
                return;
            }
            
            // Claim the ticket
            ticket.claimedBy = interaction.user.id;
            await ticket.save();
            
            // Update channel name
            const channel = interaction.guild.channels.cache.get(channelId);
            if (channel) {
                await channel.setName(`✅ ${channel.name}`);
            }
            
            // Update the ticket message
            const messages = await channel.messages.fetch();
            const ticketMessage = messages.find(m => m.embeds.length > 0 && m.embeds[0].title.includes('Ticket'));
            
            if (ticketMessage) {
                const embed = ticketMessage.embeds[0];
                const newEmbed = EmbedBuilder.from(embed)
                    .setDescription(embed.description.replace('🟢 Open', '🟡 Claimed'))
                    .addFields([{ name: 'Claimed By', value: `<@${interaction.user.id}>`, inline: true }]);
                
                await ticketMessage.edit({ embeds: [newEmbed] });
            }
            
            await interaction.reply({ 
                content: `✅ You have claimed this ticket.`, 
                ephemeral: true 
            });
            
            // Log ticket claim
            await logAction(
                interaction.guild,
                'LOW',
                '✅ Ticket Claimed',
                `A ticket has been claimed by <@${interaction.user.id}>.`,
                [
                    { name: 'Ticket', value: `<#${channelId}>`, inline: true },
                    { name: 'Claimed By', value: `<@${interaction.user.id}>`, inline: true }
                ]
            );
        }
        
        else if (interaction.customId.startsWith('ticket_lock_')) {
            const channelId = interaction.customId.split('_')[2];
            const ticket = await Tickets.findOne({ channelId: channelId });
            
            if (!ticket) {
                await interaction.reply({ 
                    content: '❌ Ticket not found.', 
                    ephemeral: true 
                });
                return;
            }
            
            if (ticket.locked) {
                // Unlock the ticket
                ticket.locked = false;
                await ticket.save();
                
                // Update permissions
                const channel = interaction.guild.channels.cache.get(channelId);
                if (channel) {
                    await channel.permissionOverwrites.edit(ticket.creator, {
                        SendMessages: true
                    });
                    await channel.setName(channel.name.replace('🔒', ''));
                }
                
                // Update the ticket message
                const messages = await channel.messages.fetch();
                const ticketMessage = messages.find(m => m.embeds.length > 0 && m.embeds[0].title.includes('Ticket'));
                
                if (ticketMessage) {
                    const embed = ticketMessage.embeds[0];
                    let status = ticket.claimedBy ? '🟡 Claimed' : '🟢 Open';
                    const newEmbed = EmbedBuilder.from(embed)
                        .setDescription(embed.description.replace(/🔒 Locked|🟡 Claimed|🟢 Open/, status));
                    
                    await ticketMessage.edit({ embeds: [newEmbed] });
                }
                
                await interaction.reply({ 
                    content: `✅ You have unlocked this ticket.`, 
                    ephemeral: true 
                });
                
                // Log ticket unlock
                await logAction(
                    interaction.guild,
                    'LOW',
                    '🔓 Ticket Unlocked',
                    `A ticket has been unlocked by <@${interaction.user.id}>.`,
                    [
                        { name: 'Ticket', value: `<#${channelId}>`, inline: true },
                        { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true }
                    ]
                );
            } else {
                // Lock the ticket
                ticket.locked = true;
                await ticket.save();
                
                // Update permissions
                const channel = interaction.guild.channels.cache.get(channelId);
                if (channel) {
                    await channel.permissionOverwrites.edit(ticket.creator, {
                        SendMessages: false
                    });
                    await channel.setName(`🔒 ${channel.name}`);
                }
                
                // Update the ticket message
                const messages = await channel.messages.fetch();
                const ticketMessage = messages.find(m => m.embeds.length > 0 && m.embeds[0].title.includes('Ticket'));
                
                if (ticketMessage) {
                    const embed = ticketMessage.embeds[0];
                    const newEmbed = EmbedBuilder.from(embed)
                        .setDescription(embed.description.replace(/🟢 Open|🟡 Claimed/, '🔒 Locked'));
                    
                    await ticketMessage.edit({ embeds: [newEmbed] });
                }
                
                await interaction.reply({ 
                    content: `✅ You have locked this ticket.`, 
                    ephemeral: true 
                });
                
                // Log ticket lock
                await logAction(
                    interaction.guild,
                    'MEDIUM',
                    '🔒 Ticket Locked',
                    `A ticket has been locked by <@${interaction.user.id}>.`,
                    [
                        { name: 'Ticket', value: `<#${channelId}>`, inline: true },
                        { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true }
                    ]
                );
            }
        }
        
        else if (interaction.customId.startsWith('ticket_close_')) {
            const channelId = interaction.customId.split('_')[2];
            const ticket = await Tickets.findOne({ channelId: channelId });
            
            if (!ticket) {
                await interaction.reply({ 
                    content: '❌ Ticket not found.', 
                    ephemeral: true 
                });
                return;
            }
            
            // Create a modal for close reason
            const modal = new ModalBuilder()
                .setCustomId(`ticket_close_modal_${channelId}`)
                .setTitle('Close Ticket');
            
            const reasonInput = new TextInputBuilder()
                .setCustomId('close_reason')
                .setLabel('Reason for closing (optional)')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(false)
                .setMaxLength(500);
            
            const actionRow = new ActionRowBuilder().addComponents(reasonInput);
            modal.addComponents(actionRow);
            
            await interaction.showModal(modal);
        }
    } catch (error) {
        console.error('Error handling button interaction:', error);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ 
                content: '❌ An error occurred while processing this action.', 
                ephemeral: true 
            });
        } else {
            await interaction.reply({ 
                content: '❌ An error occurred while processing this action.', 
                ephemeral: true 
            });
        }
    }
});

// Event: Modal Interactions
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isModalSubmit()) return;
    
    try {
        if (interaction.customId.startsWith('ticket_close_modal_')) {
            const channelId = interaction.customId.split('_')[3];
            const reason = interaction.fields.getTextInputValue('close_reason') || 'No reason provided';
            
            const ticket = await Tickets.findOne({ channelId: channelId });
            if (!ticket) {
                await interaction.reply({ 
                    content: '❌ Ticket not found.', 
                    ephemeral: true 
                });
                return;
            }
            
            // Close the ticket
            ticket.closed = true;
            ticket.closedAt = new Date();
            await ticket.save();
            
            // Create transcript
            const channel = interaction.guild.channels.cache.get(channelId);
            if (channel) {
                const messages = await channel.messages.fetch();
                let transcript = `Team Jupiter Ticket Transcript\n`;
                transcript += `Ticket ID: ${ticket._id}\n`;
                transcript += `Type: ${ticket.type}\n`;
                transcript += `Creator: ${ticket.creator} (${interaction.guild.members.cache.get(ticket.creator)?.user.tag || 'Unknown'})\n`;
                transcript += `Created: ${ticket.createdAt}\n`;
                transcript += `Closed: ${ticket.closedAt}\n`;
                transcript += `Closed By: ${interaction.user.id} (${interaction.user.tag})\n`;
                transcript += `Close Reason: ${reason}\n`;
                transcript += `Claimed By: ${ticket.claimedBy || 'None'}\n`;
                transcript += `Locked: ${ticket.locked}\n\n`;
                transcript += `Messages:\n${'='.repeat(50)}\n\n`;
                
                // Sort messages by timestamp
                const sortedMessages = Array.from(messages.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
                
                for (const message of sortedMessages) {
                    if (message.author.bot && message.embeds.length > 0) continue; // Skip bot embeds
                    
                    transcript += `[${message.createdAt.toLocaleString()}] ${message.author.tag} (${message.author.id}): ${message.content}\n`;
                    
                    // Add attachments if any
                    if (message.attachments.size > 0) {
                        transcript += `Attachments: ${Array.from(message.attachments.values()).map(a => a.url).join(', ')}\n`;
                    }
                    
                    transcript += '\n';
                }
                
                // Send transcript to user
                try {
                    const user = await client.users.fetch(ticket.creator);
                    await user.send({
                        content: 'Here is the transcript of your closed ticket:',
                        files: [{
                            attachment: Buffer.from(transcript),
                            name: `ticket-${ticket._id}.txt`
                        }]
                    });
                } catch (error) {
                    console.error('Error sending transcript to user:', error);
                    // Will send to log channel instead
                }
                
                // Send transcript to log channel
                const settings = await getGuildSettings(interaction.guild.id);
                if (settings.logChannelId) {
                    const logChannel = interaction.guild.channels.cache.get(settings.logChannelId);
                    if (logChannel) {
                        await logChannel.send({
                            content: `Transcript for ticket ${ticket._id} (${ticket.type})`,
                            files: [{
                                attachment: Buffer.from(transcript),
                                name: `ticket-${ticket._id}.txt`
                            }]
                        });
                    }
                }
                
                // Delete the channel
                await channel.delete('Ticket closed');
            }
            
            await interaction.reply({ 
                content: `✅ You have closed this ticket.`, 
                ephemeral: true 
            });
            
            // Log ticket closure
            await logAction(
                interaction.guild,
                'LOW',
                '🗑️ Ticket Closed',
                `A ticket has been closed by <@${interaction.user.id}>.`,
                [
                    { name: 'Ticket ID', value: ticket._id.toString(), inline: true },
                    { name: 'Type', value: ticket.type, inline: true },
                    { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'Reason', value: reason, inline: false }
                ]
            );
        }
    } catch (error) {
        console.error('Error handling modal interaction:', error);
        await interaction.reply({ 
            content: '❌ An error occurred while processing this action.', 
            ephemeral: true 
        });
    }
});

// Event: Message Create (Rate Limiting)
client.on('messageCreate', async (message) => {
    // Ignore bots and whitelisted users
    if (message.author.bot || await isWhitelisted(message.author.id)) return;
    
    // Rate limiting for messages
    const now = Date.now();
    const cooldownAmount = 10000; // 10 seconds
    
    if (!userMessageCount.has(message.author.id)) {
        userMessageCount.set(message.author.id, [now]);
    } else {
        const timestamps = userMessageCount.get(message.author.id);
        const validTimestamps = timestamps.filter(timestamp => now - timestamp < cooldownAmount);
        
        if (validTimestamps.length >= 8) {
            // Delete messages and warn user
            try {
                await message.delete();
                await message.channel.send({
                    content: `❌ <@${message.author.id}>, you are sending messages too quickly. Please slow down.`,
                    deleteAfter: 5000
                });
                
                await logAction(
                    message.guild,
                    'MEDIUM',
                    '⚠️ Rate Limit Exceeded',
                    `<@${message.author.id}> was rate limited for sending too many messages.`,
                    [
                        { name: 'User', value: `<@${message.author.id}> (${message.author.id})`, inline: true },
                        { name: 'Channel', value: `${message.channel}`, inline: true }
                    ]
                );
            } catch (error) {
                console.error('Error handling rate limit:', error);
            }
            return;
        }
        
        validTimestamps.push(now);
        userMessageCount.set(message.author.id, validTimestamps);
    }
});

// Event: Audit Log Entry Create - Only log specific actions
client.on('guildAuditLogEntryCreate', async (auditLogEntry, guild) => {
    try {
        // Only log specific action types
        const actionTypesToLog = [
            AuditLogEvent.ChannelCreate,
            AuditLogEvent.ChannelDelete,
            AuditLogEvent.RoleCreate,
            AuditLogEvent.RoleDelete,
            AuditLogEvent.MemberBanAdd,
            AuditLogEvent.MemberBanRemove,
            AuditLogEvent.MemberKick,
            AuditLogEvent.MemberUpdate,
            AuditLogEvent.MemberRoleUpdate
        ];
        
        if (!actionTypesToLog.includes(auditLogEntry.action)) {
            return; // Skip logging for this action type
        }
        
        await logAuditAction(guild, auditLogEntry);
    } catch (error) {
        console.error('Error handling audit log entry:', error);
    }
});

// Register Slash Commands
client.on(Events.ClientReady, async () => {
    try {
        // Register commands for your specific guild for faster updates
        const guild = client.guilds.cache.get('1414523813345099828');
        if (!guild) {
            console.error('Guild not found!');
            return;
        }
        
        await guild.commands.set([
            {
                name: 'whitelist',
                description: 'Add a user to the whitelist (God-mode only)',
                options: [
                    {
                        name: 'user',
                        type: 6, // USER
                        description: 'The user to whitelist',
                        required: true
                    },
                    {
                        name: 'reason',
                        type: 3, // STRING
                        description: 'Reason for whitelisting',
                        required: false
                    }
                ]
            },
            {
                name: 'unwhitelist',
                description: 'Remove a user from the whitelist (God-mode only)',
                options: [
                    {
                        name: 'user',
                        type: 6, // USER
                        description: 'The user to unwhitelist',
                        required: true
                    }
                ]
            },
            {
                name: 'setup_welcome',
                description: 'Set the welcome channel',
                options: [
                    {
                        name: 'channel',
                        type: 7, // CHANNEL
                        description: 'The channel for welcome messages',
                        required: true,
                        channel_types: [0] // TEXT_CHANNEL
                    }
                ]
            },
            {
                name: 'setup_logs',
                description: 'Set the log channel',
                options: [
                    {
                        name: 'channel',
                        type: 7, // CHANNEL
                        description: 'The channel for logging',
                        required: true,
                        channel_types: [0] // TEXT_CHANNEL
                    }
                ]
            },
            {
                name: 'setup_tickets',
                description: 'Set up the ticket system',
                options: [
                    {
                        name: 'channel',
                        type: 7, // CHANNEL
                        description: 'The channel for the ticket panel',
                        required: true,
                        channel_types: [0] // TEXT_CHANNEL
                    }
                ]
            },
            {
                name: 'test_welcome',
                description: 'Test the welcome message'
            },
            {
                name: 'warn',
                description: 'Warn a user',
                options: [
                    {
                        name: 'user',
                        type: 6, // USER
                        description: 'The user to warn',
                        required: true
                    },
                    {
                        name: 'reason',
                        type: 3, // STRING
                        description: 'The reason for the warning',
                        required: false
                    },
                    {
                        name: 'severity',
                        type: 3, // STRING
                        description: 'Severity of the warning',
                        required: false,
                        choices: [
                            { name: 'Low', value: 'LOW' },
                            { name: 'Medium', value: 'MEDIUM' },
                            { name: 'High', value: 'HIGH' }
                        ]
                    }
                ]
            },
            {
                name: 'view_warnings',
                description: 'View warnings for a user',
                options: [
                    {
                        name: 'user',
                        type: 6, // USER
                        description: 'The user to view warnings for',
                        required: true
                    }
                ]
            },
            {
                name: 'security_status',
                description: 'View the security status of the server'
            },
            {
                name: 'lockdown',
                description: 'Lockdown the server',
                options: [
                    {
                        name: 'action',
                        type: 3, // STRING
                        description: 'The action to perform',
                        required: true,
                        choices: [
                            { name: 'Enable', value: 'enable' },
                            { name: 'Disable', value: 'disable' }
                        ]
                    },
                    {
                        name: 'duration',
                        type: 3, // STRING
                        description: 'Duration of lockdown (e.g., 10m, 1h)',
                        required: false
                    }
                ]
            },
            {
                name: 'free',
                description: 'Clear server lockdown'
            },
            {
                name: 'anti_nuke',
                description: 'Configure anti-nuke settings',
                options: [
                    {
                        name: 'action',
                        type: 3, // STRING
                        description: 'The action to perform',
                        required: true,
                        choices: [
                            { name: 'Status', value: 'status' },
                            { name: 'Enable', value: 'enable' },
                            { name: 'Disable', value: 'disable' }
                        ]
                    },
                    {
                        name: 'type',
                        type: 3, // STRING
                        description: 'Type of action to configure',
                        required: false,
                        choices: [
                            { name: 'Channel Create', value: 'channel_create' },
                            { name: 'Channel Delete', value: 'channel_delete' },
                            { name: 'Role Create', value: 'role_create' },
                            { name: 'Role Delete', value: 'role_delete' },
                            { name: 'Ban Add', value: 'ban_add' }
                        ]
                    },
                    {
                        name: 'value',
                        type: 4, // INTEGER
                        description: 'New value for the limit',
                        required: false
                    }
                ]
            }
        ]);
        
        console.log('Slash commands registered for guild!');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN);
