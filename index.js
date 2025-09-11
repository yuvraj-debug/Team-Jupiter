\require('dotenv').config();
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

// Add TTL indexes for auto-cleanup
warningSchema.index({ timestamp: 1 }, { expireAfterSeconds: 7776000 }); // 90 days
ticketSchema.index({ closedAt: 1 }, { expireAfterSeconds: 2592000 }); // 30 days

const Warning = mongoose.model('Warning', warningSchema);
const Whitelist = mongoose.model('Whitelist', whitelistSchema);
const Immune = mongoose.model('Immune', immuneSchema);
const Ticket = mongoose.model('Ticket', ticketSchema);

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
        GatewayIntentBits.GuildIntegrations
    ]
});

// Configuration
const config = {
    welcomeChannelId: process.env.WELCOME_CHANNEL_ID,
    logChannelId: process.env.LOG_CHANNEL_ID,
    botToken: process.env.BOT_TOKEN,
    guildId: process.env.GUILD_ID,
    adminIds: process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',') : [],
    ticketViewerRoleId: process.env.TICKET_VIEWER_ROLE_ID,
    mentionRoleName: process.env.MENTION_ROLE_NAME || 'Mention Permissions',
    securityRoleName: process.env.SECURITY_ROLE_NAME || 'Security Admin',
    authorizedUsers: process.env.AUTHORIZED_USERS ? process.env.AUTHORIZED_USERS.split(',') : []
};

// Memory storage for temporary data
const memoryData = {
    recentDeletions: new Map(),
    deletedChannels: new Map(),
    userMessageCount: new Map(),
    userJoinTimestamps: new Map(),
    userInviteCount: new Map()
};

// Load data from MongoDB
async function loadData() {
    try {
        // Load enabled features from environment variables with defaults
        const enabledFeatures = {
            linkBlocking: process.env.LINK_BLOCKING !== 'false',
            securityMode: process.env.SECURITY_MODE !== 'false',
            antiSpam: process.env.ANTI_SPAM !== 'false',
            antiRaid: process.env.ANTI_RAID !== 'false',
            antiNuke: process.env.ANTI_NUKE !== 'false',
            massMentionProtection: process.env.MASS_MENTION_PROTECTION !== 'false',
            inviteProtection: process.env.INVITE_PROTECTION !== 'false'
        };
        
        return { enabledFeatures };
    } catch (error) {
        console.error('Error loading data:', error);
        return {
            enabledFeatures: {
                linkBlocking: true,
                securityMode: true,
                antiSpam: true,
                antiRaid: true,
                antiNuke: true,
                massMentionProtection: true,
                inviteProtection: true
            }
        };
    }
}

// Get enabled features
let data = {};
loadData().then(loadedData => {
    data = loadedData;
});

// Logging function
async function logAction(action, details, color = 0x0099FF, user = null) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${action}: ${details}`);
    
    // Send to log channel if configured
    if (config.logChannelId) {
        try {
            const logChannel = client.channels.cache.get(config.logChannelId);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setColor(color)
                    .setTitle(`📝 ${action}`)
                    .setDescription(details)
                    .setTimestamp();
                
                if (user) {
                    logEmbed.setAuthor({ 
                        name: user.tag, 
                        iconURL: user.displayAvatarURL() 
                    });
                }
                
                await logChannel.send({ embeds: [logEmbed] });
            }
        } catch (error) {
            console.error('Error sending log to channel:', error);
        }
    }
}

// Check if user has ticket management permissions
function hasTicketPermission(member, ticketData = null) {
    // Admins always have permission
    if (config.adminIds.includes(member.id)) return true;
    
    // Check if user has the ticket manager role
    if (member.roles.cache.has(config.ticketViewerRoleId)) return true;
    
    // Ticket creator can manage their own ticket
    if (ticketData && ticketData.creator === member.id) return true;
    
    // User who claimed the ticket can manage it
    if (ticketData && ticketData.claimedBy === member.id) return true;
    
    return false;
}

// Create or get mention permission role
async function setupMentionRole(guild) {
    try {
        // Check if role already exists
        let mentionRole = guild.roles.cache.find(role => role.name === config.mentionRoleName);
        
        if (!mentionRole) {
            // Create the role if it doesn't exist
            mentionRole = await guild.roles.create({
                name: config.mentionRoleName,
                color: 'Blue',
                permissions: [
                    PermissionsBitField.Flags.MentionEveryone,
                    PermissionsBitField.Flags.UseApplicationCommands
                ],
                reason: 'Role for users allowed to mention @everyone and roles'
            });
            
            await logAction('ROLE_CREATED', `Created mention permission role: ${config.mentionRoleName}`, 0x00FF00);
        }
        
        return mentionRole;
    } catch (error) {
        console.error('Error setting up mention role:', error);
        await logAction('ROLE_SETUP_ERROR', `Failed to setup mention role: ${error.message}`, 0xFF0000);
    }
}

// Create or get security admin role
async function setupSecurityRole(guild) {
    try {
        // Check if role already exists
        let securityRole = guild.roles.cache.find(role => role.name === config.securityRoleName);
        
        if (!securityRole) {
            // Create the role if it doesn't exist
            securityRole = await guild.roles.create({
                name: config.securityRoleName,
                color: 'Red',
                permissions: [
                    PermissionsBitField.Flags.KickMembers,
                    PermissionsBitField.Flags.BanMembers,
                    PermissionsBitField.Flags.ManageChannels,
                    PermissionsBitField.Flags.ManageGuild,
                    PermissionsBitField.Flags.ViewAuditLog,
                    PermissionsBitField.Flags.ModerateMembers
                ],
                reason: 'Role for security administrators'
            });
            
            await logAction('ROLE_CREATED', `Created security admin role: ${config.securityRoleName}`, 0x00FF00);
        }
        
        return securityRole;
    } catch (error) {
        console.error('Error setting up security role:', error);
        await logAction('ROLE_SETUP_ERROR', `Failed to setup security role: ${error.message}`, 0xFF0000);
    }
}

// Update channel permissions to restrict @everyone and @here mentions
async function updateChannelPermissions(guild, mentionRole) {
    try {
        const channels = guild.channels.cache;
        
        for (const [id, channel] of channels) {
            if (channel.isTextBased() && !channel.isThread()) {
                // Update permission overwrites to restrict mentions for everyone
                await channel.permissionOverwrites.edit(guild.roles.everyone, {
                    MentionEveryone: false
                });
                
                // Allow mentions for the special role
                await channel.permissionOverwrites.edit(mentionRole.id, {
                    MentionEveryone: true
                });
            }
        }
        
        await logAction('PERMISSIONS_UPDATED', 'Updated channel permissions to restrict @everyone mentions', 0x00FF00);
    } catch (error) {
        console.error('Error updating channel permissions:', error);
        await logAction('PERMISSION_UPDATE_ERROR', `Failed to update channel permissions: ${error.message}`, 0xFF0000);
    }
}

// Welcome System
client.on(Events.GuildMemberAdd, async (member) => {
    try {
        // Anti-raid protection
        if (data.enabledFeatures.antiRaid) {
            const now = Date.now();
            const joinTimestamps = memoryData.userJoinTimestamps.get(member.guild.id) || [];
            
            // Keep only joins from the last 10 seconds
            const recentJoins = joinTimestamps.filter(time => now - time < 10000);
            recentJoins.push(now);
            memoryData.userJoinTimestamps.set(member.guild.id, recentJoins);
            
            // If more than 5 joins in 10 seconds, activate lockdown
            if (recentJoins.length >= 5) {
                await enableLockdown(member.guild);
                await logAction('RAID_DETECTED', `Raid detected! ${recentJoins.length} users joined in 10 seconds. Server locked down.`, 0xFF0000);
            }
        }
        
        const welcomeChannel = member.guild.channels.cache.get(config.welcomeChannelId);
        if (!welcomeChannel) {
            console.log('Welcome channel not found');
            return;
        }
        
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
        
        await logAction('MEMBER_JOIN', `${member.user.tag} joined the server`, 0x00FF00, member.user);
    } catch (error) {
        console.error('Error in welcome system:', error);
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
        
        await logAction('LOCKDOWN_ENABLED', 'Server lockdown enabled due to possible raid', 0xFF0000);
        
        // Schedule automatic unlock after 10 minutes
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
        
        await logAction('LOCKDOWN_DISABLED', 'Server lockdown disabled', 0x00FF00);
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
        
        // Send warning DM
        try {
            const warningEmbed = new EmbedBuilder()
                .setColor(0xFFA500)
                .setTitle('⚠️ Warning Issued')
                .setDescription(`You have received a warning in **${guild.name}**`)
                .addFields(
                    { name: 'Warning ID', value: `\`${warningId}\``, inline: true },
                    { name: 'Reason', value: reason, inline: true },
                    { name: 'Moderator', value: moderator.user.tag, inline: true },
                    { name: 'Total Warnings', value: `${warnings}/3`, inline: true },
                    { name: 'Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
                    { name: 'Next Action', value: warnings >= 3 ? 'Kick from server' : 'Warning', inline: true }
                )
                .setFooter({ text: 'Please follow the server rules to avoid further actions' })
                .setTimestamp();
                
            await user.send({ embeds: [warningEmbed] });
        } catch (error) {
            console.error('Could not send DM to user:', error);
        }
        
        // Check if user has reached 3 warnings
        if (warnings >= 3) {
            try {
                const member = await guild.members.fetch(user.id);
                await member.kick('Received 3 warnings');
                
                await logAction('MEMBER_KICKED', `Kicked ${user.tag} for receiving 3 warnings`, 0xFF0000, user);
                
                // Clear warnings after kick
                await Warning.deleteMany({ userId: user.id, guildId: guild.id });
                
                // Send kick notification
                try {
                    const kickEmbed = new EmbedBuilder()
                        .setColor(0xFF0000)
                        .setTitle('🚫 Member Kicked')
                        .setDescription(`You have been kicked from **${guild.name}** for accumulating 3 warnings`)
                        .addFields(
                            { name: 'Reason', value: 'Excessive warnings (3/3)', inline: true },
                            { name: 'Action', value: 'Kick', inline: true },
                            { name: 'Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                        )
                        .setFooter({ text: 'You can rejoin the server if you believe this was a mistake' })
                        .setTimestamp();
                        
                    await user.send({ embeds: [kickEmbed] });
                } catch (dmError) {
                    console.error('Could not send kick DM to user:', dmError);
                }
            } catch (error) {
                console.error('Failed to kick user:', error);
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
                    content: 'You already have an open ticket! Please close it before creating a new one.', 
                    ephemeral: true 
                });
                return;
            }
            
            const ticketType = interaction.customId;
            const ticketNumber = Math.floor(1000 + Math.random() * 9000);
            const ticketChannelName = `${ticketType}-${ticketNumber}`;
            
            // Get the ticket viewer role
            const ticketViewerRole = interaction.guild.roles.cache.get(config.ticketViewerRoleId);
            
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
                
            const lockButton = new ButtonBuilder()
                .setCustomId('lock_ticket')
                .setLabel('Lock')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('🔒');
                
            const deleteButton = new ButtonBuilder()
                .setCustomId('delete_ticket')
                .setLabel('Delete')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🗑️');
                
            const row = new ActionRowBuilder().addComponents(claimButton, lockButton, deleteButton);
            
            const ticketEmbed = new EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle('🎫 Ticket Created')
                .setDescription(`Hello ${interaction.user}! Support will be with you shortly.\n\n**Ticket Type:** ${ticketType.replace(/_/g, ' ').toUpperCase()}\n**Ticket ID:** ${ticketNumber}\n**Status:** 🟢 Open`)
                .setFooter({ text: `User ID: ${interaction.user.id}` })
                .setTimestamp();
                
            // Ping the user and the ticket viewer role
            let pingContent = `${interaction.user}`;
            if (ticketViewerRole) {
                pingContent += ` ${ticketViewerRole}`;
            }
                
            await ticketChannel.send({ 
                content: pingContent,
                embeds: [ticketEmbed], 
                components: [row] 
            });
            
            await interaction.reply({ 
                content: `🎫 Ticket created! ${ticketChannel}`, 
                ephemeral: true 
            });
            
            await logAction('TICKET_CREATE', `${interaction.user.tag} created ${ticketType} ticket #${ticketNumber}`, 0x0099FF, interaction.user);
        } catch (error) {
            console.error('Error creating ticket:', error);
            await interaction.reply({ 
                content: '❌ Failed to create ticket. Please contact an administrator.', 
                ephemeral: true 
            });
        }
    }
    
    // Ticket management buttons
    if (interaction.customId === 'claim_ticket' || interaction.customId === 'lock_ticket' || interaction.customId === 'unlock_ticket' || interaction.customId === 'delete_ticket') {
        const ticketData = await Ticket.findOne({ channelId: interaction.channel.id });
        if (!ticketData) {
            await interaction.reply({ 
                content: '❌ This is not a valid ticket channel.', 
                ephemeral: true 
            });
            return;
        }
        
        // Check if user has permission to manage tickets
        if (!hasTicketPermission(interaction.member, ticketData)) {
            await interaction.reply({ 
                content: '❌ You do not have permission to manage this ticket.', 
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
            await logAction('TICKET_CLAIM', `${interaction.user.tag} claimed ticket in ${interaction.channel.name}`, 0x00FF00, interaction.user);
        }
        
        if (interaction.customId === 'lock_ticket') {
            if (ticketData.locked) {
                await interaction.reply({ 
                    content: '❌ This ticket is already locked.', 
                    ephemeral: true 
                });
                return;
            }
            
            await Ticket.updateOne(
                { channelId: interaction.channel.id },
                { locked: true }
            );
            
            await interaction.channel.permissionOverwrites.edit(ticketData.creator, {
                ViewChannel: true,
                SendMessages: false,
                ReadMessageHistory: true
            });
            
            // Add 🔒 emoji to the front of the channel name
            const currentName = interaction.channel.name;
            await interaction.channel.setName(`🔒 ${currentName.replace(/^(✅ |🔒 )/, '')}`);
            
            // Update buttons - remove lock, add unlock
            const claimButton = new ButtonBuilder()
                .setCustomId('claim_ticket')
                .setLabel('Claim')
                .setStyle(ButtonStyle.Success)
                .setEmoji('✅')
                .setDisabled(true);
                
            const unlockButton = new ButtonBuilder()
                .setCustomId('unlock_ticket')
                .setLabel('Unlock')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('🔓');
                
            const deleteButton = new ButtonBuilder()
                .setCustomId('delete_ticket')
                .setLabel('Delete')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🗑️');
                
            const row = new ActionRowBuilder().addComponents(claimButton, unlockButton, deleteButton);
            
            // Update the message with new buttons
            const messages = await interaction.channel.messages.fetch();
            const ticketMessage = messages.find(m => m.embeds.length > 0 && m.embeds[0].title === '🎫 Ticket Created');
            
            if (ticketMessage) {
                const embed = ticketMessage.embeds[0];
                const updatedEmbed = EmbedBuilder.from(embed)
                    .setDescription(embed.description.replace('🟢 Open', '🔴 Locked'));
                
                await ticketMessage.edit({ embeds: [updatedEmbed], components: [row] });
            }
            
            await interaction.reply(`🔒 Ticket locked by ${interaction.user}`);
            await logAction('TICKET_LOCK', `${interaction.user.tag} locked ticket in ${interaction.channel.name}`, 0xFFA500, interaction.user);
        }
        
        if (interaction.customId === 'unlock_ticket') {
            if (!ticketData.locked) {
                await interaction.reply({ 
                    content: '❌ This ticket is not locked.', 
                    ephemeral: true 
                });
                return;
            }
            
            await Ticket.updateOne(
                { channelId: interaction.channel.id },
                { locked: false }
            );
            
            await interaction.channel.permissionOverwrites.edit(ticketData.creator, {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true
            });
            
            // Remove 🔒 emoji from the channel name
            const currentName = interaction.channel.name;
            await interaction.channel.setName(currentName.replace(/^🔒 /, ''));
            
            // Update buttons - add lock, remove unlock
            const claimButton = new ButtonBuilder()
                .setCustomId('claim_ticket')
                .setLabel('Claim')
                .setStyle(ButtonStyle.Success)
                .setEmoji('✅')
                .setDisabled(!!ticketData.claimedBy);
                
            const lockButton = new ButtonBuilder()
                .setCustomId('lock_ticket')
                .setLabel('Lock')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('🔒');
                
            const deleteButton = new ButtonBuilder()
                .setCustomId('delete_ticket')
                .setLabel('Delete')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🗑️');
                
            const row = new ActionRowBuilder().addComponents(claimButton, lockButton, deleteButton);
            
            // Update the message with new buttons
            const messages = await interaction.channel.messages.fetch();
            const ticketMessage = messages.find(m => m.embeds.length > 0 && m.embeds[0].title === '🎫 Ticket Created');
            
            if (ticketMessage) {
                const embed = ticketMessage.embeds[0];
                const updatedEmbed = EmbedBuilder.from(embed)
                    .setDescription(embed.description.replace('🔴 Locked', '🟢 Open'));
                
                await ticketMessage.edit({ embeds: [updatedEmbed], components: [row] });
            }
            
            await interaction.reply(`🔓 Ticket unlocked by ${interaction.user}`);
            await logAction('TICKET_UNLOCK', `${interaction.user.tag} unlocked ticket in ${interaction.channel.name}`, 0x00FF00, interaction.user);
        }
        
        if (interaction.customId === 'delete_ticket') {
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
            await logAction('TICKET_DELETE', `${interaction.user.tag} deleted ticket ${interaction.channel.name}`, 0xFF0000, interaction.user);
        }
    }
});

// Enhanced Security System
client.on(Events.ChannelDelete, async (channel) => {
    if (!channel.guild || !data.enabledFeatures.securityMode) return;
    
    try {
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
                    await logAction('SECURITY_BAN', `Banned ${executor.tag} for excessive channel deletions`, 0xFF0000, executor);
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
                
                await logAction('CHANNEL_RECREATED', `Recreated channel #${channel.name} deleted by ${executor.tag}`, 0x00FF00);
            } catch (recreateError) {
                console.error('Failed to recreate channel:', recreateError);
                await logAction('CHANNEL_RECREATE_FAILED', `Failed to recreate channel #${channel.name}: ${recreateError.message}`, 0xFF0000);
            }
            
            await logAction('CHANNEL_DELETE_ATTEMPT', `Prevented channel deletion by ${executor.tag} (${recentCount} attempts)`, 0xFFA500, executor);
        }
    } catch (error) {
        console.error('Error in channel delete handler:', error);
    }
});

// Additional security events
client.on(Events.ChannelCreate, async (channel) => {
    if (!channel.guild || !data.enabledFeatures.securityMode) return;
    
    try {
        const auditLogs = await channel.guild.fetchAuditLogs({ 
            type: AuditLogEvent.ChannelCreate, 
            limit: 1 
        });
        
        const entry = auditLogs.entries.first();
        
        if (entry && entry.executor && !await isWhitelisted(entry.executor.id) && !entry.executor.bot) {
            await channel.delete();
            await logAction('CHANNEL_CREATE_BLOCKED', `Prevented channel creation by non-whitelisted user: ${entry.executor.tag}`, 0xFF0000, entry.executor);
        }
    } catch (error) {
        console.error('Error in channel create handler:', error);
    }
});

client.on(Events.RoleCreate, async (role) => {
    if (!role.guild || !data.enabledFeatures.securityMode) return;
    
    try {
        const auditLogs = await role.guild.fetchAuditLogs({ 
            type: AuditLogEvent.RoleCreate, 
            limit: 1 
        });
        
        const entry = auditLogs.entries.first();
        
        if (entry && entry.executor && !await isWhitelisted(entry.executor.id) && !entry.executor.bot) {
            await role.delete();
            await logAction('ROLE_CREATE_BLOCKED', `Prevented role creation by non-whitelisted user: ${entry.executor.tag}`, 0xFF0000, entry.executor);
        }
    } catch (error) {
        console.error('Error in role create handler:', error);
    }
});

client.on(Events.RoleDelete, async (role) => {
    if (!role.guild || !data.enabledFeatures.securityMode) return;
    
    try {
        const auditLogs = await role.guild.fetchAuditLogs({ 
            type: AuditLogEvent.RoleDelete, 
            limit: 1 
        });
        
        const entry = auditLogs.entries.first();
        
        if (entry && entry.executor && !await isWhitelisted(entry.executor.id) && !entry.executor.bot) {
            await logAction('ROLE_DELETE_BLOCKED', `Prevented role deletion by non-whitelisted user: ${entry.executor.tag}`, 0xFF0000, entry.executor);
        }
    } catch (error) {
        console.error('Error in role delete handler:', error);
    }
});

// Anti-spam system
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.guild) return;
    
    // Anti-spam protection
    if (data.enabledFeatures.antiSpam) {
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
                await logAction('ANTI_SPAM', `Muted ${message.author.tag} for spamming (${userMessages.length} messages in 5 seconds)`, 0xFF0000, message.author);
                
                // Reset message count
                memoryData.userMessageCount.delete(userId);
            } catch (error) {
                console.error('Error muting user for spam:', error);
            }
        }
    }
    
    // Link blocking
    if (data.enabledFeatures.linkBlocking) {
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
            
            await logAction('LINK_BLOCK', `Blocked link from ${message.author.tag}: ${message.content}`, 0xFF0000, message.author);
            
            // Add warning for link violation
            await addWarning(message.author, message.guild, 'Link violation', message.member);
        }
    }
    
    // Invite link protection
    if (data.enabledFeatures.inviteProtection) {
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
            
            await logAction('INVITE_BLOCK', `Blocked invite from ${message.author.tag}: ${message.content}`, 0xFF0000, message.author);
            
            // Add warning for invite violation
            await addWarning(message.author, message.guild, 'Discord invite violation', message.member);
        }
    }
    
    // Mass mention detection (@everyone, @here, and multiple role mentions)
    if (data.enabledFeatures.massMentionProtection) {
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
            
            await logAction('MASS_MENTION_WARNING', `Warned ${message.author.tag} for mass mentioning`, 0xFFA500, message.author);
        }
    }
});

// Slash Commands
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isCommand()) return;
    
    const { commandName, options } = interaction;
    
    // Special handling for whitelist command - only allow specific users
    if (commandName === 'whitelist' || commandName === 'immune') {
        // Check if user is one of the authorized users
        if (!config.authorizedUsers.includes(interaction.user.id)) {
            await interaction.reply({ 
                content: '❌ You are not authorized to use this command.', 
                ephemeral: true 
            });
            await logAction('UNAUTHORIZED_COMMAND', `${interaction.user.tag} attempted to use /${commandName} without authorization`, 0xFF0000, interaction.user);
            return;
        }
    }
    
    // For all other commands, use the existing permission check
    if (commandName !== 'whitelist' && commandName !== 'immune') {
        // Check if user is authorized to use commands (existing logic)
        if (!config.adminIds.includes(interaction.user.id) && !interaction.member.roles.cache.has(config.ticketViewerRoleId)) {
            await interaction.reply({ 
                content: '❌ You are not authorized to use this command.', 
                ephemeral: true 
            });
            return;
        }
    }
    
    if (commandName === 'whitelist') {
        const user = options.getUser('user');
        if (user) {
            const success = await addToWhitelist(user.id, interaction.user.id);
            
            if (success) {
                const embed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle('✅ User Whitelisted')
                    .setDescription(`${user.tag} has been added to the whitelist.`)
                    .setTimestamp();
                    
                await interaction.reply({ embeds: [embed] });
                await logAction('WHITELIST_ADD', `${interaction.user.tag} whitelisted ${user.tag}`, 0x00FF00, interaction.user);
            } else {
                await interaction.reply({ 
                    content: '❌ Failed to whitelist user.', 
                    ephemeral: true 
                });
            }
        }
    }
    
    if (commandName === 'unwhitelist') {
        const user = options.getUser('user');
        if (user) {
            const success = await removeFromWhitelist(user.id);
            
            if (success) {
                const embed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('❌ User Unwhitelisted')
                    .setDescription(`${user.tag} has been removed from the whitelist.`)
                    .setTimestamp();
                    
                await interaction.reply({ embeds: [embed] });
                await logAction('WHITELIST_REMOVE', `${interaction.user.tag} unwhitelisted ${user.tag}`, 0xFF0000, interaction.user);
            } else {
                await interaction.reply({ 
                    content: '❌ Failed to unwhitelist user.', 
                    ephemeral: true 
                });
            }
        }
    }
    
    if (commandName === 'immune') {
        const user = options.getUser('user');
        const reason = options.getString('reason') || 'No reason provided';
        
        if (user) {
            const success = await addToImmune(user.id, interaction.user.id, reason);
            
            if (success) {
                const embed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle('✅ User Made Immune')
                    .setDescription(`${user.tag} is now immune to warnings.`)
                    .addFields(
                        { name: 'Reason', value: reason, inline: true },
                        { name: 'Added By', value: interaction.user.tag, inline: true }
                    )
                    .setTimestamp();
                    
                await interaction.reply({ embeds: [embed] });
                await logAction('IMMUNE_ADD', `${interaction.user.tag} made ${user.tag} immune to warnings`, 0x00FF00, interaction.user);
            } else {
                await interaction.reply({ 
                    content: '❌ Failed to make user immune.', 
                    ephemeral: true 
                });
            }
        }
    }
    
    if (commandName === 'unimmune') {
        const user = options.getUser('user');
        
        if (user) {
            const success = await removeFromImmune(user.id);
            
            if (success) {
                const embed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('❌ Immunity Removed')
                    .setDescription(`${user.tag} is no longer immune to warnings.`)
                    .addFields(
                        { name: 'Removed By', value: interaction.user.tag, inline: true }
                    )
                    .setTimestamp();
                    
                await interaction.reply({ embeds: [embed] });
                await logAction('IMMUNE_REMOVE', `${interaction.user.tag} removed immunity from ${user.tag}`, 0xFF0000, interaction.user);
            } else {
                await interaction.reply({ 
                    content: '❌ Failed to remove immunity.', 
                    ephemeral: true 
                });
            }
        }
    }
    
    if (commandName === 'warn') {
        const user = options.getUser('user');
        const reason = options.getString('reason');
        
        if (user && reason) {
            // Check if trying to warn self
            if (user.id === interaction.user.id) {
                await interaction.reply({ 
                    content: '❌ You cannot warn yourself.', 
                    ephemeral: true 
                });
                return;
            }
            
            // Check if trying to warn a bot
            if (user.bot) {
                await interaction.reply({ 
                    content: '❌ You cannot warn bots.', 
                    ephemeral: true 
                });
                return;
            }
            
            // Check if user is immune
            if (await isImmune(user.id)) {
                const immuneEmbed = new EmbedBuilder()
                    .setColor(0xFFFF00)
                    .setTitle('🛡️ Immune User')
                    .setDescription(`${user.tag} is immune to warnings and cannot be warned.`)
                    .addFields(
                        { name: 'User', value: `${user} (${user.tag})`, inline: true },
                        { name: 'Moderator', value: `${interaction.user}`, inline: true },
                        { name: 'Attempted Reason', value: reason, inline: false }
                    )
                    .setThumbnail(user.displayAvatarURL())
                    .setFooter({ text: `User ID: ${user.id}` })
                    .setTimestamp();
                
                await interaction.reply({ embeds: [immuneEmbed] });
                await logAction('IMMUNE_BLOCK', `${interaction.user.tag} attempted to warn immune user ${user.tag}`, 0xFFFF00, interaction.user);
                return;
            }
            
            // Check if user is whitelisted
            if (await isWhitelisted(user.id)) {
                await interaction.reply({ 
                    content: '❌ This user is whitelisted and cannot be warned.', 
                    ephemeral: true 
                });
                return;
            }
            
            const { warnings, warningId } = await addWarning(user, interaction.guild, reason, interaction.member);
            
            if (warnings === -1) {
                // This should not happen as we already checked for immunity, but just in case
                const immuneEmbed = new EmbedBuilder()
                    .setColor(0xFFFF00)
                    .setTitle('🛡️ Immune User')
                    .setDescription(`${user.tag} is immune to warnings and cannot be warned.`)
                    .setThumbnail(user.displayAvatarURL())
                    .setFooter({ text: `User ID: ${user.id}` })
                    .setTimestamp();
                
                await interaction.reply({ embeds: [immuneEmbed] });
                return;
            }
            
            if (warnings > 0) {
                // Create a beautiful warning embed
                const warnEmbed = new EmbedBuilder()
                    .setColor(0xFFA500)
                    .setTitle('⚠️ Warning Issued')
                    .setDescription(`A warning has been issued to ${user.tag}`)
                    .addFields(
                        { name: 'User', value: `${user} (${user.tag})`, inline: true },
                        { name: 'Moderator', value: `${interaction.user}`, inline: true },
                        { name: 'Warning ID', value: `\`${warningId}\``, inline: true },
                        { name: 'Reason', value: reason, inline: false },
                        { name: 'Total Warnings', value: `${warnings}/3`, inline: true },
                        { name: 'Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
                        { name: 'Next Action', value: warnings >= 3 ? 'Kick from server' : 'Warning', inline: true }
                    )
                    .setThumbnail(user.displayAvatarURL())
                    .setFooter({ text: `User ID: ${user.id}` })
                    .setTimestamp();
                
                await interaction.reply({ embeds: [warnEmbed] });
                await logAction('WARNING_ISSUED', `${interaction.user.tag} warned ${user.tag} for: ${reason} (Total: ${warnings}/3)`, 0xFFA500, interaction.user);
                
                // If user reached 3 warnings and was kicked
                if (warnings >= 3) {
                    const kickEmbed = new EmbedBuilder()
                        .setColor(0xFF0000)
                        .setTitle('🚫 Member Kicked')
                        .setDescription(`${user.tag} has been kicked for accumulating 3 warnings`)
                        .addFields(
                            { name: 'User', value: `${user} (${user.tag})`, inline: true },
                            { name: 'Moderator', value: `${interaction.user}`, inline: true },
                            { name: 'Reason', value: 'Excessive warnings (3/3)', inline: true },
                            { name: 'Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                        )
                        .setThumbnail(user.displayAvatarURL())
                        .setFooter({ text: `User ID: ${user.id}` })
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
    
    if (commandName === 'enable') {
        const feature = options.getString('feature');
        if (feature === 'link-blocking') {
            data.enabledFeatures.linkBlocking = true;
            
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ Link Blocking Enabled')
                .setDescription('Link blocking feature has been enabled.')
                .setTimestamp();
                
            await interaction.reply({ embeds: [embed] });
            await logAction('FEATURE_ENABLE', `${interaction.user.tag} enabled link-blocking`, 0x00FF00, interaction.user);
        } else if (feature === 'security-mode') {
            data.enabledFeatures.securityMode = true;
            
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ Security Mode Enabled')
                .setDescription('Security mode has been enabled.')
                .setTimestamp();
                
            await interaction.reply({ embeds: [embed] });
            await logAction('FEATURE_ENABLE', `${interaction.user.tag} enabled security-mode`, 0x00FF00, interaction.user);
        } else if (feature === 'anti-spam') {
            data.enabledFeatures.antiSpam = true;
            
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ Anti-Spam Enabled')
                .setDescription('Anti-spam feature has been enabled.')
                .setTimestamp();
                
            await interaction.reply({ embeds: [embed] });
            await logAction('FEATURE_ENABLE', `${interaction.user.tag} enabled anti-spam`, 0x00FF00, interaction.user);
        } else if (feature === 'anti-raid') {
            data.enabledFeatures.antiRaid = true;
            
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ Anti-Raid Enabled')
                .setDescription('Anti-raid feature has been enabled.')
                .setTimestamp();
                
            await interaction.reply({ embeds: [embed] });
            await logAction('FEATURE_ENABLE', `${interaction.user.tag} enabled anti-raid`, 0x00FF00, interaction.user);
        } else if (feature === 'mass-mention-protection') {
            data.enabledFeatures.massMentionProtection = true;
            
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ Mass Mention Protection Enabled')
                .setDescription('Mass mention protection feature has been enabled.')
                .setTimestamp();
                
            await interaction.reply({ embeds: [embed] });
            await logAction('FEATURE_ENABLE', `${interaction.user.tag} enabled mass-mention-protection`, 0x00FF00, interaction.user);
        } else if (feature === 'invite-protection') {
            data.enabledFeatures.inviteProtection = true;
            
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ Invite Protection Enabled')
                .setDescription('Invite protection feature has been enabled.')
                .setTimestamp();
                
            await interaction.reply({ embeds: [embed] });
            await logAction('FEATURE_ENABLE', `${interaction.user.tag} enabled invite-protection`, 0x00FF00, interaction.user);
        }
    }
    
    if (commandName === 'disable') {
        const feature = options.getString('feature');
        if (feature === 'link-blocking') {
            data.enabledFeatures.linkBlocking = false;
            
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Link Blocking Disabled')
                .setDescription('Link blocking feature has been disabled.')
                .setTimestamp();
                
            await interaction.reply({ embeds: [embed] });
            await logAction('FEATURE_DISABLE', `${interaction.user.tag} disabled link-blocking`, 0xFF0000, interaction.user);
        } else if (feature === 'security-mode') {
            data.enabledFeatures.securityMode = false;
            
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Security Mode Disabled')
                .setDescription('Security mode has been disabled.')
                .setTimestamp();
                
            await interaction.reply({ embeds: [embed] });
            await logAction('FEATURE_DISABLE', `${interaction.user.tag} disabled security-mode`, 0xFF0000, interaction.user);
        } else if (feature === 'anti-spam') {
            data.enabledFeatures.antiSpam = false;
            
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Anti-Spam Disabled')
                .setDescription('Anti-spam feature has been disabled.')
                .setTimestamp();
                
            await interaction.reply({ embeds: [embed] });
            await logAction('FEATURE_DISABLE', `${interaction.user.tag} disabled anti-spam`, 0xFF0000, interaction.user);
        } else if (feature === 'anti-raid') {
            data.enabledFeatures.antiRaid = false;
            
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Anti-Raid Disabled')
                .setDescription('Anti-raid feature has been disabled.')
                .setTimestamp();
                
            await interaction.reply({ embeds: [embed] });
            await logAction('FEATURE_DISABLE', `${interaction.user.tag} disabled anti-raid`, 0xFF0000, interaction.user);
        } else if (feature === 'mass-mention-protection') {
            data.enabledFeatures.massMentionProtection = false;
            
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Mass Mention Protection Disabled')
                .setDescription('Mass mention protection feature has been disabled.')
                .setTimestamp();
                
            await interaction.reply({ embeds: [embed] });
            await logAction('FEATURE_DISABLE', `${interaction.user.tag} disabled mass-mention-protection`, 0xFF0000, interaction.user);
        } else if (feature === 'invite-protection') {
            data.enabledFeatures.inviteProtection = false;
            
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Invite Protection Disabled')
                .setDescription('Invite protection feature has been disabled.')
                .setTimestamp();
                
            await interaction.reply({ embeds: [embed] });
            await logAction('FEATURE_DISABLE', `${interaction.user.tag} disabled invite-protection`, 0xFF0000, interaction.user);
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
        await logAction('TICKET_SETUP', `${interaction.user.tag} setup ticket panel`, 0x00FF00, interaction.user);
    }
    
    if (commandName === 'security_status') {
        const whitelistedUsers = await Whitelist.countDocuments();
        const immuneUsers = await Immune.countDocuments();
        const totalWarnings = await Warning.countDocuments();
        
        const statusEmbed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle('🛡️ Security Status')
            .addFields(
                { name: 'Link Blocking', value: data.enabledFeatures.linkBlocking ? '✅ Enabled' : '❌ Disabled', inline: true },
                { name: 'Security Mode', value: data.enabledFeatures.securityMode ? '✅ Enabled' : '❌ Disabled', inline: true },
                { name: 'Anti-Spam', value: data.enabledFeatures.antiSpam ? '✅ Enabled' : '❌ Disabled', inline: true },
                { name: 'Anti-Raid', value: data.enabledFeatures.antiRaid ? '✅ Enabled' : '❌ Disabled', inline: true },
                { name: 'Mass Mention Protection', value: data.enabledFeatures.massMentionProtection ? '✅ Enabled' : '❌ Disabled', inline: true },
                { name: 'Invite Protection', value: data.enabledFeatures.inviteProtection ? '✅ Enabled' : '❌ Disabled', inline: true },
                { name: 'Whitelisted Users', value: whitelistedUsers.toString(), inline: true },
                { name: 'Immune Users', value: immuneUsers.toString(), inline: true },
                { name: 'Total Warnings', value: totalWarnings.toString(), inline: true }
            )
            .setTimestamp();
            
        await interaction.reply({ embeds: [statusEmbed] });
    }
    
    if (commandName === 'clear_warnings') {
        const user = options.getUser('user');
        if (user) {
            const success = await clearWarnings(user.id, interaction.guild.id);
            
            if (success) {
                const embed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle('✅ Warnings Cleared')
                    .setDescription(`Cleared all warnings for ${user.tag}`)
                    .addFields(
                        { name: 'User', value: `${user} (${user.tag})`, inline: true },
                        { name: 'Moderator', value: `${interaction.user}`, inline: true },
                        { name: 'Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                    )
                    .setThumbnail(user.displayAvatarURL())
                    .setFooter({ text: `User ID: ${user.id}` })
                    .setTimestamp();
                    
                await interaction.reply({ embeds: [embed] });
                await logAction('WARNINGS_CLEARED', `${interaction.user.tag} cleared warnings for ${user.tag}`, 0x00FF00, interaction.user);
            } else {
                await interaction.reply({ 
                    content: '❌ Failed to clear warnings.', 
                    ephemeral: true 
                });
            }
        }
    }
    
    if (commandName === 'view_warnings') {
        const user = options.getUser('user') || interaction.user;
        
        const warnings = await getWarnings(user.id, interaction.guild.id);
        
        if (warnings.length === 0) {
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ No Warnings')
                .setDescription(`${user.tag} has no warnings.`)
                .setThumbnail(user.displayAvatarURL())
                .setFooter({ text: `User ID: ${user.id}` })
                .setTimestamp();
                
            await interaction.reply({ embeds: [embed] });
            return;
        }
        
        const warningList = warnings.slice(0, 10).map((w, i) => 
            `**${i+1}.** ${w.reason} - <t:${Math.floor(w.timestamp.getTime() / 1000)}:R> (ID: \`${w.warningId}\`)`
        ).join('\n');
        
        const embed = new EmbedBuilder()
            .setColor(0xFFA500)
            .setTitle(`⚠️ Warnings for ${user.tag}`)
            .setDescription(warningList)
            .addFields(
                { name: 'Total Warnings', value: warnings.length.toString(), inline: true },
                { name: 'Next Action', value: warnings.length >= 3 ? 'Kick from server' : 'Warning', inline: true }
            )
            .setThumbnail(user.displayAvatarURL())
            .setFooter({ text: `User ID: ${user.id} | Showing ${Math.min(warnings.length, 10)} of ${warnings.length} warnings` })
            .setTimestamp();
            
        await interaction.reply({ embeds: [embed] });
    }
    
    if (commandName === 'remove_warning') {
        const warningId = options.getString('warning_id');
        
        if (warningId) {
            const success = await removeWarning(warningId, interaction.guild.id);
            
            if (success) {
                const embed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle('✅ Warning Removed')
                    .setDescription(`Successfully removed warning with ID: \`${warningId}\``)
                    .addFields(
                        { name: 'Moderator', value: `${interaction.user}`, inline: true },
                        { name: 'Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                    )
                    .setTimestamp();
                    
                await interaction.reply({ embeds: [embed] });
                await logAction('WARNING_REMOVED', `${interaction.user.tag} removed warning with ID: ${warningId}`, 0x00FF00, interaction.user);
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
                .setDescription(`${interaction.user}, :wave: hey! welcome to **Team Jupiter**, the ultimate gaming experience!\nWe hope you enjoy your stay and have an amazing time here. Make sure to check out the community and get involved!\n\n:sword: **Team Jupiter**`)
                .setThumbnail(interaction.user.displayAvatarURL())
                .setImage('https://images-ext-1.discordapp.net/external/1vFDeXmdRWn_3XIfN2wncqUh5FRIRmfPmXOPiczCvRw/https/i.pinimg.com/736x/a9/eb/a3/a9eba3be002462632df36598cf737e53.jpg?format=webp&width=828&height=466')
                .setFooter({ text: `Member #${interaction.guild.memberCount}`, iconURL: interaction.guild.iconURL() })
                .setTimestamp();
                
            await interaction.reply({ 
                content: `**Welcome Message Preview:**`, 
                embeds: [welcomeEmbed] 
            });
            
            await logAction('WELCOME_TEST', `${interaction.user.tag} tested the welcome message`, 0x00FF00, interaction.user);
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
    
    if (commandName === 'setup_roles') {
        await interaction.deferReply();
        
        const mentionRole = await setupMentionRole(interaction.guild);
        const securityRole = await setupSecurityRole(interaction.guild);
        
        await updateChannelPermissions(interaction.guild, mentionRole);
        
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('✅ Roles Setup Complete')
            .setDescription('Security roles have been configured successfully.')
            .addFields(
                { name: 'Mention Role', value: mentionRole ? mentionRole.toString() : 'Error', inline: true },
                { name: 'Security Role', value: securityRole ? securityRole.toString() : 'Error', inline: true }
            )
            .setTimestamp();
            
        await interaction.editReply({ embeds: [embed] });
        await logAction('ROLES_SETUP', `${interaction.user.tag} setup security roles`, 0x00FF00, interaction.user);
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
});

// Register slash commands for a specific guild
client.on(Events.ClientReady, async () => {
    console.log(`✅ Logged in as ${client.user.tag}!`);
    
    // Set bot status
    client.user.setActivity('Team Jupiter', { type: 'WATCHING' });
    
    // Setup security roles
    if (config.guildId) {
        try {
            const guild = client.guilds.cache.get(config.guildId);
            if (guild) {
                await setupMentionRole(guild);
                await setupSecurityRole(guild);
                console.log('Security roles setup complete');
            }
        } catch (error) {
            console.error('Error setting up security roles:', error);
        }
    }
    
    // Delete all old commands for the specific guild
    if (config.guildId) {
        try {
            const guild = client.guilds.cache.get(config.guildId);
            if (guild) {
                // Get all commands for this guild
                const commands = await guild.commands.fetch();
                
                // Delete all existing commands
                for (const command of commands.values()) {
                    await guild.commands.delete(command.id);
                    console.log(`Deleted command: ${command.name}`);
                }
                
                console.log('All old commands deleted for guild:', guild.name);
            }
        } catch (error) {
            console.error('Error deleting old commands:', error);
        }
    }
    
    // Register new commands for the specific guild
    const commands = [
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
            name: 'enable',
            description: 'Enable a feature',
            options: [
                {
                    name: 'feature',
                    type: 3,
                    description: 'The feature to enable',
                    required: true,
                    choices: [
                        {
                            name: 'link-blocking',
                            value: 'link-blocking'
                        },
                        {
                            name: 'security-mode',
                            value: 'security-mode'
                        },
                        {
                            name: 'anti-spam',
                            value: 'anti-spam'
                        },
                        {
                            name: 'anti-raid',
                            value: 'anti-raid'
                        },
                        {
                            name: 'mass-mention-protection',
                            value: 'mass-mention-protection'
                        },
                        {
                            name: 'invite-protection',
                            value: 'invite-protection'
                        }
                    ]
                }
            ]
        },
        {
            name: 'disable',
            description: 'Disable a feature',
            options: [
                {
                    name: 'feature',
                    type: 3,
                    description: 'The feature to disable',
                    required: true,
                    choices: [
                        {
                            name: 'link-blocking',
                            value: 'link-blocking'
                        },
                        {
                            name: 'security-mode',
                            value: 'security-mode'
                        },
                        {
                            name: 'anti-spam',
                            value: 'anti-spam'
                        },
                        {
                            name: 'anti-raid',
                            value: 'anti-raid'
                        },
                        {
                            name: 'mass-mention-protection',
                            value: 'mass-mention-protection'
                        },
                        {
                            name: 'invite-protection',
                            value: 'invite-protection'
                        }
                    ]
                }
            ]
        },
        {
            name: 'setup_tickets',
            description: 'Setup the ticket panel'
        },
        {
            name: 'security_status',
            description: 'Check the current security status'
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
        },
        {
            name: 'setup_roles',
            description: 'Setup security roles and permissions'
        }
    ];
    
    try {
        if (config.guildId) {
            // Register commands for a specific guild
            const guild = client.guilds.cache.get(config.guildId);
            if (guild) {
                await guild.commands.set(commands);
                console.log(`✅ Slash commands registered for guild: ${guild.name}`);
            } else {
                console.error('❌ Guild not found with ID:', config.guildId);
                // Fallback to global commands if guild not found
                await client.application.commands.set(commands);
                console.log('✅ Slash commands registered globally (fallback)');
            }
        } else {
            // Register commands globally if no guild ID is specified
            await client.application.commands.set(commands);
            console.log('✅ Slash commands registered globally');
        }
    } catch (error) {
        console.error('❌ Error registering commands:', error);
    }
    
    await logAction('BOT_READY', `Bot is online as ${client.user.tag}`, 0x00FF00);
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
if (!config.botToken) {
    console.error('❌ Bot token not found in .env file');
    process.exit(1);
}

client.login(config.botToken);
