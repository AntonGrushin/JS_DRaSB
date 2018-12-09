/*********************************************************************
 *     JAVASCRIPT DISCORD RECORDER AND SOUNDBOARD BOT - JS DRaSB
 *
 *  This is a JavaScript Node.js Discord bot based on discord.js library
 *  that is meant to perform automatic recording of a discord channel
 *  and play music/sounds as a soundboard or a playlist bot.
 *
 *  DRaSB is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License version 3.
 *
 *  JS_DRaSB Copyright 2018 - Anton Grushin
 *
 *-=--=--=--=--=--=--=--=--=--=--=--=--=--=--=--=--=--=--=--=--=--=--=
 *        bot.js
 *    Main bot executable.
 *********************************************************************/
const Discord = require('discord.js');
const client = new Discord.Client();
const ytdl = require('ytdl-core');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');

//Load bot parts
const config = require('./config.js');
const utils = require('./utils.js');
var db = require('./database.js');

//technical variables
var BotReady = false; //This turns true when we are connected to Discord server
var LastChannelChangeTimeMs = Date.now(); //Time in ms when we did last channel change so we can wait until new join to stop command flooding
var ChannelWaitingToJoin = null;

//Send a message to a channel function
function sendMessage(channel, message) {
	if (BotReady && message.length > 0)
		if (client.channels.get(channel))
			client.channels.get(channel).send(message)
				.catch(error => {
					utils.report("Couldn't send a message to channel '" + channel + "'. Error: " + error, 'r');
				});
}

//Return amount of members in a voice channel (excluding bots)
function countChannelMembers(channel) {
	if (channel)
		return channel.members.filter(member => !member.user.bot).size;
	else
		return 0;
}

//Destroy all voice recievers
function recieversDestroy() {
	//ForEach voiceConnection (this is Collection, so using 'tap')
	client.voiceConnections.tap(connection => {
		if (config.logging.ConsoleReport.ChannelJoiningLeaving) utils.report("Leaving channel '" + connection.channel.name + "'!", 'g', config.logging.LogFileReport.ChannelJoiningLeaving);
		connection.channel.leave();
		/*connection.disconnect();
		connection.on('disconnect', () => {
			if (config.logging.ConsoleReport.RecordDebugMessages) utils.report("Successfully disconnected from '" + connection.channel.name + "' channel!", 'c', config.logging.LogFileReport.RecordDebugMessages); //debug message
		});*/
		//ForEach VoiceReciever (this is Array, so using 'forEach')
		connection.receivers.forEach(receiver => {
			/*receiver.destroy();
			if (receiver.destroyed) {
				if (config.logging.ConsoleReport.RecordDebugMessages) utils.report("Destroying voice reciever of '" + connection.channel.name + "' channel: Success!", 'c', config.logging.LogFileReport.RecordDebugMessages); //debug message
			}
			else {
				utils.report("Couldn't destroy voice reciever of '" + connection.channel.name + "' channel.", 'r')
			};*/
		});
	});
}

//Start recording on currently connected channel
function startRecording(connection) {
	//For some reason in order to recieve any incoming voice data from other members we need to send something first, therefore we are sending a very short sound and start the recording right after
	const dispatcher = connection.playFile(path.resolve(__dirname, config.folders.Sounds, '00_empty.mp3'));

	dispatcher.on('end', () => {
		//console.log('Finished playing!');
		dispatcher.destroy(); // end the stream
		utils.report("Starting recording of '" + connection.channel.name + "' channel.", 'g')

		const receiver = connection.createReceiver();
		connection.on('speaking', (user, speaking) => {
			//console.log(user.username, 'speaking:', speaking);

			if (speaking) {

				//const audioStream = receiver.createOpusStream(user);
				const audioStream = receiver.createPCMStream(user);
				let chunkCount = 0;
				let totalStreamSize = 0;
				let fileTimeNow = utils.fileTimeNow();
				//let durationMs = 0;
				let tempfile = path.resolve(__dirname, config.folders.Temp, fileTimeNow + '_' + utils.cutFillString(user.username, 25));
				const writable = fs.createWriteStream(tempfile + '.pcm');
				//const writable = fs.createWriteStream('/root/soundBoardFalanor/recorded.mp3');

				audioStream.on('data', (chunk) => {
					//console.log(`Received ${chunk.length} bytes of data.`)
					chunkCount++;
					totalStreamSize += chunk.length;
				});
				//Write the data to the temp file
				audioStream.pipe(writable);

				audioStream.on('end', () => {

					//Get file size and calculate duration
					//let filesize = fs.statSync(tempfile + '.pcm').size;
					//let duration = Math.round(filesize / 191.3136729);
					//Each chunk is 20 ms
					let durationMs = chunkCount * 20;
					if (config.logging.ConsoleReport.RecordDebugMessages) utils.report("Got " + chunkCount + " chunks with total size of " + totalStreamSize + " bytes from user '" + user.username + "'.", 'c', config.logging.LogFileReport.RecordDebugMessages); //debug message

					let outputFile = path.resolve(__dirname, config.folders.VoiceRecording, fileTimeNow + '_' + utils.cutFillString(user.id, 20) + '_' + utils.cutFillString(durationMs, 10, '0') + '_' + utils.cutFillString(user.username, 25) + '.mp3')
					ffmpeg(tempfile + '.pcm')
						//.inputOptions('-f s16le -ac 2 -ar 48000')
						//.fromFormat('s16le')
						.inputOptions([
							'-f', 's16le',
							'-ac', '2',
							'-ar', '48000'
						])
						.noVideo()
						.audioCodec('libmp3lame')
						.audioBitrate('128k')
						.on('error', function (err) {
							utils.report("ffmpeg reported error: " + err, 'r')
						})
						.on('end', function (stdout, stderr) {
							//console.log('Processing finished !: ' + stdout);
							if (config.logging.ConsoleReport.RecFilesSavedAndProcessed) utils.report("Saved recording of '" + user.username + "' with duration of " + durationMs +" ms (" + chunkCount + " chunks).", 'c', config.logging.LogFileReport.RecFilesSavedAndProcessed);
							fs.unlink(tempfile + '.pcm', err => {
								if (err) utils.report("Couldn't delete temp file '" + tempfile + "'. Error: " + err, 'r');
							});
						})
						.on('codecData', format => {
							//console.log('Codec data == Duration: ' + format['duration'] + ', Audio: ' + format['audio_details']);
							if (config.logging.ConsoleReport.RecordDebugMessages) utils.report("ffmpeg reports stream properties. Duration:" + format['duration'] + ", audio: " + format['audio_details'] + ".", 'c', config.logging.LogFileReport.RecordDebugMessages); //debug message
							//durationMs = Math.round(format['duration'] * 1000);
						})
						//.pipe(writable, { end: true });
						.output(outputFile)
						.run();
				});


			}
		});


	});
	dispatcher.on('error', error => utils.report("Couldn't play sound file '" + path.resolve(__dirname, config.folders.Sounds, '00_empty.mp3') + "' on'" + connection.channel.name + "' channel. Error: " + error, 'r'));
}

//Join voice channel actions
function joinVoiceChannel(channel) {
	//First, delete all previously created recievers if we have any
	recieversDestroy();

	//Join the channel
	channel.join()
		.then(connection => {
			if (config.logging.ConsoleReport.ChannelJoiningLeaving) utils.report("Joined channel '" + channel.name + "'!", 'g', config.logging.LogFileReport.ChannelJoiningLeaving);

			//If we have Voice Recording enabled, launch it
			if (config.EnableRecording)
				startRecording(connection);
		})
		.catch(error => utils.report("Couldn't join channel '" + channel.name + "'. Error: " + error, 'r'));
	//Actions performed, empty the queue
	LastChannelChangeTimeMs = Date.now();
	ChannelWaitingToJoin = null;
}

//Join voice channel queue function
//   We have channel that we want to join stored in 'ChannelWaitingToJoin', this is our joining 
//   queue (technically its not queue, only last channel since we dont need others but who cares).
//   We check time since last joining. If it passed, we join strait away if not, we delay the function.
//   If we dont do this and bot joins channels without waiting too quickly, we will get situation
//   when we technically didnt leave previous channel and still have recievers on it resulting in bot crash
//   due to VoiceConnection.authenticateFailed Error: Connection not established within 15 seconds
function joinVoiceChannelQueue(channel) {
	//if channel exists
	if (channel.name) {

		//If there is a channel in the queue, just reset the variable, command is queued, so dont run it again
		if (ChannelWaitingToJoin) {
			if (config.logging.ConsoleReport.ChannelDebugJoinQueue) utils.report("Channel join queue: There is a channel in the queue '" + ChannelWaitingToJoin.name + "', setting new channel: '" + channel.name+"'!", 'c', config.logging.LogFileReport.ChannelDebugJoinQueue); //debug message
			ChannelWaitingToJoin = channel;
		}
		else {
			let JoinHappendMsAgo = Date.now() - LastChannelChangeTimeMs;
			if (JoinHappendMsAgo >= config.ChannelJoiningQueueWaitTimeMs) {
				//We can run it without waiting
				if (config.logging.ConsoleReport.ChannelDebugJoinQueue) utils.report("Channel join queue: Joining '" + channel.name + "' channel without any delay!", 'c', config.logging.LogFileReport.ChannelDebugJoinQueue); //debug message
				joinVoiceChannel(channel);
			}
			else {
				//Delay joining
				ChannelWaitingToJoin = channel;
				if (config.logging.ConsoleReport.ChannelDebugJoinQueue) utils.report("Channel join queue: Delaying joining '" + ChannelWaitingToJoin.name + "' channel by " + Math.floor(config.ChannelJoiningQueueWaitTimeMs - JoinHappendMsAgo) + " ms!", 'c', config.logging.LogFileReport.ChannelDebugJoinQueue); //debug message
				setTimeout(() => joinVoiceChannel(ChannelWaitingToJoin), (config.ChannelJoiningQueueWaitTimeMs - JoinHappendMsAgo));
			}
		}
	}
}

client.on('ready', () => {
	//console.log(`Logged in as ${bot.user.tag}!`);
	utils.report('Logged in as ' + client.user.tag + '!', 'g');
	BotReady = true;
});
client.on('reconnecting', () => {
	utils.report("Trying to reconnect... ", 'y');
	BotReady = false;
});
client.on('error', error => {
	utils.report("Connection problem: " + error, 'y');
	//BotReady = false;
});
client.on('warn', error => utils.report("Warning: " + error, 'y'));

//Renew guild members on join and update (otherwise we have old names and non-existant members in client.guilds)
client.on('guildMemberAdd', member => {
	client.guilds.get(config.guildId).fetchMember(member.id)
		.then(() => {
			if (config.logging.ConsoleReport.MembersJoiningUpdating) utils.report("New Member joined: '" + member.user.username + "' (" + member.id + ")!", 'b', config.logging.LogFileReport.MembersJoiningUpdating);
		})
		.catch(error => utils.report("Couldn't fetch a new member '" + member.user.username +"'. Error: " + error, 'r'));
});
client.on('guildMemberUpdate', (OldMember, NewMember) => {
	client.guilds.get(config.guildId).fetchMember(NewMember.id)
		.then(() => {
			if (config.logging.ConsoleReport.MembersJoiningUpdating) utils.report("Member updated: '" + NewMember.user.username + "' (" + NewMember.id + ")!", 'b', config.logging.LogFileReport.MembersJoiningUpdating);
		})
		.catch(error => utils.report("Couldn't fetch a member update for '" + NewMember.user.username + "'. Error: " + error, 'r'));
});

//Check if bot should move to this channel or leave it if required amount of members in there is reached
client.on('voiceStateUpdate', (OldMember, NewMember) => {
	//react only to our guild events
	if (NewMember.guild.id == config.guildId || OldMember.guild.id == config.guildId) {
		if (NewMember.voiceChannel) {
			//Member joined a voice channel
			let ChannelMembersCount = countChannelMembers(NewMember.voiceChannel);
			if (ChannelMembersCount >= config.AutoJoinMembersAmount && config.AutoJoinTalkingRoom) {
				if (client.voiceConnections.size > 0 && config.SwitchVoiceRoomIfMoreMembers) {
					//Change the channel if it has more members than current one
					if (ChannelMembersCount > countChannelMembers(client.voiceConnections.first(1)[0].channel))
						joinVoiceChannelQueue(NewMember.voiceChannel);
				}
				else if (client.voiceConnections.size == 0)
					//If we dont have any active channel connections
					joinVoiceChannelQueue(NewMember.voiceChannel);

			}
			else if (ChannelMembersCount == 0 && config.AutoLeaveIfAlone) {
				//leave the channel if there is nobody left there and there is no ChannelJoin comman in the queue
				if (!ChannelWaitingToJoin)
					recieversDestroy();
			}
		}
		else {
			//Member left - leave the channel if its empty
			if (client.voiceConnections.first(1)[0])
				if (countChannelMembers(client.voiceConnections.first(1)[0].channel) == 0 && config.AutoLeaveIfAlone)
					//If there is no ChannelJoin comman in the queue
					if (!ChannelWaitingToJoin)
						recieversDestroy();
		}
	}
});

if (utils.checkFoldersExistance())
	client.login(config.token);





