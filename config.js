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

	//Character limit per message
	MessageCharacterLimit: 2000,

	//Allow audio uploading throught direct messages
	AcceptDirectMessagesAudio: true,

	//Size limit for audio files accepted through direct messages (in Kb) or set it to 0 for unlimited size
	MessageAttachmentSizeLimitKb: 0,

	//Strict commands for audio files. True: if more than one file was found, it will give an error. False: it will play first found file.
	StrictAudioCommands: false,

	//Delete user's command on the command channel
	DeleteUserCommands: false,

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

	//Do not save recordings that are less or equal to this duration (milliseconds)
	RecordingsDurationSkipThresholdMs: 40,

	// ======== SOUND AND VOICE CHANNEL OPTIONS ========

	//Global volume limiter, this amount will be considered as 100% when using 'volume' command
	VolumeBotGlobal: 100.0,

	//Volume for new users (default starting value)
	DefaultVolume: 20.0,

	//Bot will automatically join a room with 'AutoJoinMembersAmount' or more members
	AutoJoinTalkingRoom: true,

	//If this amount of members is reached in a voice channel, bot will automatically join it (if AutoJoinTalkingRoom == true)
	AutoJoinMembersAmount: 2,

	//Count only human accounts in 'AutoJoinMembersAmount' (ignore bots connected to voice channels)
	VoiceChannelIgnoreBotsCount: true,

	//Automatically leave voice channel if there is no one left in the channel
	AutoLeaveIfAlone: true,

	//Switch channel if other voice room has more members than current one (even if false, bot will switch channel if there is no one left in the current one)
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

	// ======== RECORDINGS PLAYBACK ========

	//Default timezone. When user types a date of a recording without specifying the time zone, this  one will be used. If its same as Locale TZ you can leave it blank
	// List of possible values can be seen here: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones example: "Europe/Moscow"
	DefaultRequestTimezone: "Europe/Amsterdam",

	//Recordings timezone. LEAVE IT BLANK unless you moved your server with captured records to some other server with different timezone
	//  and your records have old timestamp. If that is so, then this should be timezone of your old server
	DatabaseTimezone: "",

	//Search in this period of time (hours) for records. If nothing was found, stop the search and return fail.
	SearchHoursPeriod: 40,

	//What should be maximum allowed duration of playing recordings (in seconds). 0 for no limitation
	MaximumDurationToPlayback: 0,

	//Default duration to playback if no duration specified, 0 means untill next Talk Settion
	DefaultRecPlaybackDuration: 0,

	//Due to technical limitation (argument list has a limit depending on system: Windows ~32000 characters, Linux ~2097152) we have to play recording in 'chunks'
	//   Here you set duration of those chunks in seconds
	RecPlaybackChunkDuration: 60,

	//Make sure there is this amount of ms getween recorded files when playing (If current gap is bigger, it will be reduced to this amount, if smaller, increased)
	GapsBetweenSayingsMs: 50,

	//Gaps between previous record to consider it as a new 'talk session', minutes
	GapForNewTalkSession: 20,

	//Duration of 'phrase' in milliseconds. Recordings that have duration longer than this, will be considered as 'phrase' or 'quote'.
	PhraseMsDuration: 3000,
	//If gaps between recordings is less than this amount of ms they all will be considered a single 'phrase'
	PhraseAllowedGapMsTime: 300,

	//Dont add to playback recordings that are less or equal to this duration (milliseconds)
	IgnoreRecordingDuration: 40,

	//Check for 'Recordings' database integrity on startup.
	//  Bot will check that database records were not moved/added. If they were, it will rescan the folder and update the database.
	CheckRecFolderOnStartup: true,

	// ======== PERFORMANCE ========

	//How many parallel ffmpeg processes we can run while scanning for files
	//Increasing this value can make launching and DB updating process faster in cost of memory and CPU usage
	FfmpegParallelProcLimit: 6,

	//How many parallel file scans can run (for updating recordings database)
	FileScanParallelLimit: 4,

	//Limit amout of DB records per transaction when writing big lists of data to DB (0 is no limit)
	//   If this amount is too small (<500), it will result in making DB transactions too often and slowing down the DB connection,
	//   Making this too big (>50000) will cause programm to hang up due to too big JSON arrays
	DBInsertsPerTransaction: 25000,

	//Limit amount of FFMPEG ComplexFilters applied to this value (0 if unlimited)
	ComplexFiltersAmountLimit: 5,

    // ======== PERMISSIONS ========

    permissions: {
        //List of Admins IDs. Example: ['262298664016281600']
		AdminsList: [],

        //Level of permissions set on your server:
        //  0 - (Blacklist) Everyone on the server has 'user' permissions (except members in BlackList)
        //  1 - (Whitelist) Only members with special roles (listed in UserRolesList) and listed in WhitelistMembers will have 'user' permission (except members in BlackList), everyone else wont be able to run any commands
        PermissionsLevel: 0,

		//Blacklist - List of user IDs that are not allowed to use any bot command despite them having role or being in Whitelist
		BlackList: [],

        //(Needed only for level 1) List of roles which will have 'user' permission if PermissionsLevel is set to 1
		//This needs to be either role ID or exact name of the role (case sensitive). Mind that if you have several roles with that name they all will have permission.
		//Example: ['SomeRole', '222222222033333300']
        UserRolesList: [],
		//WhiteList - List of members IDs that will have 'user' permission in addition to UserRolesList
		WhitelistMembers: [],

		//(for both levels 1 and 2)
		//'user' permissions are set here
        User: {
			SummonBot: true,
			DismissBot: true,
            PlayFiles: true,
            PlayYoutubeLinks: true,
			UploadLocalAudioFiles: true,
			RenameLocalAudioFiles: true,
			DeleteLocalAudioFiles: false,
			RecieveListOfLocalAudios: true,
			PauseResumeSkipPlayback: true,
			RejoinChannel: true,
			StopPlaybackClearQueue: true,
			SetVolumeAbove100: false,
			HideOwnRecords: false,
			PlayRecordsIfWasOnTheChannel: true,
			PlayAnyonesRecords: false,
			PlayRandomQuote: true,
        },
    },

	// ======== FOLDERS ========

	// Acceptable format is one of these = relative to running folder: 'somefolder/insidefolder', absolute path: '/home/anton/superawesomesounds', relative to running folder: '../upperfolder'
	folders: {
		//Voice recording folder
		VoiceRecording: 'rec',
		//Folder for temporary files
		Temp: 'temp',
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
	},

	// ======== DEBUGGING ========

	debug: {

		ShowMemoryUsed: false,
		ShowMemoryUsedPeriodMs: 1000,

	}
}