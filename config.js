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
 *        config.js
 *    Configuration file to store all the options that can be changed
 *    by users.
 *********************************************************************/
module.exports = {

	// ======== MAIN OPTIONS (SET THEM BEFORE USING THE BOT!) ========

	//Discord bot token
	token: "aaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbbccccccccccccccccccccc0000000000000",

	//ID of the server where you want this bot to function
	guildId: "000000000000000000",

	//Enable soundboard features
	EnableSoundboard: true,

	//Enable automatic voice recording
	EnableRecording: true,

	//Command channel ID also being used as channel where bot will send informational and playback status messages
	ReportChannelId: "000000000000000000",



	// ======== COMMAND AND MESSAGE OPTIONS ========

	//Command character or starting sequence of characters
	CommandCharacter: "?",

	//Allow audio uploading throught direct messages
	AcceptDirectMessagesAudio: true,

	//Size limit for audio files accepted through direct messages (in Kb) or set it to 0 for unlimited size
	MessageAttachmentSizeLimitKb: 0,

	//Strict commands for audio files. True: if more than one file was found, it will give an error. False: it will play first found file.
	StrictAudioCommands: false,

	//Delete user's command on the command channel
	DeleteUserCommands: true,

	//React only to commands on 'ReportChannelId' channel
	RestrictCommandsToSingleChannel: false,

	//If RestrictCommandsToSingleChannel is true: Allow reacting to commands in private chat (DM). If RestrictCommandsToSingleChannel is false: not used.
	ReactToDMCommands: true,

	//Send Playback Status Messages to 'ReportChannelId' channel (must be set)
	PlaybackStatusMessagesSend: true,

	//Delete informational messages (quick replies to user messages about wrong typed commands or unavaliability of certain audios)
	InfoMessagesDelete: true,

	//Time to wait before deleting informational messages (seconds)
	InfoMessagedDeleteTimeout: 30,

	//Limit Youtube video titles to this amount of characters
	YoutubeTitleLengthLimit: 60,

	//Tag people in Playback Status messages (if false will type their name instead of tag)
	PlaybackStatusMessagesTagPeople: true,

	// ======== RECORDING OPTIONS ========

	//Save recorded using this audio codec (ffmpeg format, check avaliable list: https://ffmpeg.org/ffmpeg-codecs.html#Audio-Encoders)
	RecordingAudioCodec: 'libopus',
	//Bitrate of 'RecordingAudioCodec' format
	RecordingAudioBitrate: '96k',
	//Data Container (file extension)
	RecordingAudioContainer: 'ogg', // <= NO DOT!

	// ======== SOUND AND VOICE CHANNEL OPTIONS ========

	//Global volume limiter, this amount will be considered as 100% when using 'volume' command
	VolumeBotGlobal: 100.0,

	//Bot will automatically join a room with 'AutoJoinMembersAmount' or more members
	AutoJoinTalkingRoom: true,

	//If this amount of members is reached in a voice channel, bot will automatically join it (if AutoJoinTalkingRoom == true)
	AutoJoinMembersAmount: 2,

	//Count only human accounts in 'AutoJoinMembersAmount' (ignore bots connected to voice channels)
	VoiceChannelIgnoreBotsCount: true,

	//Automatically leave voice channel if there is no one left in the channel
	AutoLeaveIfAlone: true,

	//Switch channel if other voice room has more members than current one (even if false, bot will switch channel in there is no one left in the current one)
	SwitchVoiceRoomIfMoreMembers: false,

	//Do we pause sound playback if its considered to be 'long' sound and some short one was requested to play and resume playing after short finished?
	//true: if a 'long' sound is playing and someone requested to play a short file, it will be put on pause, short file played and then resume the long sound playback
	//false: if a sound is playing and someone requested another sound, currently playing one will be stopped and new sound played
	EnablePausingOfLongSounds: true,

	//What duration of a sound file is considered to be long (in seconds).
	LongSoundDuration: 10.0,

	//Wait this amount of ms before playing next sound (if we play sounds too fast, some members of voice channel may not hear them)
	SoundPlaybackWaitTimeMs: 5,

	//How many times to send the voice packet to reduce packet loss
	VoicePacketPasses: 2,

	//Shall we use 'audioonly' filter when requesting data from YouTube? This will decrease brandwidth usage but will break resume function: all youtube will restart from the beginning after pausing
	//  Warning: both methods may not work due to bug in ytdl 'begin' option: https://github.com/fent/node-ytdl-core/issues/219
	UseAudioOnlyFilterForYoutube: true,

	//If above is true, we can try using stream 'seek' function to start playing Youtube from certain position, but this will stream audio from the beginning as fast as possible 
	// and only when desired position is reached will start the playback. May take a long time before audio starts playing, therefore we have to limit the time from which we start playback, so we wont wait for too long.
	// (Used only when UseAudioOnlyFilterForYoutube is true) If youtube audio played for longer than this amount of seconds and was putted on pause, it will start from this position
	YoutubeResumeTimeLimit: 20,

	//How much time should we wait for youtube 'info' event before giving up (ms)
	YoutubeInfoResponceTimeoutMs: 5000,

	//Wait this amount of ms between channel joins (to prevent command flooding)
	ChannelJoiningQueueWaitTimeMs: 1000,

	//List of audio formats that we accept as audio files without convertion if sent in DM (if AcceptDirectMessagesAudio is true) If it fits, container will be the same
	AcceptedAudioFormats: ['mp3', 'ac3', 'opus', 'aac'],

	//In case sent file does not fit into above formats, shall we convert it?
	ConvertUploadedAudioFiles: true,

	ConvertUploadedAudioCodec: 'libmp3lame',
	ConvertUploadedAudioBitrate: '240k',
	ConvertUploadedAudioContainer: 'mp3', // <= NO DOT!

	// ======== FOLDERS ========

	// Acceptable format is one of these = relative to running folder: 'somefolder/insidefolder', absolute path: '/home/anton/superawesomesounds', relative to running folder: '../upperfolder'
	folders: {
		//Voice recording folder
		VoiceRecording: 'rec',
		//Folder for temporary files
		Temp: 'temp',
		//Folder for chached youtube files
		Cache: 'cached',
		//Folder with database files
		Database: 'database',
		//Folder where we store uploaded soundfiles for soundboard
		Sounds: 'sounds',
		//Folder for Impulse Response filters
		SoundFilters: 'soundfilters' 
	},



	// ======== LOGGING OPTIONS ========

	logging: {

		//Write bot log to a file
		EnableFileLog: true,

		//Name of the log file
		LogFileName: 'soundboard.log',

		//What to report to console
		ConsoleReport: {
			//join and leave of the bot
			ChannelJoiningLeaving: true,
			//Members joining the guild
			MembersJoiningUpdating: true,
			MembersJoinLeaveVoice: true,
			RecordDebugMessages: false,
			ChannelDebugJoinQueue: false,
			RecFilesSavedAndProcessed: false,
			SoundsPlaybackDebug: false,
			DelayDebug: false,
			FfmpegDebug: false,
		},
		//What to report to logfile (only works if it was reported to console first)
		LogFileReport: {
			ChannelJoiningLeaving: true,
			MembersJoiningUpdating: true,
			MembersJoinLeaveVoice: true,
			RecordDebugMessages: false,
			ChannelDebugJoinQueue: false,
			RecFilesSavedAndProcessed: false,
			SoundsPlaybackDebug: false,
			DelayDebug: false,
			FfmpegDebug: false,
		}
	} 
}