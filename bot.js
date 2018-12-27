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
 *
 *        bot.js
 *    Main bot executable.
 *********************************************************************/
const Discord = require('discord.js');
const client = new Discord.Client();
const ytdl = require('ytdl-core');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const https = require('https');

//Load bot parts
const config = require('./config.js');
const utils = require('./utils.js');
var db = require('./database.js');

//technical variables
var BotReady = false; //This turns true when we are connected to Discord server
var LastChannelChangeTimeMs = Date.now(); //Time in ms when we did last channel change so we can wait until new join to stop command flooding
var ChannelWaitingToJoin = null;
var PlayingQueue = [];
var PausingThePlayback = false;
var CurrentPlayingSound = {};
var CurrentVolume = 0.0;

var soundIsPlaying = false;
var PreparingToPlaySound = false;
var LastPlaybackTime = Date.now();

// =============== HELPER FUNCTIONS ===============

//Return user tag or nam depending on PlaybackStatusMessagesTagPeople option
function getUserTagName(user) {
	if (config.PlaybackStatusMessagesTagPeople)
		return "<@" + user.id + ">";
	else {
		let output = getUserName(user);
		return (output != false ? output : "");
	}
}

//Get the name of the User if he is part of the guild or false if he is not
function getUserName(User) {
	let member = client.guilds.get(config.guildId).members.get(User.id);
	if (member) {
		if (member.nickname)
			return member.nickname;
		else
			return User.username;
	}
	else {
		return false;
	}
}

//Return 's' if number is greather than 1
function addS(number) {
	if (number > 1)
		return "s";
	else
		return "";
}

//Convert time in seconds to human readabale format
function humanTime(seconds) {
	let numdays = Math.floor(seconds / 86400);
	let numhours = Math.floor(seconds / 3600);
	let numminutes = Math.floor(seconds / 60);
	if (numdays)
		return numdays + " day" + addS(numdays);
	else if (numhours)
		return numhours + " hour" + addS(numhours);
	else if (numminutes)
		return numminutes + " minute" + addS(numminutes);
	else
		return Math.floor(seconds) + " second" + addS(seconds);

}

//Get total duration of the queue
function getQueueDuration() {
	let totalDuration = 0;
	for (i in PlayingQueue) {
		if (PlayingQueue[i]['duration']) {
			totalDuration += PlayingQueue[i]['duration'];
			if (PlayingQueue[i]['played'])
				totalDuration -= PlayingQueue[i]['played'] / 1000;
		}
	}
	return totalDuration;
}

//Calculate volume value using global config and personal volume level, inputs percentage 0.0-100.0, outputs 0.0-1.0
function calcVolumeToSet(personalVol) {
	//config.VolumeBotGlobal - this is considered 100% volume
	return (personalVol * (config.VolumeBotGlobal / 100)) / 100;
}

//Return amount of members in a voice channel (excluding bots)
function countChannelMembers(channel) {
	if (channel)
		return channel.members.filter(member => !member.user.bot).size;
	else
		return 0;
}

//Send Informational message on a channel
function sendInfoMessage(message, channel, user = null) {
	if (BotReady && message.length > 0) {
		utils.report("InfoMessage: " + (user != null ? user.username + ", " : "") + message, 'c');
		let channelToSendTo = channel;
		if (config.RestrictCommandsToSingleChannel && channel.type != "dm")
			channelToSendTo = client.channels.get(config.ReportChannelId);
		if (channelToSendTo) {
			channelToSendTo.send((user != null ? "<@" + user.id + ">, " : "") + message)
				.then(sentMsg => {
					if (config.InfoMessagesDelete) {
						setTimeout(() => {
							sentMsg.delete()
								.catch(error => utils.report("Couldn't delete informational message on channel '" + channel.name + "'. Error: " + error, 'r'));
						}, config.InfoMessagedDeleteTimeout * 1000);
					}
				})
				.catch(error => utils.report("Couldn't send a message to channel '" + channel.name + "'. Error: " + error, 'r'));
		}
		else
			utils.report("'ReportChannelId' that you specified in the config file is not avaliable to the bot! Can't send messages there.", 'r');
	}
}

//Send Playback Status message
function playbackMessage(message) {
	utils.report("Playback: " + message, 'g');
	channelToSendTo = client.channels.get(config.ReportChannelId);
	if (config.PlaybackStatusMessagesSend) {
		if (channelToSendTo) {
			channelToSendTo.send(message)
				.catch(error => utils.report("Couldn't send a message to channel '" + channelToSendTo.name + "'. Error: " + error, 'r'));
		}
		else
			utils.report("'ReportChannelId' that you specified in the config file is not avaliable to the bot! Can't send messages there.", 'r');
	}
}

//Return voiceChannel from a Member or return current voice channel that bot is on right now
function getVoiceChannel(Member) {
	if (Member.voiceChannel)
		return Member.voiceChannel;
	else
		return client.voiceConnections.array()[0].channel;
}

// =============== SOUND FUNCTIONS ===============

//Destroy all voice recievers
function recieversDestroy() {
	//ForEach voiceConnection (this is Collection, so using 'tap')
	client.voiceConnections.tap(connection => {
		if (config.logging.ConsoleReport.ChannelJoiningLeaving) utils.report("Leaving channel '" + connection.channel.name + "'!", 'g', config.logging.LogFileReport.ChannelJoiningLeaving);
		connection.channel.leave();
	});
}

//Start recording on currently connected channel
function startRecording(connection) {
	return new Promise((resolve, reject) => {
		//For some reason in order to recieve any incoming voice data from other members we need to send something first, therefore we are sending a very short sound and start the recording right after
		const dispatcher = connection.playFile(path.resolve(__dirname, config.folders.Sounds, '00_empty.mp3'));

		dispatcher.on('end', () => {
			utils.report("Starting recording of '" + connection.channel.name + "' channel.", 'g')

			const receiver = connection.createReceiver();
			connection.on('speaking', (user, speaking) => {
				if (speaking) {

					const audioStream = receiver.createPCMStream(user);
					let chunkCount = 0;
					let totalStreamSize = 0;
					let fileTimeNow = utils.fileTimeNow();
					let tempfile = path.resolve(__dirname, config.folders.Temp, fileTimeNow + '_' + utils.sanitizeFilename(user.username));
					const writable = fs.createWriteStream(tempfile + '.pcm');

					audioStream.on('data', (chunk) => {
						chunkCount++;
						totalStreamSize += chunk.length;
					});
					//Write the data to the temp file
					audioStream.pipe(writable);

					audioStream.on('end', () => {
						
						//Each chunk is 20 ms
						let durationMs = chunkCount * 20;
						if (config.logging.ConsoleReport.RecordDebugMessages) utils.report("Got " + chunkCount + " chunks with total size of " + totalStreamSize + " bytes from user '" + user.username + "'.", 'c', config.logging.LogFileReport.RecordDebugMessages); //debug message

						let outputFile = path.resolve(__dirname, config.folders.VoiceRecording, fileTimeNow + '_' + utils.cutFillString(user.id, 20) + '_' + utils.cutFillString(durationMs, 10, '0') + '_' + utils.sanitizeFilename(user.username) + '.' + config.RecordingAudioContainer)
						ffmpeg(tempfile + '.pcm')
							.inputOptions([
								'-f', 's16le',
								'-ac', '2',
								'-ar', '48000'
							])
							.noVideo()
							.audioCodec(config.RecordingAudioCodec)
							.audioBitrate(config.RecordingAudioBitrate)
							.on('error', function (err) {
								utils.report("ffmpeg reported error: " + err, 'r')
							})
							.on('end', function (stdout, stderr) {
								if (config.logging.ConsoleReport.RecFilesSavedAndProcessed) utils.report("Saved recording of '" + user.username + "' with duration of " + durationMs + " ms (" + chunkCount + " chunks).", 'c', config.logging.LogFileReport.RecFilesSavedAndProcessed);
								fs.unlink(tempfile + '.pcm', err => {
									if (err) utils.report("Couldn't delete temp file '" + tempfile + "'. Error: " + err, 'r');
								});
							})
							.on('codecData', format => {
								if (config.logging.ConsoleReport.RecordDebugMessages) utils.report("ffmpeg reports stream properties. Duration:" + format['duration'] + ", audio: " + format['audio_details'] + ".", 'c', config.logging.LogFileReport.RecordDebugMessages); //debug message
							})
							.output(outputFile)
							.run();
					});
				}
			});

			return resolve(dispatcher);
		});
		dispatcher.on('error', error => utils.report("Couldn't play sound file '" + path.resolve(__dirname, config.folders.Sounds, '00_empty.mp3') + "' on'" + connection.channel.name + "' channel. Error: " + error, 'r'));
		
	});
}

//Join voice channel actions
function joinVoiceChannel(channel) {
	return new Promise((resolve, reject) => {
		//First, delete all previously created recievers if we have any
		recieversDestroy();

		//Join the channel
		channel.join()
			.then(connection => {
				if (config.logging.ConsoleReport.ChannelJoiningLeaving) utils.report("Joined channel '" + channel.name + "'!", 'g', config.logging.LogFileReport.ChannelJoiningLeaving);

				//If we have Voice Recording enabled, launch it
				if (config.EnableRecording) {
					startRecording(connection)
						.then(() => { return resolve(connection); });
				}

				//Actions performed, empty the queue
				LastChannelChangeTimeMs = Date.now();
				ChannelWaitingToJoin = null;

				
			})
			.catch(error => {
				utils.report("Couldn't join channel '" + channel.name + "'. Error: " + error, 'r');
				return reject(error);
			});
		//Actions performed, empty the queue
		LastChannelChangeTimeMs = Date.now();
		ChannelWaitingToJoin = null;
	});
}

//Join voice channel queue function
//   We have channel that we want to join stored in 'ChannelWaitingToJoin', this is our joining 
//   queue (technically its not queue, only last channel since we dont need others but who cares).
//   We check time since last joining. If it passed, we join strait away if not, we delay the function.
//   If we dont do this and bot joins channels without waiting too quickly, we will get situation
//   when we technically didnt leave previous channel and still have recievers on it resulting in bot crash
//   due to VoiceConnection.authenticateFailed Error: Connection not established within 15 seconds
function joinVoiceChannelQueue(channel) {
	return new Promise((resolve, reject) => {
		//if channel exists
		if (channel.name) {

			//If there is a channel in the queue, just reset the variable, command is queued, so dont run it again
			if (ChannelWaitingToJoin) {
				if (config.logging.ConsoleReport.ChannelDebugJoinQueue) utils.report("Channel join queue: There is a channel in the queue '" + ChannelWaitingToJoin.name + "', setting new channel: '" + channel.name + "'!", 'c', config.logging.LogFileReport.ChannelDebugJoinQueue); //debug message
				ChannelWaitingToJoin = channel;
				//Return Promise in expected time of channel changing plus 100ms
				// todo: find a better solution for this, this is a very nasty way:
				// it will return resolve() even if joining operation failed
				setTimeout(() => {
					if (client.voiceConnections.size > 0)
						return resolve(client.voiceConnections.array()[0]);
					throw new Error("Couldn't join channel in given time. Try again.")
				}, (config.ChannelJoiningQueueWaitTimeMs - (Date.now() - LastChannelChangeTimeMs) + 100));
			}
			else {
				let JoinHappendMsAgo = Date.now() - LastChannelChangeTimeMs;
				if (JoinHappendMsAgo >= config.ChannelJoiningQueueWaitTimeMs) {
					//We can run it without waiting
					if (config.logging.ConsoleReport.ChannelDebugJoinQueue) utils.report("Channel join queue: Joining '" + channel.name + "' channel without any delay!", 'c', config.logging.LogFileReport.ChannelDebugJoinQueue); //debug message
					joinVoiceChannel(channel)
						.then((connection) => { return resolve(connection); })
						.catch(error => { return reject(error); });
				}
				else {
					//Delay joining
					ChannelWaitingToJoin = channel;
					if (config.logging.ConsoleReport.ChannelDebugJoinQueue) utils.report("Channel join queue: Delaying joining '" + ChannelWaitingToJoin.name + "' channel by " + Math.floor(config.ChannelJoiningQueueWaitTimeMs - JoinHappendMsAgo) + " ms!", 'c', config.logging.LogFileReport.ChannelDebugJoinQueue); //debug message
					setTimeout(() => {
						joinVoiceChannel(ChannelWaitingToJoin)
							.then((connection) => { return resolve(connection); })
							.catch(error => { return reject(error); });
					}, (config.ChannelJoiningQueueWaitTimeMs - JoinHappendMsAgo));
				}
			}
		}
	});
}

//Check if we are on the channel, if we are - do nothing, if not - join it
function checkChannelJoin(channel) {
	return new Promise((resolve, reject) => {
		let haveConnection = false;
		if (client.voiceConnections.size > 0) {
			haveConnection = true;
			return resolve(client.voiceConnections.array()[0]);
		}
		//No connection found, create new one
		if (channel) {
			if (!haveConnection) {
				joinVoiceChannelQueue(channel)
					.then((connection) => { return resolve(connection); })
					.catch(error => { return reject(error); });
			}
		}
		else
			throw new Error("Join a voice channel first!")
	});
}

//Set current volume level to desired value
function setVolume(volume, iterations, time) {
	if (client.voiceConnections.size > 0) {
		let volDelta = (volume - CurrentVolume) / iterations;
		volumeIterate(client.voiceConnections.array()[0].dispatcher, iterations, Math.floor(time / iterations), volDelta, CurrentVolume);
		CurrentVolume = volume;
	}
}

//Smoothly change the volume by iterations with a wait period
function volumeIterate(dispatcher, itLeft, waitperiod, volumeChange, volumeNow) {
	if (itLeft > 0) {
		let newVolume = volumeNow + volumeChange;
		//console.log("VolumeIteration: # " + itLeft + ", waitPeriod: " + waitperiod+" ms,volumeChange: " + volumeChange + ", newVolumeSet: " + newVolume); //Debug
		dispatcher.setVolume(newVolume);
		CurrentVolume = newVolume;
		setTimeout(() => {
			volumeIterate(dispatcher, itLeft - 1, waitperiod, volumeChange, newVolume);
		}, waitperiod);
	}
}

//Add sound to the playing queue
function addToQueue(soundToPlay, method = 'append') {
	//Append to the end of the queue
	if (method == 'append') {
		PlayingQueue.push(soundToPlay);
	}
	//Add as first element in the queue shifting all others
	else {
		PlayingQueue.unshift(soundToPlay);
	}
}

//Attach event listener to connection dispatcher when playback starts
function attachEventsOnPlayback(connection) {
	//What to do in the end of the playback
	connection.dispatcher.on('end', (reason) => {
		if (config.logging.ConsoleReport.SoundsPlaybackDebug) utils.report("Finished playing! Reason: " + reason.replace(/(\r\n\t|\n|\r\t)/gm, ""), 'c', config.logging.LogFileReport.SoundsPlaybackDebug); //debug message
		soundIsPlaying = false;
		handleQueue(reason);
		LastPlaybackTime = Date.now();
	});
	connection.dispatcher.on('start', () => {
		if (config.logging.ConsoleReport.DelayDebug) utils.report(utils.msCount("Playback", 'reset') + " Started playing!.", 'c', config.logging.LogFileReport.DelayDebug); //debug message
		if (config.logging.ConsoleReport.SoundsPlaybackDebug) utils.report("Started playing!", 'c', config.logging.LogFileReport.SoundsPlaybackDebug); //debug message
		PreparingToPlaySound = false;
		soundIsPlaying = true;
	});
	connection.dispatcher.on('error', (error) => {
		if (config.logging.ConsoleReport.DelayDebug) utils.report(utils.msCount("Playback", 'reset') + " Error playing!.", 'c', config.logging.LogFileReport.DelayDebug); //debug message
		utils.report('Dispatcher error while playing the file: ' + error, 'r');
		PreparingToPlaySound = false;
		soundIsPlaying = false;
		LastPlaybackTime = Date.now();
	});
}

//Playing next sound in the queue
function playQueue(connection) {
	if (config.logging.ConsoleReport.SoundsPlaybackDebug) utils.report("playQueue PASSED!", 'c', config.logging.LogFileReport.SoundsPlaybackDebug); //debug message
	if (!PreparingToPlaySound) {
		PreparingToPlaySound = true;
		if (config.logging.ConsoleReport.SoundsPlaybackDebug) utils.report("PreparingToPlaySound PASSED", 'c', config.logging.LogFileReport.SoundsPlaybackDebug); //debug message
			//First we check if we are on a channel
		if (connection.channel) {
			if (config.logging.ConsoleReport.SoundsPlaybackDebug) utils.report("connection.channel PASSED", 'c', config.logging.LogFileReport.SoundsPlaybackDebug); //debug message
				//If nothing is playing and there is still somethign in the queue
			if (!soundIsPlaying && PlayingQueue.length > 0) {
				if (config.logging.ConsoleReport.SoundsPlaybackDebug) utils.report("soundIsPlaying PASSED", 'c', config.logging.LogFileReport.SoundsPlaybackDebug); //debug message
				//Get next sound from the queue
				let inputObject = PlayingQueue.shift();
				if (inputObject.type == 'file') {
					if (config.logging.ConsoleReport.SoundsPlaybackDebug) utils.report("inputObject.type PASSED", 'c', config.logging.LogFileReport.SoundsPlaybackDebug); //debug message
					CurrentPlayingSound = { 'type': 'file', 'path': path.resolve(__dirname, config.folders.Sounds, inputObject.filename + db.getSoundExtension(inputObject.filename)), 'filename': inputObject.filename, 'duration': db.getSoundDuration(inputObject.filename), 'bitrate': db.getSoundBitrate(inputObject.filename), 'user': inputObject.user };
					if (inputObject.played) CurrentPlayingSound['played'] = inputObject.played;
					CurrentVolume = calcVolumeToSet(db.getUserVolume(inputObject.user.id));
					let PlaybackOptions = { 'volume': CurrentVolume, 'passes': config.VoicePacketPasses, 'bitrate': 'auto' };
					if (inputObject.played) PlaybackOptions['seek'] = inputObject.played / 1000;
					if (config.logging.ConsoleReport.DelayDebug) utils.report(utils.msCount("Playback") + " Creating File dispatcher...", 'c', config.logging.LogFileReport.DelayDebug); //debug message
					let dispatcher = connection.playFile(path.resolve(__dirname, config.folders.Sounds, inputObject.filename + db.getSoundExtension(inputObject.filename)), PlaybackOptions);

					playbackMessage(":musical_note: Playing file `" + CurrentPlayingSound.filename + "`, duration " + humanTime(CurrentPlayingSound.duration) + ". Requested by " + getUserTagName(CurrentPlayingSound.user) + "." + (inputObject.played ? " Resuming from " + Math.round(inputObject.played / 1000) + " second!" : ""));
					//Attach event listeners
					attachEventsOnPlayback(connection);
				}
				else if (inputObject.type == 'youtube') {
					let YtOptions = { quality: 'highestaudio' };
					let recievedInfo = false;
					if (config.UseAudioOnlyFilterForYoutube) YtOptions['filter'] = 'audioonly';
					//'begin' parameter should be greather than 6 seconds: https://github.com/fent/node-ytdl-core/issues/129
					// sometimes its not working
					if (inputObject.played && inputObject.played > 7000 && !config.UseAudioOnlyFilterForYoutube) YtOptions['begin'] = Math.floor(inputObject.played / 1000) + "s";
					if (config.logging.ConsoleReport.DelayDebug) utils.report(utils.msCount("Playback") + " creating stream... for '" + inputObject["link"]+"'", 'c', config.logging.LogFileReport.DelayDebug); //debug message
					//Create the stream
					let stream = ytdl(inputObject["link"], YtOptions)
					stream.on('info', (videoInfo, videoFormat) => {
						if (config.logging.ConsoleReport.DelayDebug) utils.report(utils.msCount("Playback") + " Recieved YouTube info message, creating dispatcher...", 'c', config.logging.LogFileReport.DelayDebug); //debug message
						CurrentPlayingSound = inputObject;
						CurrentPlayingSound.title = videoInfo['title'];
						CurrentPlayingSound.duration = videoInfo['length_seconds'];
						if (inputObject.played) CurrentPlayingSound['played'] = inputObject.played;
						CurrentVolume = calcVolumeToSet(db.getUserVolume(inputObject.user.id));
						let PlaybackOptions = { 'volume': CurrentVolume, 'passes': config.VoicePacketPasses, 'bitrate': 'auto' };
						if (inputObject.played && config.UseAudioOnlyFilterForYoutube) {
							if (inputObject.played / 1000 <= config.YoutubeResumeTimeLimit)
								PlaybackOptions['seek'] = inputObject.played / 1000;
							else
								PlaybackOptions['seek'] = config.YoutubeResumeTimeLimit;
						}
						let dispatcher = connection.playStream(stream, PlaybackOptions);
						playbackMessage(":musical_note: Playing Youtube `" + CurrentPlayingSound.title.substring(0, config.YoutubeTitleLengthLimit) + "` (duration " + humanTime(CurrentPlayingSound.duration) + "). Requested by " + getUserTagName(CurrentPlayingSound.user) + ". <" + CurrentPlayingSound.link + ">");
						//Attach event listeners
						attachEventsOnPlayback(connection);
						recievedInfo = true;
					});
					stream.on('error', error => {
						utils.report('Couldnt download video! Reason: ' + error, 'r');
					});
					//In case something goes wrong and we never get 'info' event, we need to set variables back to normal
					setTimeout(() => {
						if (!recievedInfo && PreparingToPlaySound)
							PreparingToPlaySound = false;
					}, config.YoutubeInfoResponceTimeoutMs);
				}
				else {
					utils.report('ERROR! InputObject is wrong format, skipping. Contents: ' + JSON.stringify(inputObject), 'r');
					PreparingToPlaySound = false;
				}
			}
			else {
				PreparingToPlaySound = false;
			}
		}
	}
}

//Stop or Pause the sound
function stopPlayback(connection, pauseTheFile = false) {
	//Stop it, but add to the queue to play later from same position
	if (pauseTheFile && CurrentPlayingSound) {
		let nowPlaying = CurrentPlayingSound;
		nowPlaying['played'] = CurrentPlayingSound.played ? connection.dispatcher.time + CurrentPlayingSound.played : connection.dispatcher.time;
		//End the dispatcher
		PlayingQueue.unshift(nowPlaying);
	}
	//End the playback
	if (connection.dispatcher) {
		if (connection.dispatcher.stream)
			connection.dispatcher.stream.destroy();
		connection.dispatcher.end();
	}
}

//Check if we need to launch next sound in the queue
function handleQueue(reason) {
	if (config.logging.ConsoleReport.DelayDebug) utils.report(utils.msCount("Playback", 'start') + " handleQueue() starting.", 'c', config.logging.LogFileReport.DelayDebug); //debug message
	if (!PreparingToPlaySound && !PausingThePlayback) {
		setTimeout(() => {
			if (config.logging.ConsoleReport.DelayDebug) utils.report(utils.msCount("Playback") + " playQueue() starting.", 'c', config.logging.LogFileReport.DelayDebug); //debug message
			if (client.voiceConnections.size > 0)
				playQueue(client.voiceConnections.array()[0]);
		}, (Date.now() - LastPlaybackTime >= config.SoundPlaybackWaitTimeMs ? 0 : config.SoundPlaybackWaitTimeMs - (Date.now() - LastPlaybackTime)));
	}
	if (PausingThePlayback)
		PausingThePlayback = false;
}

// =============== CLIENT EVENTS ===============

client.on('ready', () => {
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
		let userName = getUserName(NewMember.user)

		//Member joined a voice channel
		if (!(OldMember.voiceChannelID) && NewMember.voiceChannelID) {
			let ChannelMembersCount = countChannelMembers(NewMember.voiceChannel);
			if (config.logging.ConsoleReport.MembersJoinLeaveVoice) utils.report(userName + " joined '" + NewMember.voiceChannel.name + "' channel!", 'w', config.logging.LogFileReport.MembersJoinLeaveVoice);
			if (ChannelMembersCount >= config.AutoJoinMembersAmount && config.AutoJoinTalkingRoom) {
				if (config.logging.ConsoleReport.ChannelMembersCountDebug) utils.report("Members count: There are " + countChannelMembers(NewMember.voiceChannel) + " members in '" + NewMember.voiceChannel.name + "' channel now. (By config we join if >" + config.AutoJoinMembersAmount + ").", 'c', config.logging.LogFileReport.ChannelMembersCountDebug); //debug message

				if (client.voiceConnections.size > 0 && config.SwitchVoiceRoomIfMoreMembers) {
					//Change the channel if it has more members than current one
					if (countChannelMembers(NewMember.voiceChannel) > countChannelMembers(client.voiceConnections.first(1)[0].channel))
						joinVoiceChannelQueue(NewMember.voiceChannel);
				}
				else if (client.voiceConnections.size == 0)
					//If we dont have any active channel connections
					joinVoiceChannelQueue(NewMember.voiceChannel);

			}
		}
		//Member Left a voice channel
		else if (OldMember.voiceChannelID && !(NewMember.voiceChannelID)) {
			let ChannelMembersCount = countChannelMembers(OldMember.voiceChannel);
			let channel = OldMember.voiceChannel;
			if (config.logging.ConsoleReport.MembersJoinLeaveVoice) utils.report(userName + " left '" + OldMember.voiceChannel.name + "' channel!", 'w', config.logging.LogFileReport.MembersJoinLeaveVoice);
			//Leave the channel if its empty
			if (client.voiceConnections.array()[0]) {
				if (countChannelMembers(client.voiceConnections.array()[0].channel) == 0 && config.AutoLeaveIfAlone) {
					//If there is no ChannelJoin command in the queue
					if (!ChannelWaitingToJoin) {
						stopPlayback(client.voiceConnections.array()[0], false);
						recieversDestroy();
					}
				}

			}
		}
		//Member changed a voice channle
		else if (OldMember.voiceChannelID != NewMember.voiceChannelID && OldMember.voiceChannelID && NewMember.voiceChannelID) {
			if (config.logging.ConsoleReport.MembersJoinLeaveVoice) utils.report(userName + " switched to '" + NewMember.voiceChannel.name + "' channel!", 'w', config.logging.LogFileReport.MembersJoinLeaveVoice);
			if (client.voiceConnections.size > 0 && config.SwitchVoiceRoomIfMoreMembers) {
				//Change the channel if it has more members than current one
				if ((countChannelMembers(NewMember.voiceChannel) > countChannelMembers(client.voiceConnections.array()[0].channel) || countChannelMembers(client.voiceConnections.array()[0].channel) == 0) && NewMember.voiceChannel.id != client.voiceConnections.array()[0].channel.id)
					joinVoiceChannelQueue(NewMember.voiceChannel);
			}
			else if (client.voiceConnections.size == 0)
				//If we dont have any active channel connections
				joinVoiceChannelQueue(NewMember.voiceChannel);
		}
	}
});

//Login if everything is ready
if (utils.checkFoldersExistance()) {
	db.loadUsersDB();
	db.loadSoundsDB();
	db.scanSoundsFolder();
	client.login(config.token);
}

// =============== MESSAGE EVENTS ===============
client.on('message', async message => {
	let userName = getUserName(message.author)
	let guildMember = message.channel.type != "text" ? client.guilds.get(config.guildId).members.get(message.author.id) : message.member;
	if (userName) {
		//Only handle commands from our guild or direct messages from members of our guild
		if (message.channel.type != 'dm' && message.channel.guild) if (message.channel.guild.id != config.guildId) return;
			//If its a command
			if (message.content.substring(0, config.CommandCharacter.length) == config.CommandCharacter) {
				let args = message.content.substring(config.CommandCharacter.length).split(' ');
				let command = args[0];
				args = args.splice(1);

				if (config.RestrictCommandsToSingleChannel && message.channel.id == config.ReportChannelId || config.ReactToDMCommands && message.channel.type == 'dm' || !config.RestrictCommandsToSingleChannel) {
					utils.report("Command from " + userName + ": " + message.content.replace(/(\r\n\t|\n|\r\t)/gm, " "), 'm');

					switch (command) {
						case 'scan':
						case 'rescan':
							{
								if (config.EnableSoundboard) {
									//db.setUserVolume(message.author.id, args[0]);
									db.scanSoundsFolder();
									//message.reply("Incrementing playedCount!");
								}
								break;
							}
						case 'help':
							{
								//Send in private chat
								message.author.send("Help message")
								break;
							}
							break;
						//Give list of possible files to play
						case 'list':
						case 'files':
							{
								if (config.EnableSoundboard) {
									if (message.channel.type != "dm")
										sendInfoMessage("List sent in private!", message.channel)
									let found = db.findSound('', true).sort(function (a, b) {
										return a.localeCompare(b);
									});
									let resultList = "";
									for (i in found) {
										resultList += config.CommandCharacter + found[i] + "\n";
									}
									resultList = "This is the list of all avaliable sound files. Type any of the following commands or part of it to play the file: ```" + resultList + "```";
									message.author.send(resultList)
										.then(message => utils.report("Sent list of possible commands to '" + userName + "' user (" + message.author.id + ").", 'y'))
										.catch(error => utils.report("Error sending message to '" + userName + "' user (" + message.author.id + "). Reason: " + error, 'r'));
								}
								break;
							}
							break;
						//Summon bot to the voiceChannel
						case 'summon':
						case 'summonbot':
						case 'bot':
						case 'join':
							{
								if (guildMember.voiceChannel) {
									let playAfterRejoining = soundIsPlaying;
									if (client.voiceConnections.size > 0) {
										if (client.voiceConnections.array()[0].channel.id != guildMember.voiceChannel.id) {
											//Pause the playback if any
											if (soundIsPlaying && client.voiceConnections.size > 0) {
												PausingThePlayback = true;
												stopPlayback(client.voiceConnections.array()[0], true);

											}
										}
										else
											sendInfoMessage("I'm already on the channel! :angry:", message.channel, message.author);
									}
									//Join the channel
									checkChannelJoin(guildMember.voiceChannel)
										.then((connection) => {
											//Play the sound if there were any
											if (playAfterRejoining)
												handleQueue('PlayAfterRejoining');
										})
										//We couldnt join the channel, throw message on a log channel about it
										.catch(error => {
											utils.report("Couldn't join channel. Error: " + error, 'r');
											sendInfoMessage("I couldn't join your channel! :sob:", message.channel, message.author);
										});

								}
								else
									sendInfoMessage("Join a voice channel first!", message.channel, message.author);
								break;
							}
							break;
						//Play (if something was paused before)
						case 'play':
						case 'proceed':
							{
								if (config.EnableSoundboard) {
									if (!soundIsPlaying) {
										if (PlayingQueue.length > 0) {
											if (client.voiceConnections.size > 0) {
												handleQueue('PlayCommand');
												playbackMessage(":arrow_forward: Starting the queue (requested by " + getUserTagName(message.author) + ").");
											}
											else {
												sendInfoMessage("I dont know where to play. Use **" + config.CommandCharacter + "summon** command first!", message.channel, message.author);
											}
										}
										else {
											sendInfoMessage("There is nothing in the queue :sob:", message.channel, message.author);
										}

									}
									else {
										sendInfoMessage("Something is being played already! Use **" + config.CommandCharacter + "help** command to see instructions on how to use this bot.", message.channel, message.author);
									}
								}
								break;
							}
							break;
						//Pause the playback
						case 'pause':
						case 'hold':
						case 'wait':
							{
								if (soundIsPlaying && client.voiceConnections.size > 0) {
									PausingThePlayback = true;
									stopPlayback(client.voiceConnections.array()[0], true);
									playbackMessage(":pause_button: Playback paused (requested by " + getUserTagName(message.author) + ").");
								}
								break;
							}
							break;
						//Rejoin the channel (Leave and join again - sometimes people cant hear the bot, usually this helps)
						case 'rejoin':
						case 'resummon':
						case 'restart':
							{
								let playAfterRejoining = soundIsPlaying;
								if (guildMember.voiceChannel) {
									//First, pause any playback
									if (soundIsPlaying && client.voiceConnections.size > 0) {
										stopPlayback(client.voiceConnections.array()[0], true);
									}
									//Delete all voice connections first
									recieversDestroy();
									//Make sure wo wait before joining
									LastChannelChangeTimeMs = Date.now();
									//Join the channel again
									checkChannelJoin(guildMember.voiceChannel)
										.then((connection) => {
											utils.report("Successfully rejoined the channel '" + guildMember.voiceChannel.name + "' (requested by " + userName + ").", 'g');
											//Play the sound if there were any
											if (playAfterRejoining)
												handleQueue('PlayAfterRejoining');
										})
										//We couldnt join the channel, throw message on a log channel about it
										.catch(error => {
											utils.report("Couldn't join channel. Error: " + error, 'r');
										});
								}
								else
									sendInfoMessage("Join a voice channel first!", message.channel, message.author);
								break;
							}
							break;
						//Change the volume
						case 'v':
						case 'volume':
						case 'loudness':
						case 'vol':
							{
								if (config.EnableSoundboard) {
									let volumeToSet = 20;
									if (!isNaN(args[0]) && args[0] > 0 && args[0] <= 100)
										volumeToSet = args[0];
									//If sound is playing, change its volume
									if (soundIsPlaying) {
										let oldVolume = Math.round(CurrentVolume * 100 / (config.VolumeBotGlobal / 100));
										setVolume(calcVolumeToSet(volumeToSet), 100, 1000);
										playbackMessage(((volumeToSet > oldVolume) ? ":loud_sound:" : ":sound:") + " " + getUserTagName(message.author) + " changed volume from " + oldVolume + "% to " + volumeToSet + "%.");
									}
									else
										sendInfoMessage("Setting your personal volume to " + args[0] + "%! Old value was " + db.getUserVolume(message.author.id) + "%.", message.channel, message.author);
									//Set member's personal volume level to this amount
									db.setUserVolume(message.author.id, volumeToSet);
								}
								break;
							}
							break;
						//Stop the playback and clear the queue if there are any elements
						case 'stop':
						case 'cancel':
						case 'end':
							{
								if (config.EnableSoundboard) {
									let queueDuration = getQueueDuration();
									let queueElements = PlayingQueue.length;
									//Check if we have any voiceConnections
									if (client.voiceConnections.size > 0) {
										if (soundIsPlaying) {
											stopPlayback(client.voiceConnections.array()[0], false);
											utils.report(userName + " stopped the playback! (command: '" + message.content + "')" + (queueElements > 0 ? " There were " + queueElements + " records in the queue with total duration of " + humanTime(queueDuration) : ""), 'y');
											playbackMessage(":stop_button: Playback stopped by " + getUserTagName(message.author) + "." + (queueElements > 0 ? " There were " + queueElements + " records in the queue with total duration of " + humanTime(queueDuration) + "." : ""));
										}
										else {
											utils.report("Nothing is playing, clearing the queue." + (queueElements > 0 ? " There were " + queueElements + " records in the queue with total duration of " + humanTime(queueDuration) : ""), 'y');
										}
									}
									PlayingQueue = [];
								}
								break;
							}
							break;
						//Add element to the queue
						case 'q':
						case 'queue':
						case 'add':
						case 'append':
						case 'queueadd':
						case 'addnext':
							{
								if (config.EnableSoundboard) {
									//This is Youtube link
									if (ytdl.validateURL(args[0])) {
										ytdl.getBasicInfo(args[0], (err, info) => {
											if (err) {
												sendInfoMessage("Couldn't get video information from the link that you provided! Try other link.", message.channel, message.author);
												utils.report("ytdl.getBasicInfo failed, can't get youtube info from link: " + err, 'y');
											}
											else {
												playbackMessage(":arrow_right: " + getUserTagName(message.author) + " added Youtube link to the queue: `" + info['title'].substring(0, config.YoutubeTitleLengthLimit) + "` (duration " + humanTime(info['length_seconds']) + "). <" + args[0] + ">");
												//Create Queue element
												QueueElement = { 'type': 'youtube', 'link': args[0], 'title': info['title'], 'video_id': info['video_id'], 'user': guildMember, 'duration': info['length_seconds'], 'loudness': info['loudness'] };
												//Add to the queue
												PlayingQueue.push(QueueElement);
											}
										});
									}
									//This is probably a file
									else {
										let found = db.findSound(args[0]);
										if (found.length == 1 || (!config.StrictAudioCommands && found.length > 1)) {
											playbackMessage(":arrow_right: " + getUserTagName(message.author) + " added file to the queue: '" + found[0] + "' (duration " + humanTime(db.getSoundDuration(found[0])) + ").");

											//Sort the result first
											let foundOrdered = found.sort(function (a, b) {
												return a.localeCompare(b);
											})
											//Create Queue element
											QueueElement = { 'type': 'file', 'filename': foundOrdered[0], 'user': guildMember, 'duration': db.getSoundDuration(foundOrdered[0]) };
											//Add to the queue
											PlayingQueue.push(QueueElement);
										}
										else if (found.length > 1)
											sendInfoMessage("More than one result found!", message.channel, message.author);
										else
											sendInfoMessage("There is no file with such name!", message.channel, message.author);
									}
								}
								break;
							}
							break;
						//Play next element in the queue
						case 'skip':
						case 'next':
							{
								if (config.EnableSoundboard && soundIsPlaying && client.voiceConnections.size > 0) {
									if (PlayingQueue.length > 0)
										playbackMessage(":track_next: Playing next! (requested by " + getUserTagName(message.author) + ").");
									stopPlayback(client.voiceConnections.array()[0], false);
								}
								break;
							}
							break;
						//Youtube audio
						case 'yt':
						case 'youtube':
							{
								if (config.EnableSoundboard) {
									if (ytdl.validateURL(args[0])) {
										if (config.logging.ConsoleReport.DelayDebug) utils.report(utils.msCount("YouTubeCommand", 'start') + " Recieved command!", 'c', config.logging.LogFileReport.DelayDebug); //debug message
										if (guildMember.voiceChannel || client.voiceConnections.size) {
											checkChannelJoin(getVoiceChannel(guildMember))
												.then((connection) => {
													if (config.logging.ConsoleReport.DelayDebug) utils.report(utils.msCount("YouTubeCommand") + " Checked channel presence.", 'c', config.logging.LogFileReport.DelayDebug); //debug message
													//Create Queue element
													QueueElement = { 'type': 'youtube', 'link': args[0], 'user': guildMember };
													//If something is playing right now
													if (soundIsPlaying) {
														if (config.logging.ConsoleReport.DelayDebug) utils.report(utils.msCount("YouTubeCommand") + " Stopping playback.", 'c', config.logging.LogFileReport.DelayDebug); //debug message
														//Stop or pause the playback (depending on length of playing sound)
														stopPlayback(connection, (config.EnablePausingOfLongSounds && CurrentPlayingSound.duration >= config.LongSoundDuration));
														//Add to the front position in queue
														PlayingQueue.unshift(QueueElement);
														//Do not run handleQueue() here, since it will be run due to dispatcher.end Event after stopping the playback
													}
													//Nothing is playing right now
													else {
														if (config.logging.ConsoleReport.DelayDebug) utils.report(utils.msCount("YouTubeCommand", 'reset') + " Launching handleQueue().", 'c', config.logging.LogFileReport.DelayDebug); //debug message
														PlayingQueue.unshift(QueueElement);
														handleQueue('newSoundRequest');
													}
												})
												//We couldnt join the channel, throw message on a log channel about it
												.catch(error => {
													utils.report("Couldn't join channel. Error: " + error, 'r');
												});
										}
										else
											sendInfoMessage("Join a voice channel first!", message.channel, message.author);
									}
									else
										sendInfoMessage("This is not a valid Youtube link!", message.channel, message.author);
								}
								break;
							}
							break;
						default:
							{
								if (config.EnableSoundboard) {
									if (config.logging.ConsoleReport.DelayDebug) utils.report(utils.msCount("FileCommand", 'start') + " Recieved command!", 'c', config.logging.LogFileReport.DelayDebug); //debug message
									//Requested a local sound playback
									let found = db.findSound(command);
									if (found.length == 1 || (!config.StrictAudioCommands && found.length > 1)) {
										if (guildMember.voiceChannel || client.voiceConnections.size) {
											if (config.logging.ConsoleReport.DelayDebug) utils.report(utils.msCount("FileCommand") + " Found file!", 'c', config.logging.LogFileReport.DelayDebug); //debug message
											checkChannelJoin(getVoiceChannel(guildMember))
												.then((connection) => {
													if (config.logging.ConsoleReport.DelayDebug) utils.report(utils.msCount("FileCommand") + " Checked channel presence.", 'c', config.logging.LogFileReport.DelayDebug); //debug message
													//Sort the result first
													let foundOrdered = found.sort(function (a, b) {
														return a.localeCompare(b);
													});
													//Create Queue element
													QueueElement = { 'type': 'file', 'filename': foundOrdered[0], 'user': guildMember, 'duration': db.getSoundDuration(foundOrdered[0]) };

													//If something is playing right now
													if (soundIsPlaying) {
														if (config.logging.ConsoleReport.DelayDebug) utils.report(utils.msCount("FileCommand") + " Stopping playback!", 'c', config.logging.LogFileReport.DelayDebug); //debug message
														//Stop or pause the playback (depending on length of playing sound)
														stopPlayback(connection, (config.EnablePausingOfLongSounds && CurrentPlayingSound.duration >= config.LongSoundDuration && db.getSoundDuration(foundOrdered[0]) < config.LongSoundDuration));
														//Add to the front position in queue
														PlayingQueue.unshift(QueueElement);
														//Do not run handleQueue() here, since it will be run due to dispatcher.end Event after stopping the playback
													}
													//Nothing is playing right now
													else {
														if (config.logging.ConsoleReport.DelayDebug) utils.report(utils.msCount("FileCommand", 'reset') + " Launching handleQueue().", 'c', config.logging.LogFileReport.DelayDebug); //debug message
														PlayingQueue.unshift(QueueElement);
														handleQueue('newSoundRequest');
													}

												})
												//We couldnt join the channel, throw message on a log channel about it
												.catch(error => {
													utils.report("Couldn't join channel. Error: " + error, 'r');
												});
										}
										else
											sendInfoMessage("Join a voice channel first!", message.channel, message.author);
									}
									else if (found.length > 1)
										sendInfoMessage("More than one result found!", message.channel, message.author);
									else
										sendInfoMessage("Unknown command! Type **" + config.CommandCharacter + "help**" + (config.RestrictCommandsToSingleChannel ? " in the <#" + config.ReportChannelId + "> channel or in DM" : "") + " to see instructions on how to use this bot.", message.channel, message.author);
								}
								else
									sendInfoMessage("Unknown command! Type **" + config.CommandCharacter + "help**" + (config.RestrictCommandsToSingleChannel ? " in the <#" + config.ReportChannelId + "> channel or in DM" : "") + " to see instructions on how to use this bot.", message.channel, message.author);
							}
					}
				}
				else
					sendInfoMessage("I am reacting to commands on <#" + config.ReportChannelId + "> channel only!", message.channel, message.author);
				//Delete command sent by user
				if (config.DeleteUserCommands && message.channel.type != 'dm')
					message.delete()
						.catch(error => utils.report("Can't delete command message sent by " + userName + " on '" + message.channel.name + "' channel. Error: " + error, 'r'));
			}
			//If its a file sent in private
			if (message.channel.type == 'dm' && message.attachments.size > 0 && config.EnableSoundboard && config.AcceptDirectMessagesAudio) {
				console.log(message.attachments.array());
				let attachment = message.attachments.array()[0];
				utils.report(userName + " sent file '" + attachment.filename + "' of size " + Math.round(attachment.filesize / 1024) + " Kb.", 'm');
				if ((attachment.filesize / 1024 <= config.MessageAttachmentSizeLimitKb && config.MessageAttachmentSizeLimitKb > 0) || config.MessageAttachmentSizeLimitKb == 0) {
					//let targetFilename = attachment.filename.toLowerCase().replace(/[^a-z0-9_.]/g, '');
					let targetFilename = attachment.filename;
					let dest = path.resolve(__dirname, config.folders.Temp, targetFilename);
					let pathParse = path.parse(dest);
					let nameCleanNoExtension = pathParse.name.toLowerCase().replace(/[^a-z0-9_]/g, '');
					let nameClean = nameCleanNoExtension + pathParse.ext.toLowerCase();
					
					//let soundsDestination = path.resolve(__dirname, config.folders.Sounds, nameClean);
					if (!fs.existsSync(path.resolve(__dirname, config.folders.Sounds, nameClean))) {
						utils.report(userName + " sent file '" + attachment.filename + "' of size " + Math.round(attachment.filesize / 1024) + " Kb.", 'm');
						message.reply("Please, wait while I process the file...");
						let file = fs.createWriteStream(dest);
						let request = https.get(attachment.url, (response) => {
							response.pipe(file);
							file.on('finish', () => {
								file.close(() => {
									//Check if this file is a proper audio file
									utils.checkAudioFormat(dest)
										.then(result => {
											let destination = path.resolve(__dirname, config.folders.Sounds, nameClean);
											//If we found the proper format, no need to convert
											if (result['mode'] == "fits") {
												utils.moveFile(dest, path.resolve(__dirname, config.folders.Sounds, nameClean))
													.then(() => {
														message.reply("File added! Now you can play it using **" + config.CommandCharacter + nameCleanNoExtension + "** command.");
														db.scanSoundsFolder();
													})
													.catch(err => {
														message.reply("There was an error while performing server operations! Operation was not finished.");
													});
											}
											//If format did fit, but we need to remux it because of several streams
											else if (result['mode'] == "remux") {
												utils.report("Recieved file '" + attachment.filename + "' from " + userName + ". Duration " + result['metadata']['format']['duration'] + " s, streams: " + result['metadata']['streams'].length + ". Need remuxing...", 'y');
												let outputFile = path.resolve(__dirname, config.folders.Temp, "remux_" + nameClean)
												ffmpeg(dest)
													.outputOptions(['-map 0:' + result['remuxStreamToKeep']])
													.noVideo()
													.audioCodec("copy")
													.on('error', function (err) {
														utils.report("ffmpeg reported error: " + err, 'r');
														utils.deleteFile(dest);
														utils.deleteFile(outputFile);
													})
													.on('end', function (stdout, stderr) {
														utils.deleteFile(dest);
														utils.moveFile(outputFile, path.resolve(__dirname, config.folders.Sounds, nameClean))
															.then(() => {
																message.reply("File added! Now you can play it using **" + config.CommandCharacter + nameCleanNoExtension + "** command.");
																db.scanSoundsFolder();
															})
															.catch(err => {
																message.reply("There was an error while performing server operations! Operation was not finished.");
															});
													})
													.output(outputFile)
													.run();
											}
											//If format didnt fit but its an audio, convert it
											else if (result['mode'] == "convert") {
												//result['audioStream'] = lastAudioStream;
												utils.report("Recieved file '" + attachment.filename + "' from " + userName + ". Duration " + result['metadata']['duration'] + " s, format: '" + result['metadata']['streams'][0]['codec_name']+"', streams: " + result['metadata']['streams'].length + ". Converting...", 'y');
												let outputFile = path.resolve(__dirname, config.folders.Temp, nameCleanNoExtension + "." + config.ConvertUploadedAudioContainer)
												ffmpeg(dest)
													.outputOptions(['-map 0:' + result['audioStream']])
													.noVideo()
													.audioCodec(config.ConvertUploadedAudioCodec)
													.audioBitrate(config.ConvertUploadedAudioBitrate)
													.on('error', function (err) {
														utils.report("ffmpeg reported error: " + err, 'r');
														utils.deleteFile(dest);
														utils.deleteFile(outputFile);
													})
													.on('end', function (stdout, stderr) {
														utils.deleteFile(dest);
														utils.moveFile(outputFile, path.resolve(__dirname, config.folders.Sounds, nameCleanNoExtension + "." + config.ConvertUploadedAudioContainer))
															.then(() => {
																message.reply("File added! Now you can play it using **" + config.CommandCharacter + nameCleanNoExtension + "** command.");
																db.scanSoundsFolder();
															})
															.catch(err => {
																message.reply("There was an error while performing server operations! Operation was not finished.");
															});
													})
													.output(outputFile)
													.run();
											}
											//If we didnt find an audio, the file is not acceptable
											else {
												message.reply("Unknown file type. This is not an audio file.");
												utils.deleteFile(dest);
											}

											
										})
										.catch(err => {
											utils.report("Could't read file format. Error: " + err, 'r');
											message.reply("There was an error reading file's format. Looks like the file is corrupt.");
											fs.unlink(dest, err => {
												if (err)
													utils.report("Could't delete file '" + dest + "'. Error: " + err, 'r');
											});
										});
								});
							});
						}).on('error', function (err) { // Handle errors
							fs.unlink(dest); // Delete the file async. (But we don't check the result)
							utils.report("Couldn't download file! Error: " + err, 'r');
							message.reply("There was an error downloading the file that you sent. Please, try again.");
						});
					}
					else
						message.reply("File '" + nameClean + "' already exists, please rename the file and try again!");
				}
				else message.reply("This file is too big, it has to be less than " + config.MessageAttachmentSizeLimitKb + " Kb.");
			}
		
	}
	else if (message.channel.type == 'dm' || message.channel.type == 'group')
		utils.report("Direct message from user '" + message.author.username + "' (" + message.author.id + ") that is not part of the '" + client.guilds.get(config.guildId).name + "' guild: " + message.content, 'y');
});



