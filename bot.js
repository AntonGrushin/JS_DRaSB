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
var Discord = require('discord.js');
const ytdl = require('ytdl-core');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const https = require('https');
const client = new Discord.Client();
//var heapdump = require('heapdump');

//Load bot parts
const config = require('./config.js');
const utils = require('./utils.js');
var db = require('./database.js');

//Classes from DiscordJs for refreshing
const AudioPlayer = require('discord.js/src/client/voice/player/AudioPlayer');

//technical variables
var BotReady = false; //This turns true when we are connected to Discord server
var RecordsDBReady = false;
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
					if (config.InfoMessagesDelete && channelToSendTo.type != "dm") {
						setTimeout(() => {
							sentMsg.delete()
								.catch(error => utils.report("Couldn't delete informational message on channel '" + channelToSendTo.name + "'. Error: " + error, 'r'));
						}, config.InfoMessagedDeleteTimeout * 1000);
					}
				})
				.catch(error => utils.report("Couldn't send a message to channel '" + channelToSendTo.name + "'. Error: " + error, 'r'));
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
	let currConnection = getCurrentVoiceConnection();
	if (Member.voiceChannel)
		return Member.voiceChannel;
	else if (currConnection)
		return currConnection.channel;
	else
		return null;
}

function prepareForPlaybackOnChannel(guildMember, permissionLevel = {}, joinStrict = false) {
	return new Promise((resolve, reject) => {
		if (guildMember.voiceChannel || getCurrentVoiceConnection()) {
			if (getVoiceChannel(guildMember)) {
				checkChannelJoin(getVoiceChannel(guildMember))
					.then((connection) => { return resolve(connection); })
					.catch(error => {
						utils.report("Couldn't join channel. Error: " + error, 'r');
						return resolve(null);
					});
			}
			else {
				sendInfoMessage("I dont have permission to join that channel!", client.channels.get(config.ReportChannelId), guildMember.user);
				return resolve(null);
			}
		}
		else {
			sendInfoMessage("Join a voice channel first!", client.channels.get(config.ReportChannelId), guildMember.user);
			return resolve(null);
		}
	});
}

//Return true if guildmember has specified bit of permission
function checkPermission(guildmember, bit=31, channel=null) {
	let permission = 0;
	//We count bits from right to left
	//SummonBot:				0
	//DismissBot:				1
	//PlayFiles:				2
	//PlayYoutubeLinks:			3
	//UploadLocalAudioFiles:	4
	//DeleteLocalAudioFiles:	5
	//RecieveListOfLocalAudios	6
	//PauseResumeSkipPlayback	7
	//RejoinChannel				8
	//StopPlaybackClearQueue	9
	//RenameLocalAudioFiles		10
	//SetVolumeAbove100			11

	//If he is admin
	if (config.permissions.AdminsList.indexOf(guildmember.user.id) > -1)
		return true;
	//If member is in the Blacklist
	else if (config.permissions.BlackList.indexOf(guildmember.user.id) > -1)
		return false;
	//If Permission level is (Blacklist) or (Whitelist and Member has proper role)
	else if (config.permissions.PermissionsLevel == 0 || (config.permissions.PermissionsLevel == 1 && guildmember.roles.array().some(Role => { return config.permissions.UserRolesList.includes(Role.id) || config.permissions.UserRolesList.includes(Role.name); }))) {
		//Sum up permission bits
		permission += config.permissions.User.SummonBot << 0;
		permission += config.permissions.User.DismissBot << 1;
		permission += config.permissions.User.PlayFiles << 2;
		permission += config.permissions.User.PlayYoutubeLinks << 3;
		permission += config.permissions.User.UploadLocalAudioFiles << 4;
		permission += config.permissions.User.DeleteLocalAudioFiles << 5;
		permission += config.permissions.User.RecieveListOfLocalAudios << 6;
		permission += config.permissions.User.PauseResumeSkipPlayback << 7;
		permission += config.permissions.User.RejoinChannel << 8;
		permission += config.permissions.User.StopPlaybackClearQueue << 9;
		permission += config.permissions.User.RenameLocalAudioFiles << 10;
		permission += config.permissions.User.SetVolumeAbove100 << 11;
	}
	let result = (permission & (1 << bit)) > 0;
	if (!result)
		sendInfoMessage("You don't have permission for that! :pensive:", channel ? channel : client.channels.get(config.ReportChannelId), guildmember.user);
	return result;
}

//Recreate Audio Player to avoid buffer overloading and as a result delayed playback
function recreatePlayer(connection=null) {
	let foundConnection = null;
	if (connection)
		foundConnection = connection;
	else if (getCurrentVoiceConnection())
		foundConnection = getCurrentVoiceConnection();

	if (foundConnection) {
		delete foundConnection.player;
		foundConnection.player = new AudioPlayer(foundConnection);
	}
}

//Return current client voice connection or null if there is none
function getCurrentVoiceConnection() {
	if (client.voiceConnections ? client.voiceConnections.array().length > 0 : false)
		return client.voiceConnections.array()[0];
	else
		return null;
}

// =============== SOUND FUNCTIONS ===============

//Destroy all voice recievers
function recieversDestroy() {
	let connection = getCurrentVoiceConnection();
	if (connection) {
		if (config.logging.ConsoleReport.ChannelJoiningLeaving) utils.report("Leaving channel '" + connection.channel.name + "'!", 'g', config.logging.LogFileReport.ChannelJoiningLeaving);
		connection.channel.leave();
	}
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

					audioStream.on('data', (chunk) => {
						chunkCount++;
						totalStreamSize += chunk.length;
					});
					audioStream.on('end', () => {
						//Each chunk is 20 ms
						let durationMs = chunkCount * 20;
						if (config.logging.ConsoleReport.RecordDebugMessages) utils.report("Got " + chunkCount + " chunks with total size of " + totalStreamSize + " bytes from user '" + getUserName(user) + "'.", 'c', config.logging.LogFileReport.RecordDebugMessages); //debug message
					});

					let outTempFile = path.resolve(__dirname, config.folders.Temp, fileTimeNow.file + '_' + user.id + '_' + utils.sanitizeFilename(getUserName(user)) + '.' + config.RecordingAudioContainer);
					//let outTargetFile = 
					let outputStream = fs.createWriteStream(outTempFile);
					let FFcommand = ffmpeg(audioStream)
						.noVideo()
						.inputOptions([
							'-f', 's16le',
							'-ac', '2',
							'-ar', '48000'
						])
						.audioCodec(config.RecordingAudioCodec)
						.audioBitrate(config.RecordingAudioBitrate)
						.outputOption('-f', config.RecordingAudioContainer)
						.on('error', function (err) {
							utils.report("ffmpeg reported error: " + err, 'r')
							outputStream.close();
						})
						.on('end', function (stdout, stderr) {
							let durationMs = chunkCount * 20;
							//If duration is too small, do not save this file
							if (durationMs <= config.RecordingsDurationSkipThresholdMs) {
								fs.unlink(outTempFile, err => {
									if (err) utils.report("Couldn't delete temp file '" + outTempFile + "'. Error: " + err, 'r');
								});
							}
							else {
								let targetFile = path.resolve(__dirname, config.folders.VoiceRecording, fileTimeNow.file + '_' + user.id + '_' + durationMs + '_' + utils.sanitizeFilename(getUserName(user)) + '.' + config.RecordingAudioContainer);
								if (config.logging.ConsoleReport.RecFilesSavedAndProcessed) utils.report("Saved recording of '" + user.username + "' with duration of " + durationMs + " ms (" + chunkCount + " chunks).", 'c', config.logging.LogFileReport.RecFilesSavedAndProcessed);
								//Remux the file without encoding, so it has 'duration' metadata
								ffmpeg(outTempFile)
									.audioCodec('copy')
									.on('end', (stdout, stderr) => {
										fs.unlink(outTempFile, err => {
											if (err) utils.report("Couldn't delete temp file '" + outTempFile + "'. Error: " + err, 'r');
										});
										//Add to the database
										let FileProps = fs.statSync(targetFile)
										db.recordingAdd(targetFile, fileTimeNow.now.getTime(), durationMs, user.id, FileProps ? FileProps.size : 0);
									})
									.output(targetFile)
									.run();
							}
						})
						.on('codecData', format => {
							if (config.logging.ConsoleReport.RecordDebugMessages) utils.report("ffmpeg reports stream properties. Duration:" + format['duration'] + ", audio: " + format['audio_details'] + ".", 'c', config.logging.LogFileReport.RecordDebugMessages); //debug message
						})
						.on('start', function (commandLine) {
							//if (config.logging.ConsoleReport.FfmpegDebug) utils.report('Spawned Ffmpeg with command: ' + commandLine, 'w', config.logging.LogFileReport.FfmpegDebug); //debug message
						})
						.pipe(outputStream);
				}
			})
			connection.on('error', (err) => utils.report("There was an error in voice connection: " + err, 'r'));

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
					let connToReturn = getCurrentVoiceConnection()
					if (connToReturn)
						return resolve(connToReturn);
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
		let connToReturn = getCurrentVoiceConnection();
		if (connToReturn) {
			haveConnection = true;
			return resolve(connToReturn);
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
function setVolume(volume, time) {
	let currConnection = getCurrentVoiceConnection();
	if (currConnection) {
		let iterations = Math.floor(time / 20);
		let volDelta = (volume - CurrentVolume) / iterations;
		//Each packet sent is 20ms long, so no need to change it more often since it won't have any effect
		volumeIterate(currConnection.dispatcher, iterations, 20, volDelta, CurrentVolume);
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
		checkedDataStart = null;
		if (config.logging.ConsoleReport.SoundsPlaybackDebug) utils.report("Finished playing! Reason: " + reason, 'c', config.logging.LogFileReport.SoundsPlaybackDebug); //debug message
		soundIsPlaying = false;
		handleQueue(reason);
		LastPlaybackTime = Date.now();
		//Recreate player in 1 second if nothing else is playing
		setTimeout(() => {
			if (!soundIsPlaying && !PreparingToPlaySound) {
				recreatePlayer();
			}
		}, 1000);
	});
	connection.dispatcher.on('start', () => {
		//For debugging responce timings
		if (config.logging.ConsoleReport.DelayDebug) {
			utils.report(utils.msCount("Playback") + " Started playing!.", 'c', config.logging.LogFileReport.DelayDebug); //debug message
		} 
		if (config.logging.ConsoleReport.SoundsPlaybackDebug) utils.report("Started playing!", 'c', config.logging.LogFileReport.SoundsPlaybackDebug); //debug message
		PreparingToPlaySound = false;
		soundIsPlaying = true;
		//console.log(connection.player);
	});
	connection.dispatcher.on('speaking', (message) => {
		//For debugging responce timings
		if (config.logging.ConsoleReport.DelayDebug) {
			utils.report(utils.msCount("Playback", 'reset') + " Dispatcher debug: " + message, 'c', config.logging.LogFileReport.DelayDebug); //debug message
		}
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
					CurrentPlayingSound = { 'type': 'file', 'path': path.resolve(__dirname, config.folders.Sounds, inputObject.filename), 'filename': inputObject.filename, 'duration': inputObject.duration, 'user': inputObject.user, 'flags': inputObject.flags };
					if (inputObject.played) CurrentPlayingSound['played'] = inputObject.played;
					CurrentVolume = inputObject.flags.volume ? calcVolumeToSet(inputObject.flags.volume) : calcVolumeToSet(db.getUserVolume(inputObject.user.id));
					let PlaybackOptions = { 'volume': CurrentVolume, 'passes': config.VoicePacketPasses, 'bitrate': 'auto' };
					if (inputObject.played) PlaybackOptions['seek'] = inputObject.played / 1000;
					if (config.logging.ConsoleReport.DelayDebug) utils.report(utils.msCount("Playback") + " Creating File dispatcher...", 'c', config.logging.LogFileReport.DelayDebug); //debug message

					db.userPlayedSoundsInc(inputObject.user.id); //Increment value in DB for statistics
					db.soundPlayedInc(inputObject.filename); //Increment value in DB for statistics
					let ffstream = utils.processStream([{ file: path.resolve(__dirname, config.folders.Sounds, inputObject.filename) } ], inputObject.flags);
					connection.playConvertedStream(ffstream, PlaybackOptions);

					playbackMessage(":musical_note: Playing file `" + CurrentPlayingSound.filename + "`" + utils.flagsToString(inputObject.flags) + ", duration " + utils.humanTime(CurrentPlayingSound.duration) + ". Requested by " + getUserTagName(CurrentPlayingSound.user) + "." + (inputObject.played ? " Resuming from " + Math.round(inputObject.played / 1000) + " second!" : ""));
					//Attach event listeners
					attachEventsOnPlayback(connection);
				} //QueueElement = { 'type': 'recording', 'searchresult': found, 'user': guildMember, 'flags': additionalFlags };
				else if (inputObject.type == 'recording') {
					if (config.logging.ConsoleReport.SoundsPlaybackDebug) utils.report("inputObject.type PASSED", 'c', config.logging.LogFileReport.SoundsPlaybackDebug); //debug message
					CurrentPlayingSound = { 'type': 'file', 'searchresult': inputObject.searchresult, 'duration': inputObject.duration, 'user': inputObject.user, 'flags': inputObject.flags };
					if (inputObject.played) CurrentPlayingSound['played'] = inputObject.played;
					CurrentVolume = inputObject.flags.volume ? calcVolumeToSet(inputObject.flags.volume) : calcVolumeToSet(db.getUserVolume(inputObject.user.id));
					let PlaybackOptions = { 'volume': CurrentVolume, 'passes': config.VoicePacketPasses, 'bitrate': 'auto' };
					if (inputObject.played) PlaybackOptions['seek'] = inputObject.played / 1000;
					if (config.logging.ConsoleReport.DelayDebug) utils.report(utils.msCount("Playback") + " Creating File dispatcher...", 'c', config.logging.LogFileReport.DelayDebug); //debug message

					db.userPlayedRecsInc(inputObject.user.id); //Increment value in DB for statistics
					let ffstream = utils.processStream(inputObject.searchresult.list, inputObject.flags, { how: inputObject.searchresult.method, channels: inputObject.searchresult.channelsToMix });
					connection.playConvertedStream(ffstream, PlaybackOptions); 

					playbackMessage(":record_button: Playing recording of `" + utils.getDateFormatted(CurrentPlayingSound.searchresult.startTime, "D MMM YYYY, HH:mm") + " - " + utils.getDateFormatted(CurrentPlayingSound.searchresult.endTime, "HH:mm z") + "` period" + utils.flagsToString(inputObject.flags) + ", duration " + utils.humanTime(CurrentPlayingSound.duration/1000) + ". Requested by " + getUserTagName(CurrentPlayingSound.user) + "." + (inputObject.played ? " Resuming from " + Math.round(inputObject.played / 1000) + " second!" : ""));
					//Attach event listeners
					attachEventsOnPlayback(connection);

					//TEMP
					//PreparingToPlaySound = false;
					//soundIsPlaying = false;
					//handleQueue("next");
					//LastPlaybackTime = Date.now();
				}
				else if (inputObject.type == 'youtube') {
					let YtOptions = { quality: 'highestaudio' };
					let recievedInfo = false;
					if (config.UseAudioOnlyFilterForYoutube) YtOptions['filter'] = 'audioonly';
					//'begin' parameter should be greather than 6 seconds: https://github.com/fent/node-ytdl-core/issues/129
					// sometimes its not working
					if (inputObject.played && inputObject.played > 7000 && !config.UseAudioOnlyFilterForYoutube) YtOptions['begin'] = Math.floor(inputObject.played / 1000) + "s";
					if (config.logging.ConsoleReport.DelayDebug) utils.report(utils.msCount("Playback") + " creating stream... for '" + inputObject["link"]+"'", 'c', config.logging.LogFileReport.DelayDebug); //debug message

					db.userPlayedYoutubeInc(inputObject.user.id); //Increment value in DB for statistics

					//Create the stream
					let stream = ytdl(inputObject["link"], YtOptions)
					stream.on('info', (videoInfo, videoFormat) => {
						if (config.logging.ConsoleReport.DelayDebug) utils.report(utils.msCount("Playback") + " Recieved YouTube info message, creating dispatcher...", 'c', config.logging.LogFileReport.DelayDebug); //debug message
						CurrentPlayingSound = inputObject;
						CurrentPlayingSound.title = videoInfo['title'];
						CurrentPlayingSound.duration = videoInfo['length_seconds'];
						if (inputObject.played) CurrentPlayingSound['played'] = inputObject.played;
						CurrentVolume = inputObject.flags.volume ? calcVolumeToSet(inputObject.flags.volume) : calcVolumeToSet(db.getUserVolume(inputObject.user.id));
						let PlaybackOptions = { 'volume': CurrentVolume, 'passes': config.VoicePacketPasses, 'bitrate': 'auto' };
						if (inputObject.played && config.UseAudioOnlyFilterForYoutube) {
							if (inputObject.played / 1000 <= config.YoutubeResumeTimeLimit)
								PlaybackOptions['seek'] = inputObject.played / 1000;
							else
								PlaybackOptions['seek'] = config.YoutubeResumeTimeLimit;
						}

						let ffstream = utils.processStream([{ file: stream }], inputObject.flags);
						connection.playConvertedStream(ffstream, PlaybackOptions);
						
						playbackMessage(":musical_note: Playing Youtube `" + CurrentPlayingSound.title.substring(0, config.YoutubeTitleLengthLimit) + "`" + utils.flagsToString(inputObject.flags) + " (duration " + utils.humanTime(CurrentPlayingSound.duration) + "). Requested by " + getUserTagName(CurrentPlayingSound.user) + ". <" + CurrentPlayingSound.link + ">");
						//Attach event listeners
						attachEventsOnPlayback(connection);
						recievedInfo = true;
					});
					stream.on('error', error => {
						sendInfoMessage("There was an error while playing your YouTube link: " + error, config.ReportChannelId, urrentPlayingSound.user);
						utils.report('Couldnt download video! Reason: ' + error, 'r');
						if (stream)
							stream.end();
					});
					//In case something goes wrong and we never get 'info' event, we need to set variables back to normal
					setTimeout(() => {
						if (!recievedInfo && PreparingToPlaySound) {
							PreparingToPlaySound = false;
							if (stream)
								stream.end();
						}
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
		if (connection.dispatcher.stream) {
			connection.dispatcher.end();
			//connection.dispatcher.stream.destroy();
		}
		//connection.dispatcher.end();
	}
	//Kill all ffmpeg Playback processes
	utils.deletePlaybackCommands();
}

//Check if we need to launch next sound in the queue
function handleQueue(reason) {
	if (config.logging.ConsoleReport.DelayDebug) utils.msCount("Playback", 'start'); //debug message (not printing)
	if (!PreparingToPlaySound && !PausingThePlayback) {
		setTimeout(() => {
			if (config.logging.ConsoleReport.DelayDebug) utils.msCount("Playback"); //debug message (not printing)
			let currConnection = getCurrentVoiceConnection();
			if (currConnection) {
				playQueue(currConnection);
			}
		}, (Date.now() - LastPlaybackTime >= config.SoundPlaybackWaitTimeMs ? 0 : config.SoundPlaybackWaitTimeMs - (Date.now() - LastPlaybackTime)));
	}
	if (PausingThePlayback)
		PausingThePlayback = false;
}

if (config.debug.ShowMemoryUsed)
	utils.memoryStatShow(config.debug.ShowMemoryUsedPeriodMs);

// =============== CLIENT EVENTS ===============

client.on('ready', () => {
	utils.report('Logged in as ' + client.user.tag + '!', 'g');
	db.updateUsersDB(client.guilds.get(config.guildId).members);
	BotReady = true;
});
/*client.on('debug', (message) => {
	utils.report('DDebug: ' + message, 'w');
	BotReady = true;
});*/
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
			db.userUpdateAdd(member.id, member.user.username, member.nickname, config.DefaultVolume);
		})
		.catch(error => utils.report("Couldn't fetch a new member '" + member.user.username +"'. Error: " + error, 'r'));
});
client.on('guildMemberUpdate', (OldMember, NewMember) => {
	client.guilds.get(config.guildId).fetchMember(NewMember.id)
		.then(() => {
			if (config.logging.ConsoleReport.MembersJoiningUpdating) utils.report("Member updated: '" + NewMember.user.username + "' (" + NewMember.id + ")!", 'b', config.logging.LogFileReport.MembersJoiningUpdating);
			db.userUpdateAdd(NewMember.id, NewMember.user.username, NewMember.nickname, config.DefaultVolume);
		})
		.catch(error => utils.report("Couldn't fetch a member update for '" + NewMember.user.username + "'. Error: " + error, 'r'));
});

//Check if bot should move to this channel or leave it if required amount of members in there is reached
client.on('voiceStateUpdate', (OldMember, NewMember) => {
	//react only to our guild events
	if (NewMember.guild.id == config.guildId || OldMember.guild.id == config.guildId) {
		let userName = getUserName(NewMember.user)
		let currConnection = getCurrentVoiceConnection();

		//Member joined a voice channel
		if (!(OldMember.voiceChannelID) && NewMember.voiceChannelID) {
			let ChannelMembersCount = countChannelMembers(NewMember.voiceChannel);
			if (config.logging.ConsoleReport.MembersJoinLeaveVoice) utils.report(userName + " joined '" + NewMember.voiceChannel.name + "' channel!", 'w', config.logging.LogFileReport.MembersJoinLeaveVoice);
			if (ChannelMembersCount >= config.AutoJoinMembersAmount && config.AutoJoinTalkingRoom) {
				if (config.logging.ConsoleReport.ChannelMembersCountDebug) utils.report("Members count: There are " + countChannelMembers(NewMember.voiceChannel) + " members in '" + NewMember.voiceChannel.name + "' channel now. (By config we join if >" + config.AutoJoinMembersAmount + ").", 'c', config.logging.LogFileReport.ChannelMembersCountDebug); //debug message
				if (currConnection && config.SwitchVoiceRoomIfMoreMembers) {
					//Change the channel if it has more members than current one
					if (countChannelMembers(NewMember.voiceChannel) > countChannelMembers(currConnection.channel) && NewMember.voiceChannel.joinable)
						joinVoiceChannelQueue(NewMember.voiceChannel);
				}
				else if (!currConnection && NewMember.voiceChannel.joinable)
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
			if (currConnection) {
				if (countChannelMembers(currConnection.channel) == 0 && config.AutoLeaveIfAlone) {
					//If there is no ChannelJoin command in the queue
					if (!ChannelWaitingToJoin) {
						stopPlayback(currConnection, false);
						recieversDestroy();
					}
				}

			}
		}
		//Member changed a voice channle
		else if (OldMember.voiceChannelID != NewMember.voiceChannelID && OldMember.voiceChannelID && NewMember.voiceChannelID) {
			if (config.logging.ConsoleReport.MembersJoinLeaveVoice) utils.report(userName + " switched to '" + NewMember.voiceChannel.name + "' channel!", 'w', config.logging.LogFileReport.MembersJoinLeaveVoice);
			if (currConnection && (config.SwitchVoiceRoomIfMoreMembers || countChannelMembers(currConnection.channel) == 0)) {
				//Change the channel if it has more members than current one
				if ((countChannelMembers(NewMember.voiceChannel) > countChannelMembers(currConnection.channel) || countChannelMembers(currConnection.channel) == 0) && NewMember.voiceChannel.id != currConnection.channel.id && NewMember.voiceChannel.joinable)
					joinVoiceChannelQueue(NewMember.voiceChannel);
			}
			else if (!currConnection && NewMember.voiceChannel.joinable)
				//If we dont have any active channel connections
				joinVoiceChannelQueue(NewMember.voiceChannel);
		}
	}
});

//Login if everything is ready
if (utils.checkFoldersExistance()) {
	db.prepareDatabase()
		.then(() => {
			db.scanSoundsFolder()
				.then(() => {
					db.checkRecordingsScanNeeded()
						.then(err => {
							if (!err)
								RecordsDBReady = true;
							client.login(config.token);
						});
				});
		})
		.catch(err => { utils.report("There was an error while preparing the database: "+err, 'r'); });

}

// =============== MESSAGE EVENTS ===============
client.on('message', async message => {
	let userName = getUserName(message.author)
	let guildMember = message.channel.type != "text" ? client.guilds.get(config.guildId).members.get(message.author.id) : message.member;
	let currVoiceConnection = getCurrentVoiceConnection();
	guildMember.roles.array()
	if (userName && guildMember) {
		//Only handle commands from our guild or direct messages from members of our guild
		if (message.channel.type != 'dm' && message.channel.guild) if (message.channel.guild.id != config.guildId) return;
			//If its a command
			if (message.content.substring(0, config.CommandCharacter.length) == config.CommandCharacter) {
				let args = message.content.substring(config.CommandCharacter.length).split(' ');
				let additionalFlags = utils.readFlags(message.content);
                //let additionalFlags = {};
                let command = args[0].toLowerCase();
				args = args.splice(1);

				if (config.RestrictCommandsToSingleChannel && message.channel.id == config.ReportChannelId || config.ReactToDMCommands && message.channel.type == 'dm' || !config.RestrictCommandsToSingleChannel) {
					utils.report("Command from " + userName + ": " + message.content.replace(/(\r\n\t|\n|\r\t)/gm, " "), 'm');

					switch (command) {
						case 'scan':
						case 'rescan':
							{
								if (config.EnableSoundboard && checkPermission(guildMember, 30)) {
									sendInfoMessage("Scanning files...", message.channel, message.author);
									db.scanSoundsFolder();
								}
								break;
							}
						case 'shutdown':
						case 'poweroff':
						case 'logout':
							{
								if (checkPermission(guildMember, 30)) {
									sendInfoMessage("Bot shuts down. See you! :wave:", message.channel, message.author);
									setTimeout(() => {
										handleExitEvent();
									}, 1000);
								}
								break;
							}
						case 'help':
							{
								//Send in private chat
								message.author.send("Help message")
								break;
							}
						//Give list of possible files to play
						case 'list':
						case 'files':
							{
								if (config.EnableSoundboard && checkPermission(guildMember, 6, message.channel)) {
									if (message.channel.type != "dm")
										sendInfoMessage("List sent in private!", message.channel);
									db.getSoundsList()
										.then(found => {
											let resultList = "";
											for (i in found) {
												resultList += config.CommandCharacter + found[i] + "\n";
											}
											resultList = "This is the list of all avaliable sound files. Type any of the following commands or part of it to play the file: ```" + resultList + "```";
											message.author.send(resultList)
												.then(message => utils.report("Sent list of possible commands to '" + userName + "' user (" + message.author.id + ").", 'y'))
												.catch(error => utils.report("Error sending message to '" + userName + "' user (" + message.author.id + "). Reason: " + error, 'r'));
										});
								}
								break;
							}
						//Summon bot to the voiceChannel
						case 'summon':
						case 'summonbot':
						case 'bot':
						case 'join':
							{
								if ((config.EnableSoundboard || config.EnableRecording) && checkPermission(guildMember, 0, message.channel)) {
									if (guildMember.voiceChannel) {
										let playAfterRejoining = soundIsPlaying;
										if (currVoiceConnection) {
											if (currVoiceConnection.channel.id != guildMember.voiceChannel.id) {
												//Pause the playback if any
												if (soundIsPlaying && currVoiceConnection) {
													PausingThePlayback = true;
													stopPlayback(currVoiceConnection, true);

												}
											}
											else
												sendInfoMessage("I'm already on the channel! :angry:", message.channel, message.author);
										}
										if (getVoiceChannel(guildMember).joinable)
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
								}
								break;
							}
						//Dismiss
						case 'dismiss':
						case 'leave':
						case 'quit':
							{
								if ((config.EnableSoundboard || config.EnableRecording) && checkPermission(guildMember, 1, message.channel)) {
									if (currVoiceConnection) {
										//First, pause any playback
										if (soundIsPlaying) 
											stopPlayback(currVoiceConnection, true);
										
										//Delete all voice connections
										recieversDestroy();
									}
									else
										sendInfoMessage("I'm not on a channel!", message.channel, message.author);
								}
								break;
							}
						//Play (if something was paused before)
						case 'play':
						case 'start':
						case 'proceed':
							{
								if (config.EnableSoundboard && checkPermission(guildMember, 7, message.channel)) {
									if (!soundIsPlaying) {
										if (PlayingQueue.length > 0) {
											if (currVoiceConnection) {
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
						//Pause the playback
						case 'pause':
						case 'hold':
						case 'wait':
							{
								if (config.EnableSoundboard && checkPermission(guildMember, 7, message.channel)) {
									if (soundIsPlaying && currVoiceConnection) {
										PausingThePlayback = true;
										stopPlayback(currVoiceConnection, true);
										playbackMessage(":pause_button: Playback paused (requested by " + getUserTagName(message.author) + ").");
									}
								}
								break;
							}
						//Rejoin the channel (Leave and join again - sometimes people cant hear the bot, usually this helps)
						case 'rejoin':
						case 'resummon':
						case 'restart':
							{
								if ((config.EnableSoundboard || config.EnableRecording) && checkPermission(guildMember, 8, message.channel)) {
									let playAfterRejoining = soundIsPlaying;
									if (guildMember.voiceChannel) {
										//First, pause any playback
										if (soundIsPlaying && currVoiceConnection) {
											stopPlayback(currVoiceConnection, true);
										}
										//Delete all voice connections first
										recieversDestroy();
										//Make sure wo wait before joining
										LastChannelChangeTimeMs = Date.now();
										if (guildMember.voiceChannel.joinable)
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
								}
								break;
							}
						//Change the volume
						case 'v':
						case 'volume':
						case 'loudness':
						case 'vol':
							{
								if (config.EnableSoundboard) {
									let volumeToSet = 20;
									if (!isNaN(args[0]) && args[0] > 0 && (args[0] <= 100 || checkPermission(guildMember, 11, message.channel)))
										volumeToSet = args[0];
									//If sound is playing, change its volume
									if (soundIsPlaying) {
										let oldVolume = Math.round(CurrentVolume * 100 / (config.VolumeBotGlobal / 100));
										setVolume(calcVolumeToSet(volumeToSet), 1000);
										playbackMessage(((volumeToSet > oldVolume) ? ":loud_sound:" : ":sound:") + " " + getUserTagName(message.author) + " changed volume from " + oldVolume + "% to " + volumeToSet + "%.");
									}
									else
										sendInfoMessage("Setting your personal volume to " + args[0] + "%! Old value was " + db.getUserVolume(message.author.id) + "%.", message.channel, message.author);
									//Set member's personal volume level to this amount
									db.setUserVolume(message.author.id, volumeToSet);
								}
								break;
							}
						//Stop the playback and clear the queue if there are any elements
						case 'stop':
						case 'cancel':
						case 'end':
							{
								if (config.EnableSoundboard && checkPermission(guildMember, 9, message.channel)) {
									let queueDuration = getQueueDuration();
									let queueElements = PlayingQueue.length;
									//Check if we have any voiceConnections
									if (currVoiceConnection) {
										if (soundIsPlaying) {
											stopPlayback(currVoiceConnection, false);
											utils.report(userName + " stopped the playback! (command: '" + message.content + "')" + (queueElements > 0 ? " There were " + queueElements + " records in the queue with total duration of " + utils.humanTime(queueDuration) : ""), 'y');
											playbackMessage(":stop_button: Playback stopped by " + getUserTagName(message.author) + "." + (queueElements > 0 ? " There were " + queueElements + " records in the queue with total duration of " + utils.humanTime(queueDuration) + "." : ""));
										}
										else {
											utils.report("Nothing is playing, clearing the queue." + (queueElements > 0 ? " There were " + queueElements + " records in the queue with total duration of " + utils.humanTime(queueDuration) : ""), 'y');
										}
									}
									PlayingQueue = [];

									////Heap dumb
									//setTimeout(() => {
									//	heapdump.writeSnapshot('/root/JS_DRaSB_' + Date.now() + '.heapsnapshot', (err, file) => {
									//		utils.report("Written dumb file to " + file + "!" , 'y');
									//	});
									//}, 2000);
								}
								break;
							}
						//Play recording
						case 'rec':
                        case 'playrec':
                        case 'repeat':
                        case 'quote':
							{
								if (config.EnableSoundboard && checkPermission(guildMember, 30, message.channel)) {
                                    
                                    if (config.logging.ConsoleReport.DelayDebug) utils.report(utils.msCount("RecPlayCommand", 'start') + " Recieved command!", 'c', config.logging.LogFileReport.DelayDebug); //debug message
                                    //Get list of users that were mentioned
                                    let users = message.content.match(/([0-9]{9,})/gm);
									if (!users) users = [];
									
                                    let sequenceMode = true;
									//If there is no date, use 'ago' time, else use random
									let reqDate = additionalFlags['date'] ? additionalFlags['date'].getTime() : (additionalFlags['start'] ? Date.now() - additionalFlags['start'] * 1000 : additionalFlags['timetag'] ? Date.now() - additionalFlags['timetag'] * 1000 : db.getRecDates(users).random);
									
                                    //If there is no exact date, no start mark and no timetag, or command is quote => make it 'phrase'
									if (!additionalFlags['date'] && !additionalFlags['timetag'] && !additionalFlags['start'] || command == 'quote')
										sequenceMode = false;
									
									//If specified duration is withing the limit, use it, otherwise use default value from config
									let duration = sequenceMode ?
										additionalFlags['duration'] > 0 && (additionalFlags['duration'] < config.MaximumDurationToPlayback || config.MaximumDurationToPlayback==0) ? additionalFlags['duration'] * 1000 : config.DefaultRecPlaybackDuration * 1000 :
										additionalFlags['duration'] > 0 ? additionalFlags['duration']*1000 : config.PhraseMsDuration;
									
									let mode = sequenceMode ?
										{ how: 'sequence', duration: duration, gapToStop: config.GapDurationToStopPlayback * 1000, gapToAdd: config.GapsBetweenSayingsMs } :
										{ how: 'phrase', minDuration: duration, allowedGap: config.PhraseAllowedGapMsTime, gapToAdd: config.GapsBetweenSayingsMs };
									
									let found = db.makeRecFileList(reqDate, mode, config.SearchHoursPeriod * 3600000, users);
									
									if (found) {
										prepareForPlaybackOnChannel(guildMember)
											.then((connection) => {
												if (connection) {
													if (config.logging.ConsoleReport.DelayDebug) utils.report(utils.msCount("RecPlayCommand") + " Checked channel presence.", 'c', config.logging.LogFileReport.DelayDebug); //debug message
													//Create Queue element
													QueueElement = { 'type': 'recording', 'searchresult': found, 'user': guildMember, 'flags': additionalFlags, 'duration': found.duration };
													//If something is playing right now
													if (soundIsPlaying) {
														if (config.logging.ConsoleReport.DelayDebug) utils.report(utils.msCount("RecPlayCommand") + " Stopping playback.", 'c', config.logging.LogFileReport.DelayDebug); //debug message
														//Stop or pause the playback (depending on length of playing sound)
														stopPlayback(connection, (config.EnablePausingOfLongSounds && CurrentPlayingSound.duration >= config.LongSoundDuration));
														//Add to the front position in queue
														PlayingQueue.unshift(QueueElement);
														//Do not run handleQueue() here, since it will be run due to dispatcher.end Event after stopping the playback
													}
													//Nothing is playing right now
													else {
														if (config.logging.ConsoleReport.DelayDebug) utils.report(utils.msCount("RecPlayCommand", 'reset') + " Launching handleQueue().", 'c', config.logging.LogFileReport.DelayDebug); //debug message
														PlayingQueue.unshift(QueueElement);
														handleQueue('newSoundRequest');
													}
												}
											});
									}
									else
										sendInfoMessage("Nothing was found.", message.channel, message.author);
                                  
                                }
                                break;
							}
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
									if (ytdl.validateURL(args[0]) && checkPermission(guildMember, 3, message.channel)) {
										ytdl.getBasicInfo(args[0], (err, info) => {
											if (err) {
												sendInfoMessage("Couldn't get video information from the link that you provided! Try other link.", message.channel, message.author);
												utils.report("ytdl.getBasicInfo failed, can't get youtube info from link: " + err, 'y');
											}
											else {
												playbackMessage(":arrow_right: " + getUserTagName(message.author) + " added Youtube link to the queue: `" + info['title'].substring(0, config.YoutubeTitleLengthLimit) + "` (duration " + utils.humanTime(info['length_seconds']) + "). <" + args[0] + ">");
												//Create Queue element
												QueueElement = { 'type': 'youtube', 'link': args[0], 'title': info['title'], 'video_id': info['video_id'], 'user': guildMember, 'duration': info['length_seconds'], 'loudness': info['loudness'], 'flags': additionalFlags };
												//Add to the queue
												PlayingQueue.push(QueueElement);
											}
										});
									}
									//This is probably a file
									else if (checkPermission(guildMember, 2, message.channel)) {
										db.findSound(command)
											.then(found => {
												if (found.count == 1 || (!config.StrictAudioCommands && found.count > 1)) {
													playbackMessage(":arrow_right: " + getUserTagName(message.author) + " added file to the queue: '" + found[0] + "'" + utils.flagsToString(additionalFlags) + " (duration " + utils.humanTime(db.getSoundDuration(found[0])) + ").");
													
													//Create Queue element
													QueueElement = { 'type': 'file', 'filename': found.sound.filenameFull, 'user': guildMember, 'duration': found.sound.duration, 'flags': additionalFlags };
													//Add to the queue
													PlayingQueue.push(QueueElement);
												}
												else if (found.count > 1)
													sendInfoMessage("More than one result found!", message.channel, message.author);
												else
													sendInfoMessage("There is no file with such name!", message.channel, message.author);
											});
									}
								}
								break;
							}
						//Play next element in the queue
						case 'skip':
						case 'next':
							{
								if (config.EnableSoundboard && checkPermission(guildMember, 7, message.channel)) {
									if (config.EnableSoundboard && soundIsPlaying && currVoiceConnection) {
										if (PlayingQueue.length > 0)
											playbackMessage(":track_next: Playing next! (requested by " + getUserTagName(message.author) + ").");
										stopPlayback(currVoiceConnection, false);
									}
								}
								break;
							}
						//Youtube audio
						case 'yt':
						case 'youtube':
							{
								if (config.EnableSoundboard && checkPermission(guildMember, 3, message.channel)) {
									if (ytdl.validateURL(args[0])) {
										if (config.logging.ConsoleReport.DelayDebug) utils.report(utils.msCount("YouTubeCommand", 'start') + " Recieved command!", 'c', config.logging.LogFileReport.DelayDebug); //debug message
										
										prepareForPlaybackOnChannel(guildMember)
											.then((connection) => {
												if (connection) {
													if (config.logging.ConsoleReport.DelayDebug) utils.report(utils.msCount("YouTubeCommand") + " Checked channel presence.", 'c', config.logging.LogFileReport.DelayDebug); //debug message
													//Create Queue element
													QueueElement = { 'type': 'youtube', 'link': args[0], 'user': guildMember, 'flags': additionalFlags };
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
												}
											});
											
										
									}
									else
										sendInfoMessage("This is not a valid Youtube link!", message.channel, message.author);
								}
								break;
							}
						default:
							{
								if (config.EnableSoundboard) {
									if (config.logging.ConsoleReport.DelayDebug) utils.report(utils.msCount("FileCommand", 'start') + " Recieved command!", 'c', config.logging.LogFileReport.DelayDebug); //debug message
									//Requested a local sound playback
									db.findSound(command)
										.then(found => {
											if (found.count == 1 || (!config.StrictAudioCommands && found.count > 1)) {
												if (checkPermission(guildMember, 2, message.channel)) {
													prepareForPlaybackOnChannel(guildMember)
														.then((connection) => {
															if (connection) {
																if (config.logging.ConsoleReport.DelayDebug) utils.report(utils.msCount("FileCommand") + " Checked channel presence.", 'c', config.logging.LogFileReport.DelayDebug); //debug message
																
																//Create Queue element
																QueueElement = { 'type': 'file', 'filename': found.sound.filenameFull, 'user': guildMember, 'duration': found.sound.duration, 'flags': additionalFlags };

																//If something is playing right now
																if (soundIsPlaying) {
																	if (config.logging.ConsoleReport.DelayDebug) utils.report(utils.msCount("FileCommand") + " Stopping playback!", 'c', config.logging.LogFileReport.DelayDebug); //debug message
																	//Stop or pause the playback (depending on length of playing sound)
																	stopPlayback(connection, (config.EnablePausingOfLongSounds && CurrentPlayingSound.duration >= config.LongSoundDuration && found.sound.duration < config.LongSoundDuration));
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
															}
														});
												}
											}
											else if (found.count > 1)
												sendInfoMessage("More than one result found!", message.channel, message.author);
											else
												sendInfoMessage("Unknown command! Type **" + config.CommandCharacter + "help**" + (config.RestrictCommandsToSingleChannel ? " in the <#" + config.ReportChannelId + "> channel or in DM" : "") + " to see instructions on how to use this bot.", message.channel, message.author);
										});
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
				if (checkPermission(guildMember, 4, message.channel)) {
					let attachments = message.attachments.array();
					for (i in attachments) {
						let attachment = attachments[i];
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
																db.userUploadedSoundsInc(message.author.id); //Increment value in DB for statistics
																utils.checkAudioFormat(path.resolve(__dirname, config.folders.Sounds, nameClean))
																	.then(resultNew => {
																		db.soundUpdateAdd(nameClean, resultNew['metadata']['format']['duration'], fs.statSync(path.resolve(__dirname, config.folders.Sounds, nameClean)).size, resultNew['metadata']['format']['bitrate'], message.author.id);
																	});
																//db.scanSoundsFolder();
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
																		db.userUploadedSoundsInc(message.author.id); //Increment value in DB for statistics
																		utils.checkAudioFormat(path.resolve(__dirname, config.folders.Sounds, nameClean))
																			.then(resultNew => {
																				db.soundUpdateAdd(nameClean, resultNew['metadata']['format']['duration'], fs.statSync(path.resolve(__dirname, config.folders.Sounds, nameClean)).size, resultNew['metadata']['format']['bitrate'], message.author.id);
																			});
																		//db.scanSoundsFolder();
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
														utils.report("Recieved file '" + attachment.filename + "' from " + userName + ". Duration " + result['metadata']['duration'] + " s, format: '" + result['metadata']['streams'][0]['codec_name'] + "', streams: " + result['metadata']['streams'].length + ". Converting...", 'y');
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
																		db.userUploadedSoundsInc(message.author.id); //Increment value in DB for statistics
																		utils.checkAudioFormat(path.resolve(__dirname, config.folders.Sounds, nameCleanNoExtension + "." + config.ConvertUploadedAudioContainer))
																			.then(resultNew => {
																				db.soundUpdateAdd(nameCleanNoExtension + "." + config.ConvertUploadedAudioContainer, resultNew['metadata']['format']['duration'], fs.statSync(path.resolve(__dirname, config.folders.Sounds, nameCleanNoExtension + "." + config.ConvertUploadedAudioContainer)).size, resultNew['metadata']['format']['bitrate'], message.author.id);
																			});
																		//db.scanSoundsFolder();
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
			}
		
	}
	else if (message.channel.type == 'dm' || message.channel.type == 'group')
		utils.report("Direct message from user '" + message.author.username + "' (" + message.author.id + ") that is not part of the '" + client.guilds.get(config.guildId).name + "' guild: " + message.content, 'y');
});

process.on('uncaughtException', function (exception) {
	utils.report("uncaughtException: " + exception, 'r');
});

//Handle cleanup before program exits
process.stdin.resume();
function handleExitEvent() {
	utils.report("Recieved requested to stop the application, cleaning up...", 'y');
	client.destroy();
	db.shutdown();
	process.exit();
};

process.on('SIGINT', handleExitEvent); //ctrl+c event
process.on('SIGUSR1', handleExitEvent); //kill pid
process.on('SIGUSR2', handleExitEvent); //kill pid


