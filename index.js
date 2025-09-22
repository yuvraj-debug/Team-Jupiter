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
    maxKickAdd: { type: Number, default: 3 },
    maxEveryonePing: { type: Number, default: 1 },
    lockdownMode: { type: Boolean, default: false },
    autoRecovery: { type: Boolean, default: true },
    maxTicketsPerUser: { type: Number, default: 3 } // Allow multiple tickets per user
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

// Immune Users Schema
const immuneSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    addedBy: { type: String, required: true },
    reason: String,
    timestamp: { type: Date, default: Date.now },
    expiresAt: Date
});
const Immune = mongoose.model('Immune', immuneSchema);

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
    kickAdd: new Map(),
    everyonePing: new Map()
};

// Cache for channel/role backups
const serverStateCache = {
    channels: new Map(),
    roles: new Map(),
    emojis: new Map(),
    webhooks: new Map()
};

// Rate limiting for commands and messages
const userCommandUsage = new Map();
const userMessageCount = new Map();

// Constants
const GOD_MODE_USER_ID = process.env.GOD_MODE_USER_ID || '1202998273376522321';
const TICKET_VIEWER_ROLE_ID = process.env.TICKET_VIEWER_ROLE_ID;
const SPECIAL_ROLE_ID = process.env.SPECIAL_ROLE_ID || '1414824820901679155';
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
const ALERT_USER_ID = '1202998273376522331'; // User to ping for critical actions

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

async function isImmune(userId) {
    const immune = await Immune.findOne({ userId: userId });
    if (!immune) return false;
    
    // Check if immunity has expired
    if (immune.expiresAt && immune.expiresAt < new Date()) {
        await Immune.deleteOne({ userId: userId });
        return false;
    }
    
    return true;
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

        let content = ping ? `<@${ALERT_USER_ID}>` : '';
        if (ping && level === 'CRITICAL') {
            content += ' @everyone';
        }
        
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

async function backupServerState(guild) {
    try {
        // Backup channels
        guild.channels.cache.forEach(channel => {
            serverStateCache.channels.set(channel.id, {
                id: channel.id,
                name: channel.name,
                type: channel.type,
                parent: channel.parentId,
                position: channel.position,
                permissionOverwrites: channel.permissionOverwrites.cache.map(overwrite => ({
                    id: overwrite.id,
                    type: overwrite.type,
                    allow: overwrite.allow.bitfield,
                    deny: overwrite.deny.bitfield
                })),
                topic: channel.topic,
                nsfw: channel.nsfw,
                rateLimitPerUser: channel.rateLimitPerUser,
                bitrate: channel.bitrate,
                userLimit: channel.userLimit,
                rtcRegion: channel.rtcRegion,
                videoQualityMode: channel.videoQualityMode
            });
        });

        // Backup roles
        guild.roles.cache.forEach(role => {
            if (role.id === guild.id) return; // Skip @everyone role
            serverStateCache.roles.set(role.id, {
                id: role.id,
                name: role.name,
                color: role.color,
                hoist: role.hoist,
                position: role.position,
                permissions: role.permissions.bitfield,
                mentionable: role.mentionable,
                icon: role.icon,
                unicodeEmoji: role.unicodeEmoji
            });
        });

        // Backup emojis
        guild.emojis.cache.forEach(emoji => {
            serverStateCache.emojis.set(emoji.id, {
                id: emoji.id,
                name: emoji.name,
                animated: emoji.animated,
                url: emoji.imageURL()
            });
        });

        // Backup webhooks
        const webhooks = await guild.fetchWebhooks();
        webhooks.forEach(webhook => {
            serverStateCache.webhooks.set(webhook.id, {
                id: webhook.id,
                name: webhook.name,
                channelId: webhook.channelId,
                avatar: webhook.avatar,
                token: webhook.token
            });
        });

        console.log(`Server state backed up for ${guild.name}`);
    } catch (error) {
        console.error('Error backing up server state:', error);
    }
}

async function restoreChannels(guild, channelIds) {
    const restoredChannels = [];
    for (const channelId of channelIds) {
        const backup = serverStateCache.channels.get(channelId);
        if (!backup) continue;

        try {
            const existingChannel = guild.channels.cache.get(channelId);
            if (existingChannel) continue; // Channel already exists

            const options = {
                name: backup.name,
                type: backup.type,
                parent: backup.parent,
                position: backup.position,
                topic: backup.topic,
                nsfw: backup.nsfw,
                rateLimitPerUser: backup.rateLimitPerUser,
                permissionOverwrites: backup.permissionOverwrites,
                bitrate: backup.bitrate,
                userLimit: backup.userLimit,
                rtcRegion: backup.rtcRegion,
                videoQualityMode: backup.videoQualityMode
            };

            const newChannel = await guild.channels.create(options);
            restoredChannels.push(newChannel);
        } catch (error) {
            console.error(`Error restoring channel ${channelId}:`, error);
        }
    }
    return restoredChannels;
}

async function restoreRoles(guild, roleIds) {
    const restoredRoles = [];
    for (const roleId of roleIds) {
        const backup = serverStateCache.roles.get(roleId);
        if (!backup) continue;

        try {
            const existingRole = guild.roles.cache.get(roleId);
            if (existingRole) continue; // Role already exists

            const options = {
                name: backup.name,
                color: backup.color,
                hoist: backup.hoist,
                position: backup.position,
                permissions: backup.permissions,
                mentionable: backup.mentionable,
                icon: backup.icon,
                unicodeEmoji: backup.unicodeEmoji
            };

            const newRole = await guild.roles.create(options);
            restoredRoles.push(newRole);
        } catch (error) {
            console.error(`Error restoring role ${roleId}:`, error);
        }
    }
    return restoredRoles;
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
            // Skip if user is whitelisted or immune
            if (await isWhitelisted(entry.executor.id) || await isImmune(entry.executor.id)) continue;
            
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
                        maxActions = settings.maxKickAdd;
                        actionName = 'User Kick';
                        break;
                }
                
                // Get or create user's action record
                if (!actionMap.has(executorId)) {
                    actionMap.set(executorId, { count: 1, timestamp: now, targets: [entry.targetId] });
                } else {
                    const record = actionMap.get(executorId);
                    
                    // Reset if more than 5 seconds have passed
                    if (now - record.timestamp > 5000) {
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
                                
                                // Auto-recovery for deletions if enabled
                                if (settings.autoRecovery) {
                                    if (actionType === AuditLogEvent.ChannelDelete) {
                                        const restoredChannels = await restoreChannels(guild, record.targets);
                                        
                                        await logAction(
                                            guild,
                                            'HIGH',
                                            '🔧 Auto-Recovery: Channels Restored',
                                            `Attempted to restore ${restoredChannels.length} channels deleted by nuke attempt.`
                                        );
                                    }
                                    
                                    if (actionType === AuditLogEvent.RoleDelete) {
                                        const restoredRoles = await restoreRoles(guild, record.targets);
                                        
                                        await logAction(
                                            guild,
                                            'HIGH',
                                            '🔧 Auto-Recovery: Roles Restored',
                                            `Attempted to restore ${restoredRoles.length} roles deleted by nuke attempt.`
                                        );
                                    }
                                    
                                    if (actionType === AuditLogEvent.MemberBanAdd) {
                                        // Unban users
                                        for (const userId of record.targets) {
                                            try {
                                                await guild.members.unban(userId, 'Auto-recovery from nuke attempt');
                                            } catch (error) {
                                                console.error(`Error unbanning user ${userId}:`, error);
                                            }
                                        }
                                        
                                        await logAction(
                                            guild,
                                            'HIGH',
                                            '🔧 Auto-Recovery: Bans Reverted',
                                            `Attempted to unban ${record.targets.length} users banned by nuke attempt.`
                                        );
                                    }
                                }
                                
                                // Enable lockdown mode
                                await lockServer(guild, 'System (Auto)', '30m');
                            } else {
                                // If we can't ban, at least kick the user
                                if (member && member.kickable) {
                                    await member.kick('Auto-kick: Attempted server nuke (ban failed)');
                                    await logAction(
                                        guild, 
                                        'HIGH', 
                                        '⚠️ AUTO-KICK TRIGGERED', 
                                        `User <@${executorId}> was automatically kicked for attempted server nuke (ban failed).`,
                                        [
                                            { name: 'User', value: `<@${executorId}> (${executorId})`, inline: true },
                                            { name: 'Action Type', value: actionName, inline: true },
                                            { name: 'Count', value: `${record.count}/${maxActions}`, inline: true }
                                        ],
                                        true
                                    );
                                }
                            }
                        } catch (error) {
                            console.error('Error taking action against user:', error);
                            // Log the error but don't let it crash the bot
                            await logAction(
                                guild,
                                'HIGH',
                                '❌ Auto-Action Failed',
                                `Failed to take action against user <@${executorId}> for nuke attempt.`,
                                [
                                    { name: 'Error', value: error.message, inline: false }
                                ]
                            );
                        }
                        
                        // Reset the count after action
                        if (actionMap.has(executorId)) {
                            const record = actionMap.get(executorId);
                            record.count = 0;
                            record.targets = [];
                            actionMap.set(executorId, record);
                        }
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error monitoring audit logs:', error);
    }
}

// Monitor @everyone pings
async function monitorEveryonePings(message) {
    try {
        // Skip if user is whitelisted or immune
        if (await isWhitelisted(message.author.id) || await isImmune(message.author.id)) return;
        
        // Check if message contains @everyone
        if (message.content.includes('@everyone') || message.content.includes('@here')) {
            const settings = await getGuildSettings(message.guild.id);
            const now = Date.now();
            const executorId = message.author.id;
            
            // Track everyone pings
            if (!recentActions.everyonePing.has(executorId)) {
                recentActions.everyonePing.set(executorId, { count: 1, timestamp: now });
            } else {
                const record = recentActions.everyonePing.get(executorId);
                
                // Reset if more than 1 second has passed
                if (now - record.timestamp > 1000) {
                    record.count = 1;
                    record.timestamp = now;
                } else {
                    record.count++;
                }
                
                recentActions.everyonePing.set(executorId, record);
                
                // Check if threshold is exceeded
                if (record.count >= settings.maxEveryonePing) {
                    try {
                        // Delete the message
                        await message.delete();
                        
                        // Timeout the user for 5 minutes
                        const member = await message.guild.members.fetch(executorId);
                        if (member && member.moderatable) {
                            await member.timeout(5 * 60 * 1000, 'Auto-timeout: Excessive @everyone pings');
                            
                            // Log the action
                            await logAction(
                                message.guild,
                                'HIGH',
                                '⏰ User Timed Out',
                                `<@${executorId}> was automatically timed out for excessive @everyone pings.`,
                                [
                                    { name: 'User', value: `<@${executorId}> (${executorId})`, inline: true },
                                    { name: 'Duration', value: '5 minutes', inline: true },
                                    { name: 'Message', value: message.content.slice(0, 100) + '...', inline: false }
                                ],
                                true
                            );
                        }
                    } catch (error) {
                        console.error('Error timing out user:', error);
                    }
                    
                    // Reset the count after action
                    if (recentActions.everyonePing.has(executorId)) {
                        const record = recentActions.everyonePing.get(executorId);
                        record.count = 0;
                        recentActions.everyonePing.set(executorId, record);
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error monitoring @everyone pings:', error);
    }
}

// Event: Ready
client.once('clientReady', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    
    // Set activity status
    client.user.setActivity('Team Jupiter', { type: 'WATCHING' });
    
    // Backup server state for all guilds
    client.guilds.cache.forEach(guild => {
        backupServerState(guild);
    });
    
    // Start monitoring audit logs
    setInterval(() => {
        client.guilds.cache.forEach(guild => {
            monitorAuditLogs(guild);
        });
    }, 2000); // Check every 2 seconds
    
    // Clean up expired immunity records
    setInterval(async () => {
        try {
            const result = await Immune.deleteMany({ 
                expiresAt: { $lt: new Date() } 
            });
            if (result.deletedCount > 0) {
                console.log(`Cleaned up ${result.deletedCount} expired immunity records`);
            }
        } catch (error) {
            console.error('Error cleaning up expired immunity records:', error);
        }
    }, 3600000); // Run every hour
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

// Event: Message Create (Rate Limiting and @everyone monitoring)
client.on('messageCreate', async (message) => {
    // Ignore bots and DMs
    if (message.author.bot || !message.guild) return;
    
    // Check if user is whitelisted
    if (await isWhitelisted(message.author.id)) return;
    
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
    
    // Monitor @everyone pings
    await monitorEveryonePings(message);
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
            
            // Check if user is immune to warnings
            if (await isImmune(user.id)) {
                await interaction.reply({ 
                    content: `❌ <@${user.id}> is immune to warnings.`, 
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
                    if (member && member.kickable) {
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
            const immuneCount = await Immune.countDocuments();
            const securityLogCount = await SecurityLog.countDocuments({ guildId: interaction.guild.id });
            
            const settings = await getGuildSettings(interaction.guild.id);
            
            // Create status embed
            const embed = new EmbedBuilder()
                .setTitle('🛡️ Team Jupiter Security Status')
                .setColor(0x0099FF)
                .setThumbnail(interaction.guild.iconURL())
                .addFields(
                    { name: 'Anti-Nuke Protection', value: settings.antiNukeEnabled ? '✅ Active' : '❌ Disabled', inline: true },
                    { name: 'Auto-Recovery System', value: settings.autoRecovery ? '✅ Active' : '❌ Disabled', inline: true },
                    { name: 'Rate Limiting', value: '✅ Active', inline: true },
                    { name: 'Whitelisted Users', value: whitelistCount.toString(), inline: true },
                    { name: 'Total Warnings', value: warningCount.toString(), inline: true },
                    { name: 'Immune Users', value: immuneCount.toString(), inline: true },
                    { name: 'Security Logs', value: securityLogCount.toString(), inline: true },
                    { name: 'Lockdown Mode', value: settings.lockdownMode ? '🔒 Active' : '🔓 Inactive', inline: true },
                    { name: 'Ticket System', value: settings.ticketChannelId ? '✅ Active' : '❌ Not Setup', inline: true },
                    { name: 'Welcome System', value: settings.welcomeChannelId ? '✅ Active' : '❌ Not Setup', inline: true },
                    { name: 'Channel Create Limit', value: settings.maxChannelCreate.toString(), inline: true },
                    { name: 'Channel Delete Limit', value: settings.maxChannelDelete.toString(), inline: true },
                    { name: 'Role Create Limit', value: settings.maxRoleCreate.toString(), inline: true },
                    { name: 'Role Delete Limit', value: settings.maxRoleDelete.toString(), inline: true },
                    { name: 'Ban Limit', value: settings.maxBanAdd.toString(), inline: true },
                    { name: 'Kick Limit', value: settings.maxKickAdd.toString(), inline: true },
                    { name: '@everyone Limit', value: settings.maxEveryonePing.toString(), inline: true }
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
                        { name: 'Auto-Recovery', value: settings.autoRecovery ? '✅ Enabled' : '❌ Disabled', inline: true },
                        { name: 'Channel Create Limit', value: settings.maxChannelCreate.toString(), inline: true },
                        { name: 'Channel Delete Limit', value: settings.maxChannelDelete.toString(), inline: true },
                        { name: 'Role Create Limit', value: settings.maxRoleCreate.toString(), inline: true },
                        { name: 'Role Delete Limit', value: settings.maxRoleDelete.toString(), inline: true },
                        { name: 'Ban Limit', value: settings.maxBanAdd.toString(), inline: true },
                        { name: 'Kick Limit', value: settings.maxKickAdd.toString(), inline: true },
                        { name: '@everyone Limit', value: settings.maxEveryonePing.toString(), inline: true }
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
                    case 'kick_add':
                        settings.maxKickAdd = value;
                        fieldName = 'User Kick';
                        break;
                    case 'everyone_ping':
                        settings.maxEveryonePing = value;
                        fieldName = '@everyone Ping';
                        break;
                }
                
                await settings.save();
                
                await interaction.reply({ 
                    content: `✅ ${fieldName} limit has been set to ${value} actions per 5 seconds.`, 
                    ephemeral: true 
                });
                
                await logAction(
                    interaction.guild,
                    'MEDIUM',
                    '⚙️ Anti-Nuke Configuration Updated',
                    `${fieldName} limit has been set to ${value} actions per 5 seconds.`,
                    [
                        { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
                        { name: 'Limit Type', value: fieldName, inline: true },
                        { name: 'New Value', value: value.toString(), inline: true }
                    ]
                );
            } else if (action === 'auto_recovery') {
                const enable = interaction.options.getBoolean('enable');
                
                const settings = await getGuildSettings(interaction.guild.id);
                settings.autoRecovery = enable;
                await settings.save();
                
                await interaction.reply({ 
                    content: `✅ Auto-recovery has been ${enable ? 'enabled' : 'disabled'}.`, 
                    ephemeral: true 
                });
                
                await logAction(
                    interaction.guild,
                    'MEDIUM',
                    '⚙️ Auto-Recovery Configuration Updated',
                    `Auto-recovery has been ${enable ? 'enabled' : 'disabled'} by <@${interaction.user.id}>.`
                );
            }
        }
        
        else if (interaction.commandName === 'backup') {
            await backupServerState(interaction.guild);
            
            const embed = new EmbedBuilder()
                .setTitle('✅ Server Backup Completed')
                .setColor(0x00FF00)
                .setDescription('Server state has been successfully backed up.')
                .setThumbnail(interaction.guild.iconURL())
                .addFields(
                    { name: 'Channels Backed Up', value: serverStateCache.channels.size.toString(), inline: true },
                    { name: 'Roles Backed Up', value: serverStateCache.roles.size.toString(), inline: true },
                    { name: 'Emojis Backed Up', value: serverStateCache.emojis.size.toString(), inline: true },
                    { name: 'Backup Time', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
                )
                .setTimestamp();
            
            await interaction.reply({ embeds: [embed] });
            
            await logAction(
                interaction.guild,
                'LOW',
                '💾 Server Backup Created',
                `Server state has been backed up by <@${interaction.user.id}>.`,
                [
                    { name: 'Channels', value: serverStateCache.channels.size.toString(), inline: true },
                    { name: 'Roles', value: serverStateCache.roles.size.toString(), inline: true },
                    { name: 'Emojis', value: serverStateCache.emojis.size.toString(), inline: true },
                    { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true }
                ]
            );
        }
        
        else if (interaction.commandName === 'immune') {
            const action = interaction.options.getString('action');
            const user = interaction.options.getUser('user');
            
            if (action === 'add') {
                const reason = interaction.options.getString('reason') || 'No reason provided';
                const duration = interaction.options.getString('duration');
                
                // Check if already immune
                const existing = await Immune.findOne({ userId: user.id });
                if (existing) {
                    await interaction.reply({ 
                        content: `❌ <@${user.id}> is already immune.`, 
                        ephemeral: true 
                    });
                    return;
                }
                
                // Calculate expiration date if duration is provided
                let expiresAt = null;
                if (duration) {
                    const now = new Date();
                    if (duration.endsWith('d')) {
                        const days = parseInt(duration);
                        expiresAt = new Date(now.setDate(now.getDate() + days));
                    } else if (duration.endsWith('h')) {
                        const hours = parseInt(duration);
                        expiresAt = new Date(now.setHours(now.getHours() + hours));
                    }
                }
                
                // Add to immune list
                const immuneEntry = new Immune({
                    userId: user.id,
                    addedBy: interaction.user.id,
                    reason: reason,
                    expiresAt: expiresAt
                });
                await immuneEntry.save();
                
                // Success response
                const embed = new EmbedBuilder()
                    .setTitle('✅ User Immunity Granted')
                    .setColor(0x00FF00)
                    .setThumbnail(user.displayAvatarURL())
                    .addFields(
                        { name: 'User', value: `<@${user.id}> (${user.id})`, inline: true },
                        { name: 'Added By', value: `<@${interaction.user.id}>`, inline: true },
                        { name: 'Reason', value: reason, inline: false },
                        { name: 'Expires', value: expiresAt ? `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>` : 'Never', inline: true }
                    )
                    .setTimestamp();
                
                await interaction.reply({ embeds: [embed] });
                
                // Log the action
                await logAction(
                    interaction.guild,
                    'HIGH',
                    '🛡️ User Immunity Granted',
                    `<@${user.id}> has been granted immunity.`,
                    [
                        { name: 'User', value: `<@${user.id}> (${user.id})`, inline: true },
                        { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
                        { name: 'Reason', value: reason, inline: false },
                        { name: 'Expires', value: expiresAt ? `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>` : 'Never', inline: true }
                    ]
                );
            } else if (action === 'remove') {
                // Check if user is immune
                const existing = await Immune.findOne({ userId: user.id });
                if (!existing) {
                    await interaction.reply({ 
                        content: `❌ <@${user.id}> is not immune.`, 
                        ephemeral: true 
                    });
                    return;
                }
                
                // Remove from immune list
                await Immune.deleteOne({ userId: user.id });
                
                // Success response
                const embed = new EmbedBuilder()
                    .setTitle('❌ User Immunity Revoked')
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
                    '🛡️ User Immunity Revoked',
                    `<@${user.id}> has been removed from the immune list.`,
                    [
                        { name: 'User', value: `<@${user.id}> (${user.id})`, inline: true },
                        { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true }
                    ]
                );
            } else if (action === 'list') {
                const immuneUsers = await Immune.find({});
                
                if (immuneUsers.length === 0) {
                    await interaction.reply({ 
                        content: '❌ No users have immunity.', 
                        ephemeral: true 
                    });
                    return;
                }
                
                const embed = new EmbedBuilder()
                    .setTitle('🛡️ Immune Users')
                    .setColor(0x0099FF)
                    .setThumbnail(interaction.guild.iconURL());
                
                immuneUsers.forEach(immune => {
                    const user = client.users.cache.get(immune.userId);
                    embed.addFields({
                        name: user ? user.tag : immune.userId,
                        value: `**Added by:** <@${immune.addedBy}>\n**Reason:** ${immune.reason || 'No reason provided'}\n**Expires:** ${immune.expiresAt ? `<t:${Math.floor(immune.expiresAt.getTime() / 1000)}:R>` : 'Never'}`,
                        inline: false
                    });
                });
                
                embed.setFooter({ text: `Total Immune Users: ${immuneUsers.length}` });
                
                await interaction.reply({ embeds: [embed] });
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
            
            // Check if user has too many open tickets
            const settings = await getGuildSettings(interaction.guild.id);
            const openTickets = await Tickets.find({ 
                creator: interaction.user.id, 
                closed: false 
            });
            
            if (openTickets.length >= settings.maxTicketsPerUser) {
                await interaction.reply({ 
                    content: `❌ You already have ${openTickets.length} open tickets. Please close some before creating new ones.`, 
                    ephemeral: true 
                });
                return;
            }
            
            // Create ticket channel
            const ticketId = generateTicketId();
            const ticketChannel = await interaction.guild.channels.create({
                name: `ticket-${ticketId}`,
                type: ChannelType.GuildText,
                parent: interaction.channel.parentId,
                permissionOverwrites: [
                    {
                        id: interaction.guild.id,
                        deny: [PermissionFlagsBits.ViewChannel]
                    },
                    {
                        id: interaction.user.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles]
                    },
                    {
                        id: TICKET_VIEWER_ROLE_ID,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles]
                    },
                    {
                        id: SPECIAL_ROLE_ID,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles]
                    },
                    {
                        id: GOD_MODE_USER_ID,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ManageChannels]
                    }
                ]
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
            await ticketChannel.send({
                content: `<@${interaction.user.id}> <@&${TICKET_VIEWER_ROLE_ID}> <@&${SPECIAL_ROLE_ID}>`,
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

// Register Slash Commands
client.once('clientReady', async () => {
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
                            { name: 'Disable', value: 'disable' },
                            { name: 'Configure', value: 'configure' },
                            { name: 'Auto-Recovery', value: 'auto_recovery' }
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
                            { name: 'Ban Add', value: 'ban_add' },
                            { name: 'Kick Add', value: 'kick_add' },
                            { name: '@everyone Ping', value: 'everyone_ping' }
                        ]
                    },
                    {
                        name: 'value',
                        type: 4, // INTEGER
                        description: 'New value for the limit',
                        required: false
                    },
                    {
                        name: 'enable',
                        type: 5, // BOOLEAN
                        description: 'Enable or disable auto-recovery',
                        required: false
                    }
                ]
            },
            {
                name: 'backup',
                description: 'Backup server state'
            },
            {
                name: 'immune',
                description: 'Manage immune users',
                options: [
                    {
                        name: 'action',
                        type: 3, // STRING
                        description: 'The action to perform',
                        required: true,
                        choices: [
                            { name: 'Add', value: 'add' },
                            { name: 'Remove', value: 'remove' },
                            { name: 'List', value: 'list' }
                        ]
                    },
                    {
                        name: 'user',
                        type: 6, // USER
                        description: 'The user to manage',
                        required: false
                    },
                    {
                        name: 'reason',
                        type: 3, // STRING
                        description: 'Reason for immunity',
                        required: false
                    },
                    {
                        name: 'duration',
                        type: 3, // STRING
                        description: 'Duration of immunity (e.g., 7d, 24h)',
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
