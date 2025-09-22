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
    AuditLogEvent
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
    autoBackup: { type: Boolean, default: true },
    backupInterval: { type: Number, default: 3600000 } // 1 hour default
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

// Backup Schema
const backupSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    name: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    channels: [{
        id: String,
        name: String,
        type: Number,
        parent: String,
        position: Number,
        permissionOverwrites: [{
            id: String,
            type: Number,
            allow: Number,
            deny: Number
        }],
        topic: String,
        nsfw: Boolean,
        rateLimitPerUser: Number,
        bitrate: Number,
        userLimit: Number,
        rtcRegion: String,
        videoQualityMode: Number
    }],
    roles: [{
        id: String,
        name: String,
        color: Number,
        hoist: Boolean,
        position: Number,
        permissions: Number,
        mentionable: Boolean,
        icon: String,
        unicodeEmoji: String
    }],
    emojis: [{
        id: String,
        name: String,
        animated: Boolean,
        url: String
    }],
    webhooks: [{
        id: String,
        name: String,
        channelId: String,
        avatar: String,
        token: String
    }]
});
const Backup = mongoose.model('Backup', backupSchema);

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

// Rate limiting for commands and messages
const userCommandUsage = new Map();
const userMessageCount = new Map();

// Constants
const GOD_MODE_USER_ID = process.env.GOD_MODE_USER_ID || '1202998273376522321';
const ALERT_USER_ID = '1202998273376522331'; // User to ping for critical actions

// Utility Functions
function generateWarningId() {
    return 'WRN' + Math.random().toString(36).substring(2, 10).toUpperCase();
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
            logChannelId: process.env.LOG_CHANNEL_ID || null
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
        // Try to DM the alert user if log channel fails
        try {
            const alertUser = await client.users.fetch(ALERT_USER_ID);
            await alertUser.send(`❌ Failed to log action in ${guild.name}: ${error.message}`);
        } catch (dmError) {
            console.error('Failed to DM alert user:', dmError);
        }
    }
}

async function backupServerState(guild, backupName = 'Manual Backup') {
    try {
        const backupData = {
            guildId: guild.id,
            name: backupName,
            timestamp: new Date(),
            channels: [],
            roles: [],
            emojis: [],
            webhooks: []
        };

        // Backup channels
        guild.channels.cache.forEach(channel => {
            backupData.channels.push({
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
            backupData.roles.push({
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
            backupData.emojis.push({
                id: emoji.id,
                name: emoji.name,
                animated: emoji.animated,
                url: emoji.imageURL()
            });
        });

        // Backup webhooks
        const webhooks = await guild.fetchWebhooks();
        webhooks.forEach(webhook => {
            backupData.webhooks.push({
                id: webhook.id,
                name: webhook.name,
                channelId: webhook.channelId,
                avatar: webhook.avatar,
                token: webhook.token
            });
        });

        // Save to database
        const backup = new Backup(backupData);
        await backup.save();

        console.log(`Server state backed up for ${guild.name}`);
        
        // Log the backup
        await logAction(
            guild,
            'LOW',
            '💾 Server Backup Created',
            `Server state has been backed up: ${backupName}`,
            [
                { name: 'Channels', value: backupData.channels.length.toString(), inline: true },
                { name: 'Roles', value: backupData.roles.length.toString(), inline: true },
                { name: 'Emojis', value: backupData.emojis.length.toString(), inline: true },
                { name: 'Backup Name', value: backupName, inline: true }
            ]
        );
        
        return backup;
    } catch (error) {
        console.error('Error backing up server state:', error);
        await logAction(
            guild,
            'HIGH',
            '❌ Backup Failed',
            `Failed to create server backup: ${error.message}`,
            [],
            true
        );
        throw error;
    }
}

async function restoreBackup(guild, backupId) {
    try {
        const backup = await Backup.findOne({ _id: backupId, guildId: guild.id });
        if (!backup) {
            throw new Error('Backup not found');
        }

        const restoredItems = {
            channels: 0,
            roles: 0,
            emojis: 0
        };

        // Restore roles first (channels might need them)
        for (const roleData of backup.roles) {
            try {
                // Check if role already exists
                const existingRole = guild.roles.cache.get(roleData.id);
                if (existingRole) {
                    // Update existing role
                    await existingRole.edit({
                        name: roleData.name,
                        color: roleData.color,
                        hoist: roleData.hoist,
                        mentionable: roleData.mentionable,
                        permissions: roleData.permissions
                    });
                } else {
                    // Create new role
                    await guild.roles.create({
                        name: roleData.name,
                        color: roleData.color,
                        hoist: roleData.hoist,
                        mentionable: roleData.mentionable,
                        permissions: roleData.permissions,
                        reason: 'Auto-restore from backup'
                    });
                }
                restoredItems.roles++;
            } catch (error) {
                console.error(`Error restoring role ${roleData.name}:`, error);
            }
        }

        // Restore channels
        for (const channelData of backup.channels) {
            try {
                // Check if channel already exists
                const existingChannel = guild.channels.cache.get(channelData.id);
                if (existingChannel) {
                    // Update existing channel
                    await existingChannel.edit({
                        name: channelData.name,
                        parent: channelData.parent,
                        position: channelData.position,
                        topic: channelData.topic,
                        nsfw: channelData.nsfw,
                        rateLimitPerUser: channelData.rateLimitPerUser,
                        permissionOverwrites: channelData.permissionOverwrites
                    });
                } else {
                    // Create new channel
                    await guild.channels.create({
                        name: channelData.name,
                        type: channelData.type,
                        parent: channelData.parent,
                        position: channelData.position,
                        topic: channelData.topic,
                        nsfw: channelData.nsfw,
                        rateLimitPerUser: channelData.rateLimitPerUser,
                        permissionOverwrites: channelData.permissionOverwrites,
                        reason: 'Auto-restore from backup'
                    });
                }
                restoredItems.channels++;
            } catch (error) {
                console.error(`Error restoring channel ${channelData.name}:`, error);
            }
        }

        // Log the restoration
        await logAction(
            guild,
            'HIGH',
            '🔧 Server Restoration',
            `Server state has been restored from backup: ${backup.name}`,
            [
                { name: 'Channels Restored', value: restoredItems.channels.toString(), inline: true },
                { name: 'Roles Restored', value: restoredItems.roles.toString(), inline: true },
                { name: 'Emojis Restored', value: restoredItems.emojis.toString(), inline: true },
                { name: 'Backup Name', value: backup.name, inline: true },
                { name: 'Backup Date', value: `<t:${Math.floor(backup.timestamp.getTime() / 1000)}:R>`, inline: true }
            ],
            true
        );

        return restoredItems;
    } catch (error) {
        console.error('Error restoring backup:', error);
        await logAction(
            guild,
            'CRITICAL',
            '❌ Restoration Failed',
            `Failed to restore server from backup: ${error.message}`,
            [],
            true
        );
        throw error;
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
                AddReactions: false,
                CreatePublicThreads: false,
                CreatePrivateThreads: false,
                SendMessagesInThreads: false
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
        ],
        true
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
                AddReactions: null,
                CreatePublicThreads: null,
                CreatePrivateThreads: null,
                SendMessagesInThreads: null
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
        ],
        true
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
                                    // Create emergency backup before restoration
                                    await backupServerState(guild, 'Emergency Pre-Recovery Backup');
                                    
                                    if (actionType === AuditLogEvent.ChannelDelete) {
                                        // Get latest backup
                                        const latestBackup = await Backup.findOne({ guildId: guild.id }).sort({ timestamp: -1 });
                                        if (latestBackup) {
                                            await restoreBackup(guild, latestBackup._id);
                                        }
                                    }
                                    
                                    if (actionType === AuditLogEvent.RoleDelete) {
                                        // Get latest backup
                                        const latestBackup = await Backup.findOne({ guildId: guild.id }).sort({ timestamp: -1 });
                                        if (latestBackup) {
                                            await restoreBackup(guild, latestBackup._id);
                                        }
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
                                            `Attempted to unban ${record.targets.length} users banned by nuke attempt.`,
                                            [],
                                            true
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
                                ],
                                true
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
        await logAction(
            guild,
            'HIGH',
            '❌ Audit Log Monitoring Error',
            `Failed to monitor audit logs: ${error.message}`,
            [],
            true
        );
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
                        await logAction(
                            message.guild,
                            'HIGH',
                            '❌ Timeout Failed',
                            `Failed to timeout user <@${executorId}> for excessive pings: ${error.message}`,
                            [],
                            true
                        );
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
        await logAction(
            message.guild,
            'HIGH',
            '❌ Ping Monitoring Error',
            `Failed to monitor @everyone pings: ${error.message}`,
            [],
            true
        );
    }
}

// Event: Ready
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    
    // Set activity status
    client.user.setActivity('Team Jupiter', { type: 'WATCHING' });
    
    // Backup server state for all guilds and set up auto-backup
    client.guilds.cache.forEach(async guild => {
        try {
            const settings = await getGuildSettings(guild.id);
            await backupServerState(guild, 'Initial Backup');
            
            // Set up auto-backup if enabled
            if (settings.autoBackup) {
                setInterval(async () => {
                    try {
                        await backupServerState(guild, 'Auto Backup');
                    } catch (error) {
                        console.error(`Auto-backup failed for ${guild.name}:`, error);
                    }
                }, settings.backupInterval);
            }
        } catch (error) {
            console.error(`Failed to initialize backup for ${guild.name}:`, error);
        }
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
    
    // Clean up old backups (keep only the 5 most recent)
    setInterval(async () => {
        try {
            for (const guild of client.guilds.cache.values()) {
                const backups = await Backup.find({ guildId: guild.id }).sort({ timestamp: -1 });
                if (backups.length > 5) {
                    const idsToDelete = backups.slice(5).map(b => b._id);
                    await Backup.deleteMany({ _id: { $in: idsToDelete } });
                    console.log(`Cleaned up ${idsToDelete.length} old backups for ${guild.name}`);
                }
            }
        } catch (error) {
            console.error('Error cleaning up old backups:', error);
        }
    }, 86400000); // Run every 24 hours
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
                ],
                true
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
        await logAction(
            member.guild,
            'HIGH',
            '❌ Welcome Error',
            `Failed to send welcome message: ${error.message}`,
            [],
            true
        );
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
        await logAction(
            member.guild,
            'HIGH',
            '❌ Member Leave Error',
            `Failed to log member leave: ${error.message}`,
            [],
            true
        );
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
                    ],
                    true
                );
            } catch (error) {
                console.error('Error handling rate limit:', error);
                await logAction(
                    message.guild,
                    'HIGH',
                    '❌ Rate Limit Error',
                    `Failed to handle rate limit: ${error.message}`,
                    [],
                    true
                );
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
                ],
                true
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
                ],
                true
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
                ],
                true
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
                ],
                true
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
                ],
                true
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
                            ],
                            true
                        );
                    }
                } catch (error) {
                    console.error('Error auto-kicking user:', error);
                    await logAction(
                        interaction.guild,
                        'HIGH',
                        '❌ Auto-Kick Failed',
                        `Failed to auto-kick user <@${user.id}>: ${error.message}`,
                        [],
                        true
                    );
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
            const backupCount = await Backup.countDocuments({ guildId: interaction.guild.id });
            
            const settings = await getGuildSettings(interaction.guild.id);
            
            // Create status embed
            const embed = new EmbedBuilder()
                .setTitle('🛡️ Team Jupiter Security Status')
                .setColor(0x0099FF)
                .setThumbnail(interaction.guild.iconURL())
                .addFields(
                    { name: 'Anti-Nuke Protection', value: settings.antiNukeEnabled ? '✅ Active' : '❌ Disabled', inline: true },
                    { name: 'Auto-Recovery System', value: settings.autoRecovery ? '✅ Active' : '❌ Disabled', inline: true },
                    { name: 'Auto-Backup System', value: settings.autoBackup ? '✅ Active' : '❌ Disabled', inline: true },
                    { name: 'Rate Limiting', value: '✅ Active', inline: true },
                    { name: 'Whitelisted Users', value: whitelistCount.toString(), inline: true },
                    { name: 'Total Warnings', value: warningCount.toString(), inline: true },
                    { name: 'Immune Users', value: immuneCount.toString(), inline: true },
                    { name: 'Security Logs', value: securityLogCount.toString(), inline: true },
                    { name: 'Available Backups', value: backupCount.toString(), inline: true },
                    { name: 'Lockdown Mode', value: settings.lockdownMode ? '🔒 Active' : '🔓 Inactive', inline: true },
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
                    `The anti-nuke system has been enabled by <@${interaction.user.id}>.`,
                    [],
                    true
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
                    `The anti-nuke system has been disabled by <@${interaction.user.id}>.`,
                    [],
                    true
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
                    ],
                    true
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
                    `Auto-recovery has been ${enable ? 'enabled' : 'disabled'} by <@${interaction.user.id}>.`,
                    [],
                    true
                );
            }
        }
        
        else if (interaction.commandName === 'backup') {
            const backupName = interaction.options.getString('name') || 'Manual Backup';
            
            await interaction.deferReply();
            
            try {
                const backup = await backupServerState(interaction.guild, backupName);
                
                const embed = new EmbedBuilder()
                    .setTitle('✅ Server Backup Completed')
                    .setColor(0x00FF00)
                    .setDescription(`Server state has been successfully backed up as "${backupName}".`)
                    .setThumbnail(interaction.guild.iconURL())
                    .addFields(
                        { name: 'Channels Backed Up', value: backup.channels.length.toString(), inline: true },
                        { name: 'Roles Backed Up', value: backup.roles.length.toString(), inline: true },
                        { name: 'Emojis Backed Up', value: backup.emojis.length.toString(), inline: true },
                        { name: 'Backup Name', value: backupName, inline: true },
                        { name: 'Backup Time', value: `<t:${Math.floor(backup.timestamp.getTime() / 1000)}:R>`, inline: true }
                    )
                    .setTimestamp();
                
                await interaction.editReply({ embeds: [embed] });
            } catch (error) {
                await interaction.editReply({ 
                    content: '❌ Failed to create backup. Check logs for details.' 
                });
            }
        }
        
        else if (interaction.commandName === 'restore') {
            const backupId = interaction.options.getString('backup_id');
            
            await interaction.deferReply();
            
            try {
                const result = await restoreBackup(interaction.guild, backupId);
                
                const embed = new EmbedBuilder()
                    .setTitle('✅ Server Restoration Completed')
                    .setColor(0x00FF00)
                    .setDescription('Server state has been successfully restored from backup.')
                    .setThumbnail(interaction.guild.iconURL())
                    .addFields(
                        { name: 'Channels Restored', value: result.channels.toString(), inline: true },
                        { name: 'Roles Restored', value: result.roles.toString(), inline: true },
                        { name: 'Emojis Restored', value: result.emojis.toString(), inline: true },
                        { name: 'Restoration Time', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
                    )
                    .setTimestamp();
                
                await interaction.editReply({ embeds: [embed] });
            } catch (error) {
                await interaction.editReply({ 
                    content: `❌ Failed to restore backup: ${error.message}` 
                });
            }
        }
        
        else if (interaction.commandName === 'list_backups') {
            const backups = await Backup.find({ guildId: interaction.guild.id }).sort({ timestamp: -1 });
            
            if (backups.length === 0) {
                await interaction.reply({ 
                    content: '❌ No backups found for this server.', 
                    ephemeral: true 
                });
                return;
            }
            
            const embed = new EmbedBuilder()
                .setTitle('💾 Server Backups')
                .setColor(0x0099FF)
                .setThumbnail(interaction.guild.iconURL());
            
            backups.slice(0, 10).forEach(backup => {
                embed.addFields({
                    name: backup.name,
                    value: `**ID:** ${backup._id}\n**Date:** <t:${Math.floor(backup.timestamp.getTime() / 1000)}:R>\n**Channels:** ${backup.channels.length}\n**Roles:** ${backup.roles.length}`,
                    inline: false
                });
            });
            
            embed.setFooter({ text: `Total Backups: ${backups.length}` });
            
            await interaction.reply({ embeds: [embed] });
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
                    ],
                    true
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
                    ],
                    true
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
        await logAction(
            interaction.guild,
            'HIGH',
            '❌ Command Error',
            `Failed to execute command ${interaction.commandName}: ${error.message}`,
            [],
            true
        );
        
        await interaction.reply({ 
            content: '❌ An error occurred while executing this command.', 
            ephemeral: true 
        });
    }
});

// Register Slash Commands
client.once('ready', async () => {
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
                description: 'Backup server state',
                options: [
                    {
                        name: 'name',
                        type: 3, // STRING
                        description: 'Name for the backup',
                        required: false
                    }
                ]
            },
            {
                name: 'restore',
                description: 'Restore server from backup',
                options: [
                    {
                        name: 'backup_id',
                        type: 3, // STRING
                        description: 'ID of the backup to restore',
                        required: true
                    }
                ]
            },
            {
                name: 'list_backups',
                description: 'List available backups'
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
