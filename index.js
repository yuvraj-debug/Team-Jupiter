require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, ChannelType, Events, Collection, AuditLogEvent, Role } = require('discord.js');
const fs = require('fs');
const path = require('path');
const express = require('express');

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
    adminIds: ['1212047208673837087', '1202998273376522331'], // Admin user IDs
    ticketViewerRoleId: '1414824820901679155', // Role that can view open tickets
    mentionRoleName: 'Mention Permissions', // Role that allows mentioning @everyone and roles
    securityRoleName: 'Security Admin' // Role for security permissions
};

// Data storage
const data = {
    whitelistedUsers: new Set(),
    enabledFeatures: {
        linkBlocking: true,
        securityMode: true,
        antiSpam: true,
        antiRaid: true,
        antiNuke: true,
        massMentionProtection: true,
        inviteProtection: true
    },
    tickets: new Map(),
    recentDeletions: new Map(),
    deletedChannels: new Map(),
    warnedUsers: new Map(),
    userMessageCount: new Map(),
    userJoinTimestamps: new Map(),
    userInviteCount: new Map()
};

// Load data from file if exists
function loadData() {
    try {
        if (fs.existsSync('./data.json')) {
            const savedData = JSON.parse(fs.readFileSync('./data.json', 'utf8'));
            data.whitelistedUsers = new Set(savedData.whitelistedUsers || []);
            data.enabledFeatures = savedData.enabledFeatures || { 
                linkBlocking: true, 
                securityMode: true,
                antiSpam: true,
                antiRaid: true,
                antiNuke: true,
                massMentionProtection: true,
                inviteProtection: true
            };
            if (savedData.warnedUsers) {
                for (const [userId, warnings] of Object.entries(savedData.warnedUsers)) {
                    data.warnedUsers.set(userId, warnings);
                }
            }
        }
    } catch (error) {
        console.error('Error loading data:', error);
    }
}

// Save data to file
function saveData() {
    try {
        const warnedUsersObj = {};
        for (const [userId, warnings] of data.warnedUsers) {
            warnedUsersObj[userId] = warnings;
        }
        
        const saveData = {
            whitelistedUsers: Array.from(data.whitelistedUsers),
            enabledFeatures: data.enabledFeatures,
            warnedUsers: warnedUsersObj
        };
        
        fs.writeFileSync('./data.json', JSON.stringify(saveData, null, 2));
    } catch (error) {
        console.error('Error saving data:', error);
    }
}

// Initialize
loadData();

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
            const joinTimestamps = data.userJoinTimestamps.get(member.guild.id) || [];
            
            // Keep only joins from the last 10 seconds
            const recentJoins = joinTimestamps.filter(time => now - time < 10000);
            recentJoins.push(now);
            data.userJoinTimestamps.set(member.guild.id, recentJoins);
            
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

// Ticket System
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton()) return;
    
    // Ticket creation
    if (interaction.customId === 'general_support' || interaction.customId === 'team_apply' || interaction.customId === 'ally_merge') {
        try {
            // Check if user already has an open ticket
            let hasOpenTicket = false;
            for (const [channelId, ticket] of data.tickets) {
                if (ticket.creator === interaction.user.id && !ticket.closed) {
                    hasOpenTicket = true;
                    break;
                }
            }
            
            if (hasOpenTicket) {
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
                        PermissionsBitField.Flags.ReadMessageHistory
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
            
            // Store ticket info
            data.tickets.set(ticketChannel.id, {
                creator: interaction.user.id,
                type: ticketType,
                createdAt: new Date(),
                claimedBy: null,
                locked: false,
                closed: false,
                messages: []
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
    if (interaction.customId === 'claim_ticket' || interaction.customId === 'lock_ticket' || interaction.customId === 'delete_ticket') {
        const ticketData = data.tickets.get(interaction.channel.id);
        if (!ticketData) return;
        
        // Check if user has permission to manage tickets
        if (!config.adminIds.includes(interaction.user.id) && interaction.user.id !== ticketData.creator) {
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
            
            ticketData.claimedBy = interaction.user.id;
            data.tickets.set(interaction.channel.id, ticketData);
            
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
            
            ticketData.locked = true;
            data.tickets.set(interaction.channel.id, ticketData);
            
            await interaction.channel.permissionOverwrites.edit(ticketData.creator, {
                ViewChannel: true,
                SendMessages: false,
                ReadMessageHistory: true
            });
            
            // Add 🔒 emoji to the front of the channel name
            const currentName = interaction.channel.name;
            await interaction.channel.setName(`🔒 ${currentName.replace(/^(✅ |🔒 )/, '')}`);
            
            await interaction.reply(`🔒 Ticket locked by ${interaction.user}`);
            await logAction('TICKET_LOCK', `${interaction.user.tag} locked ticket in ${interaction.channel.name}`, 0xFFA500, interaction.user);
        }
        
        if (interaction.customId === 'delete_ticket') {
            // Mark ticket as closed before deletion
            ticketData.closed = true;
            data.tickets.set(interaction.channel.id, ticketData);
            
            // Create transcript before deletion
            const messages = await interaction.channel.messages.fetch();
            const transcript = messages.map(msg => 
                `[${msg.createdAt.toLocaleString()}] ${msg.author.tag} (${msg.author.id}): ${msg.content}${msg.attachments.size > 0 ? ` [Attachment: ${msg.attachments.first().name}]` : ''}`
            ).reverse().join('\n');
            
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
            } catch (error) {
                console.error('Could not send DM to user:', error);
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
            data.tickets.delete(interaction.channel.id);
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
            if (executor.bot || data.whitelistedUsers.has(executor.id)) return;
            
            // Track deletion attempts
            const now = Date.now();
            const userDeletions = data.recentDeletions.get(executor.id) || [];
            userDeletions.push(now);
            data.recentDeletions.set(executor.id, userDeletions.filter(time => now - time < 5000));
            
            // Check if user has made multiple deletions in short time
            const recentCount = data.recentDeletions.get(executor.id).length;
            
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
        
        if (entry && entry.executor && !data.whitelistedUsers.has(entry.executor.id) && !entry.executor.bot) {
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
        
        if (entry && entry.executor && !data.whitelistedUsers.has(entry.executor.id) && !entry.executor.bot) {
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
        
        if (entry && entry.executor && !data.whitelistedUsers.has(entry.executor.id) && !entry.executor.bot) {
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
        let userMessages = data.userMessageCount.get(userId) || [];
        
        // Filter messages from the last 5 seconds
        userMessages = userMessages.filter(time => now - time < 5000);
        userMessages.push(now);
        data.userMessageCount.set(userId, userMessages);
        
        // If user sent more than 5 messages in 5 seconds, mute them
        if (userMessages.length > 5) {
            try {
                const member = await message.guild.members.fetch(userId);
                
                // Timeout user for 5 minutes
                await member.timeout(5 * 60 * 1000, 'Spamming messages');
                
                await message.channel.send(`${message.author} has been muted for 5 minutes for spamming.`);
                await logAction('ANTI_SPAM', `Muted ${message.author.tag} for spamming (${userMessages.length} messages in 5 seconds)`, 0xFF0000, message.author);
                
                // Reset message count
                data.userMessageCount.delete(userId);
            } catch (error) {
                console.error('Error muting user for spam:', error);
            }
        }
    }
    
    // Link blocking
    if (data.enabledFeatures.linkBlocking) {
        const urlRegex = /https?:\/\/[^\s]+/g;
        if (urlRegex.test(message.content) && !data.whitelistedUsers.has(message.author.id)) {
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
            addWarning(message.author, message.guild, 'Link violation');
        }
    }
    
    // Invite link protection
    if (data.enabledFeatures.inviteProtection) {
        const inviteRegex = /(discord\.gg|discordapp\.com\/invite|discord\.com\/invite)\/[a-zA-Z0-9]+/g;
        if (inviteRegex.test(message.content) && !data.whitelistedUsers.has(message.author.id)) {
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
            addWarning(message.author, message.guild, 'Discord invite violation');
        }
    }
    
    // Mass mention detection (@everyone, @here, and multiple role mentions)
    if (data.enabledFeatures.massMentionProtection) {
        const mentionCount = (message.mentions.users.size + message.mentions.roles.size);
        const hasEveryone = message.mentions.everyone || message.mentions.here;
        
        if ((hasEveryone || mentionCount > 3) && !data.whitelistedUsers.has(message.author.id)) {
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
            addWarning(message.author, message.guild, 'Mass mention violation');
            
            await logAction('MASS_MENTION_WARNING', `Warned ${message.author.tag} for mass mentioning`, 0xFFA500, message.author);
        }
    }
});

// Warning system functions
async function addWarning(user, guild, reason) {
    const userId = user.id;
    const currentWarnings = data.warnedUsers.get(userId) || 0;
    const newWarnings = currentWarnings + 1;
    
    data.warnedUsers.set(userId, newWarnings);
    saveData();
    
    // Send warning DM
    try {
        const warningEmbed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('⚠️ Warning Issued')
            .setDescription(`You have received a warning in ${guild.name}`)
            .addFields(
                { name: 'Reason', value: reason, inline: true },
                { name: 'Total Warnings', value: `${newWarnings}/3`, inline: true },
                { name: 'Next Action', value: newWarnings >= 3 ? 'Kick from server' : 'Warning', inline: true }
            )
            .setTimestamp();
            
        await user.send({ embeds: [warningEmbed] });
    } catch (error) {
        console.error('Could not send DM to user:', error);
    }
    
    // Check if user has reached 3 warnings
    if (newWarnings >= 3) {
        try {
            const member = await guild.members.fetch(userId);
            await member.kick('Received 3 warnings');
            
            await logAction('MEMBER_KICKED', `Kicked ${user.tag} for receiving 3 warnings`, 0xFF0000, user);
            
            // Reset warnings after kick
            data.warnedUsers.delete(userId);
            saveData();
        } catch (error) {
            console.error('Failed to kick user:', error);
        }
    }
}

// Slash Commands
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isCommand()) return;
    
    // Check if user is authorized to use commands
    if (!config.adminIds.includes(interaction.user.id)) {
        await interaction.reply({ 
            content: '❌ You are not authorized to use this command.', 
            ephemeral: true 
        });
        return;
    }
    
    const { commandName, options } = interaction;
    
    if (commandName === 'whitelist') {
        const user = options.getUser('user');
        if (user) {
            data.whitelistedUsers.add(user.id);
            saveData();
            
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ User Whitelisted')
                .setDescription(`${user.tag} has been added to the whitelist.`)
                .setTimestamp();
                
            await interaction.reply({ embeds: [embed] });
            await logAction('WHITELIST_ADD', `${interaction.user.tag} whitelisted ${user.tag}`, 0x00FF00, interaction.user);
        }
    }
    
    if (commandName === 'unwhitelist') {
        const user = options.getUser('user');
        if (user) {
            data.whitelistedUsers.delete(user.id);
            saveData();
            
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ User Unwhitelisted')
                .setDescription(`${user.tag} has been removed from the whitelist.`)
                .setTimestamp();
                
            await interaction.reply({ embeds: [embed] });
            await logAction('WHITELIST_REMOVE', `${interaction.user.tag} unwhitelisted ${user.tag}`, 0xFF0000, interaction.user);
        }
    }
    
    if (commandName === 'enable') {
        const feature = options.getString('feature');
        if (feature === 'link-blocking') {
            data.enabledFeatures.linkBlocking = true;
            saveData();
            
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ Link Blocking Enabled')
                .setDescription('Link blocking feature has been enabled.')
                .setTimestamp();
                
            await interaction.reply({ embeds: [embed] });
            await logAction('FEATURE_ENABLE', `${interaction.user.tag} enabled link-blocking`, 0x00FF00, interaction.user);
        } else if (feature === 'security-mode') {
            data.enabledFeatures.securityMode = true;
            saveData();
            
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ Security Mode Enabled')
                .setDescription('Security mode has been enabled.')
                .setTimestamp();
                
            await interaction.reply({ embeds: [embed] });
            await logAction('FEATURE_ENABLE', `${interaction.user.tag} enabled security-mode`, 0x00FF00, interaction.user);
        } else if (feature === 'anti-spam') {
            data.enabledFeatures.antiSpam = true;
            saveData();
            
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ Anti-Spam Enabled')
                .setDescription('Anti-spam feature has been enabled.')
                .setTimestamp();
                
            await interaction.reply({ embeds: [embed] });
            await logAction('FEATURE_ENABLE', `${interaction.user.tag} enabled anti-spam`, 0x00FF00, interaction.user);
        } else if (feature === 'anti-raid') {
            data.enabledFeatures.antiRaid = true;
            saveData();
            
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ Anti-Raid Enabled')
                .setDescription('Anti-raid feature has been enabled.')
                .setTimestamp();
                
            await interaction.reply({ embeds: [embed] });
            await logAction('FEATURE_ENABLE', `${interaction.user.tag} enabled anti-raid`, 0x00FF00, interaction.user);
        } else if (feature === 'mass-mention-protection') {
            data.enabledFeatures.massMentionProtection = true;
            saveData();
            
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ Mass Mention Protection Enabled')
                .setDescription('Mass mention protection feature has been enabled.')
                .setTimestamp();
                
            await interaction.reply({ embeds: [embed] });
            await logAction('FEATURE_ENABLE', `${interaction.user.tag} enabled mass-mention-protection`, 0x00FF00, interaction.user);
        } else if (feature === 'invite-protection') {
            data.enabledFeatures.inviteProtection = true;
            saveData();
            
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
            saveData();
            
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Link Blocking Disabled')
                .setDescription('Link blocking feature has been disabled.')
                .setTimestamp();
                
            await interaction.reply({ embeds: [embed] });
            await logAction('FEATURE_DISABLE', `${interaction.user.tag} disabled link-blocking`, 0xFF0000, interaction.user);
        } else if (feature === 'security-mode') {
            data.enabledFeatures.securityMode = false;
            saveData();
            
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Security Mode Disabled')
                .setDescription('Security mode has been disabled.')
                .setTimestamp();
                
            await interaction.reply({ embeds: [embed] });
            await logAction('FEATURE_DISABLE', `${interaction.user.tag} disabled security-mode`, 0xFF0000, interaction.user);
        } else if (feature === 'anti-spam') {
            data.enabledFeatures.antiSpam = false;
            saveData();
            
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Anti-Spam Disabled')
                .setDescription('Anti-spam feature has been disabled.')
                .setTimestamp();
                
            await interaction.reply({ embeds: [embed] });
            await logAction('FEATURE_DISABLE', `${interaction.user.tag} disabled anti-spam`, 0xFF0000, interaction.user);
        } else if (feature === 'anti-raid') {
            data.enabledFeatures.antiRaid = false;
            saveData();
            
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Anti-Raid Disabled')
                .setDescription('Anti-raid feature has been disabled.')
                .setTimestamp();
                
            await interaction.reply({ embeds: [embed] });
            await logAction('FEATURE_DISABLE', `${interaction.user.tag} disabled anti-raid`, 0xFF0000, interaction.user);
        } else if (feature === 'mass-mention-protection') {
            data.enabledFeatures.massMentionProtection = false;
            saveData();
            
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Mass Mention Protection Disabled')
                .setDescription('Mass mention protection feature has been disabled.')
                .setTimestamp();
                
            await interaction.reply({ embeds: [embed] });
            await logAction('FEATURE_DISABLE', `${interaction.user.tag} disabled mass-mention-protection`, 0xFF0000, interaction.user);
        } else if (feature === 'invite-protection') {
            data.enabledFeatures.inviteProtection = false;
            saveData();
            
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
            .setFooter({ text: 'Elite Clan Support System', iconURL: interaction.guild.iconURL() })
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
                { name: 'Whitelisted Users', value: data.whitelistedUsers.size.toString(), inline: true },
                { name: 'Active Warnings', value: Array.from(data.warnedUsers.values()).reduce((a, b) => a + b, 0).toString(), inline: true }
            )
            .setTimestamp();
            
        await interaction.reply({ embeds: [statusEmbed] });
    }
    
    if (commandName === 'clear_warnings') {
        const user = options.getUser('user');
        if (user) {
            data.warnedUsers.delete(user.id);
            saveData();
            
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ Warnings Cleared')
                .setDescription(`Cleared warnings for ${user.tag}`)
                .setTimestamp();
                
            await interaction.reply({ embeds: [embed] });
            await logAction('WARNINGS_CLEARED', `${interaction.user.tag} cleared warnings for ${user.tag}`, 0x00FF00, interaction.user);
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
});

// Register slash commands for a specific guild
client.on(Events.ClientReady, async () => {
    console.log(`✅ Logged in as ${client.user.tag}!`);
    
    // Set bot status
    client.user.setActivity('Elite Clan', { type: 'WATCHING' });
    
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
  
  // Save data before exiting
  saveData();
  
  // Destroy client
  if (client && client.destroy) {
    client.destroy();
  }
  
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  
  // Save data before exiting
  saveData();
  
  // Destroy client
  if (client && client.destroy) {
    client.destroy();
  }
  
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
    // Save data before crashing
    saveData();
    process.exit(1);
});

// Login
if (!config.botToken) {
    console.error('❌ Bot token not found in .env file');
    process.exit(1);
}

client.login(config.botToken);