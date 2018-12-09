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
 *        config.js
 *    Configuration file to store all the options that can be changed
 *    by users.
 *********************************************************************/
module.exports = {

	//TOKEN
	token: "YourDiscordToken",
	//ID of the server where you want this bot to function
	guildId: "yourGuildId",

	// ======== BOT OPTIONS ========

	//Bot will automatically join a room with 'AutoJoinMembersAmount' or more members
	AutoJoinTalkingRoom: true,
	//If this amount of members is reached in a voice channel, bot will automatically join it (if AutoJoinTalkingRoom == true)
	AutoJoinMembersAmount: 1,
	//Automatically leave voice channel if there is no one left in the channel
	AutoLeaveIfAlone: true,
	//Switch channel if other voice room has more members than current one
	SwitchVoiceRoomIfMoreMembers: true,
	//Enable voice recording
	EnableRecording: true,
	
	// FOLDERS. Acceptable format is one of these = relative to running folder: 'somefolder/insidefolder', absolute path: '/home/anton/superawesomesounds', relative to running folder: '../upperfolder'
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
	},


	// ========= PERFORMANCE =========

	//Wait this amount of ms between channel joins (to prevent command flooding)
	ChannelJoiningQueueWaitTimeMs: 2000,

	logging: {
		// SOUNDBOARD FUNCTIONS
		//Write bot log to a file (true/false)
		EnableFileLog: true,
		//Name of the log file
		LogFileName: 'soundboard.log',
		//Report events to a channel
		ChannelReportEnabled: true,
		//Channel ID where to report playback events
		ChannelReportId: '515851859584352260',

		//What to report on that channel:
		ChanReport: {
			LocalFilesRequests: true,
			YoutubeLinks: true,
			FilesPlayErrors: true,

		},

		//What to report to console
		ConsoleReport: {
			ChannelJoiningLeaving: true,
			MembersJoiningUpdating: true,
			RecordDebugMessages: false,
			ChannelDebugJoinQueue: true,
			RecFilesSavedAndProcessed: true,
		},
		//What to report to logfile (only works if it was reported to console first)
		LogFileReport: {
			ChannelJoiningLeaving: true,
			MembersJoiningUpdating: true,
			RecordDebugMessages: false,
			ChannelDebugJoinQueue: true,
			RecFilesSavedAndProcessed: true,
		}
	}
	

}