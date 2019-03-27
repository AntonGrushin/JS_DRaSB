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
 *  JS_DRaSB Copyright 2018-2019 - Anton Grushin
 *
 *
 *        opt.js
 *    Options reader script
 *********************************************************************/

const utils = require('./utils.js');
var config = {};
try {
	config = require('./config.js');
} catch (ex) {
	utils.report("Looks like 'config.js' is missing, using default options.", 'y');
}
var opt = {
	permissions: {
		User: {}
	},
	folders: {},
	logging: {
		ConsoleReport: {},
		LogFileReport: {}
	},
	debug: {}
};

//Get value if it exists
function get(obj, key) {
	return key.split(".").reduce(function (o, x) {
		return (typeof o == "undefined" || o === null) ? o : o[x];
	}, obj);
}

function readConfig(optionToRead, defaultValue) {
	let value = get(config, optionToRead);
	let currentValue = get(opt, optionToRead);
	//If value is already set in system and none in config, leave it be
	if (currentValue && (typeof value == "undefined" || value == null)) {
		return currentValue;
	}
	//If value is in config, use it
	else if (value || value == false) {
		return value;
	}
	//Else return default one
	else return defaultValue;
}

module.exports = {

	//Init
	opt,

	//CHeck if there is a value in config
	isThereValueInConfig: function(key) {
		if (get(config, key)) return true;
		else return false;
	},

	//Set value in config
	set: function (key, value) {
		//key.split(".").reduce(function (o, x) {
		//	return (typeof o == "undefined" || o === null) ? o : o[x];
		//}, opt) = value;
		opt[key] = value;
	},

	//Read options and set default values
	readOptionsFromConfig: function () {
		
		opt.token = readConfig('token', null);
		opt.guildId = readConfig('guildId', null);
		opt.EnableSoundboard = readConfig('EnableSoundboard', true);
		opt.EnableRecording = readConfig('EnableRecording', true);
		opt.ReportChannelId = readConfig('ReportChannelId', null);
		opt.CommandCharacter = readConfig('CommandCharacter', "?");
		opt.MessageCharacterLimit = readConfig('MessageCharacterLimit', 2000);
		opt.AcceptDirectMessagesAudio = readConfig('AcceptDirectMessagesAudio', true);
		opt.MessageAttachmentSizeLimitKb = readConfig('MessageAttachmentSizeLimitKb', 0);
		opt.StrictAudioCommands = readConfig('StrictAudioCommands', false);
		opt.DeleteUserCommands = readConfig('DeleteUserCommands', false);
		opt.RestrictCommandsToSingleChannel = readConfig('RestrictCommandsToSingleChannel', false);
		opt.ReactToDMCommands = readConfig('ReactToDMCommands', true);
		opt.PlaybackStatusMessagesSend = readConfig('PlaybackStatusMessagesSend', true);
		opt.InfoMessagesDelete = readConfig('InfoMessagesDelete', true);
		opt.InfoMessagedDeleteTimeout = readConfig('InfoMessagedDeleteTimeout', 30);
		opt.YoutubeTitleLengthLimit = readConfig('YoutubeTitleLengthLimit', 60);
		opt.PlaybackStatusMessagesTagPeople = readConfig('PlaybackStatusMessagesTagPeople', true);
		opt.RecordingAudioCodec = readConfig('RecordingAudioCodec', 'libopus');
		opt.RecordingAudioBitrate = readConfig('RecordingAudioBitrate', '96k');
		opt.RecordingAudioContainer = readConfig('RecordingAudioContainer', 'ogg');

		opt.RecordingsDurationSkipThresholdMs = readConfig('RecordingsDurationSkipThresholdMs', 40);
		opt.VolumeBotGlobal = readConfig('VolumeBotGlobal', 100.0);
		opt.DefaultVolume = readConfig('DefaultVolume', 20.0);
		opt.AutoJoinTalkingRoom = readConfig('AutoJoinTalkingRoom', true);
		opt.AutoJoinMembersAmount = readConfig('AutoJoinMembersAmount', 1);
		opt.VoiceChannelIgnoreBotsCount = readConfig('VoiceChannelIgnoreBotsCount', true);
		opt.AutoLeaveIfAlone = readConfig('AutoLeaveIfAlone', true);
		opt.SwitchVoiceRoomIfMoreMembers = readConfig('SwitchVoiceRoomIfMoreMembers', false);
		opt.EnablePausingOfLongSounds = readConfig('EnablePausingOfLongSounds', true);
		opt.LongSoundDuration = readConfig('LongSoundDuration', 10.0);
		opt.SoundPlaybackWaitTimeMs = readConfig('SoundPlaybackWaitTimeMs', 5);
		opt.PlaybackHistoryLastSize = readConfig('PlaybackHistoryLastSize', 10);
		opt.VoicePacketPasses = readConfig('VoicePacketPasses', 2);
		opt.UseAudioOnlyFilterForYoutube = readConfig('UseAudioOnlyFilterForYoutube', true);
		opt.YoutubeResumeTimeLimit = readConfig('YoutubeResumeTimeLimit', 20);
		opt.YoutubeInfoResponceTimeoutMs = readConfig('YoutubeInfoResponceTimeoutMs', 5000);
		opt.ChannelJoiningQueueWaitTimeMs = readConfig('ChannelJoiningQueueWaitTimeMs', 1000);
		opt.AcceptedAudioFormats = readConfig('AcceptedAudioFormats', ['mp3', 'ac3', 'opus', 'aac']);
		opt.ConvertUploadedAudioFiles = readConfig('ConvertUploadedAudioFiles', true);
		opt.ConvertUploadedAudioCodec = readConfig('ConvertUploadedAudioCodec', 'libopus');
		opt.ConvertUploadedAudioBitrate = readConfig('ConvertUploadedAudioBitrate', '128k');
		opt.ConvertUploadedAudioContainer = readConfig('ConvertUploadedAudioContainer', 'ogg');
		
		opt.EnableGetCommand = readConfig('EnableGetCommand', true);

		opt.DefaultRequestTimezone = readConfig('DefaultRequestTimezone', "");
		opt.DatabaseTimezone = readConfig('DatabaseTimezone', "");
		opt.SearchHoursPeriod = readConfig('SearchHoursPeriod', 40);
		opt.MaximumDurationToPlayback = readConfig('MaximumDurationToPlayback', 0);
		opt.DefaultRecPlaybackDuration = readConfig('DefaultRecPlaybackDuration', 0);
		opt.RecPlaybackChunkDuration = readConfig('RecPlaybackChunkDuration', 60);
		opt.GapsBetweenSayingsMs = readConfig('GapsBetweenSayingsMs', 50);
		opt.GapForNewTalkSession = readConfig('GapForNewTalkSession', 20);
		opt.PhraseMsDuration = readConfig('PhraseMsDuration', 3000);
		opt.PhraseAllowedGapMsTime = readConfig('PhraseAllowedGapMsTime', 300);
		opt.PhraseSourceUsersCountOnChannel = readConfig('PhraseSourceUsersCountOnChannel', 5);
		opt.IgnoreRecordingDuration = readConfig('IgnoreRecordingDuration', 40);
		opt.CheckRecFolderOnStartup = readConfig('CheckRecFolderOnStartup', true);
		opt.FfmpegParallelProcLimit = readConfig('FfmpegParallelProcLimit', 6);
		opt.FileScanParallelLimit = readConfig('FileScanParallelLimit', 4);
		opt.DBInsertsPerTransaction = readConfig('DBInsertsPerTransaction', 25000);
		opt.ComplexFiltersAmountLimit = readConfig('ComplexFiltersAmountLimit', 5); 
		opt.FileRequestsParallelProcessLimit = readConfig('FileRequestsParallelProcessLimit', 2);

		opt.permissions.AdminsList = readConfig('permissions.AdminsList', []);
		opt.permissions.PermissionsLevel = readConfig('permissions.PermissionsLevel', 0);
		opt.permissions.BlackList = readConfig('permissions.BlackList', []);
		opt.permissions.UserRolesList = readConfig('permissions.UserRolesList', []);
		opt.permissions.WhitelistMembers = readConfig('permissions.WhitelistMembers', []);

		opt.permissions.User.SummonBot = readConfig('permissions.User.SummonBot', true);
		opt.permissions.User.DismissBot = readConfig('permissions.User.DismissBot', true);
		opt.permissions.User.PlayFiles = readConfig('permissions.User.PlayFiles', true);
		opt.permissions.User.PlayYoutubeLinks = readConfig('permissions.User.PlayYoutubeLinks', true);
		opt.permissions.User.RepeatLastPlayback = readConfig('permissions.User.RepeatLastPlayback', true);
		opt.permissions.User.UploadLocalAudioFiles = readConfig('permissions.User.UploadLocalAudioFiles', true);
		opt.permissions.User.RenameLocalAudioFiles = readConfig('permissions.User.RenameLocalAudioFiles', true);
		opt.permissions.User.RenameOwnLocalAudioFiles = readConfig('permissions.User.RenameOwnLocalAudioFiles', true);
		opt.permissions.User.DeleteLocalAudioFiles = readConfig('permissions.User.DeleteLocalAudioFiles', false);
		opt.permissions.User.DeleteOwnLocalAudioFiles = readConfig('permissions.User.DeleteOwnLocalAudioFiles', true);
		opt.permissions.User.RecieveListOfLocalAudios = readConfig('permissions.User.RecieveListOfLocalAudios', true);
		opt.permissions.User.PauseResumeSkipPlayback = readConfig('permissions.User.PauseResumeSkipPlayback', true);
		opt.permissions.User.RejoinChannel = readConfig('permissions.User.RejoinChannel', true);
		opt.permissions.User.StopPlaybackClearQueue = readConfig('permissions.User.StopPlaybackClearQueue', true);
		opt.permissions.User.SetVolumeAbove100 = readConfig('permissions.User.SetVolumeAbove100', false);
		opt.permissions.User.HideOwnRecords = readConfig('permissions.User.HideOwnRecords', false);
		opt.permissions.User.PlayRecordsIfWasOnTheChannel = readConfig('permissions.User.PlayRecordsIfWasOnTheChannel', true);
		opt.permissions.User.PlayAnyonesRecords = readConfig('permissions.User.PlayAnyonesRecords', false);
		opt.permissions.User.PlayRandomQuote = readConfig('permissions.User.PlayRandomQuote', true);

		opt.folders.VoiceRecording = readConfig('folders.VoiceRecording', 'rec');
		opt.folders.Temp = readConfig('folders.Temp', 'temp');
		opt.folders.Sounds = readConfig('folders.Sounds', 'sounds');
		opt.folders.SoundFilters = readConfig('folders.SoundFilters', 'soundfilters');
		opt.folders.DeletedSounds = readConfig('folders.DeletedSounds', 'deleted');

		opt.logging.EnableFileLog = readConfig('logging.EnableFileLog', true);
		opt.logging.LogFileName = readConfig('logging.LogFileName', 'soundboard.log');

		opt.logging.ConsoleReport.ChannelJoiningLeaving = readConfig('logging.ConsoleReport.ChannelJoiningLeaving', true);
		opt.logging.ConsoleReport.MembersJoiningUpdating = readConfig('logging.ConsoleReport.MembersJoiningUpdating', true);
		opt.logging.ConsoleReport.MembersJoinLeaveVoice = readConfig('logging.ConsoleReport.MembersJoinLeaveVoice', true);
		opt.logging.ConsoleReport.RecordDebugMessages = readConfig('logging.ConsoleReport.RecordDebugMessages', false);
		opt.logging.ConsoleReport.ChannelDebugJoinQueue = readConfig('logging.ConsoleReport.ChannelDebugJoinQueue', false);
		opt.logging.ConsoleReport.RecFilesSavedAndProcessed = readConfig('logging.ConsoleReport.RecFilesSavedAndProcessed', false);
		opt.logging.ConsoleReport.SoundsPlaybackDebug = readConfig('logging.ConsoleReport.SoundsPlaybackDebug', false);
		opt.logging.ConsoleReport.DelayDebug = readConfig('logging.ConsoleReport.DelayDebug', false);
		opt.logging.ConsoleReport.FfmpegDebug = readConfig('logging.ConsoleReport.FfmpegDebug', false);

		opt.logging.LogFileReport.ChannelJoiningLeaving = readConfig('logging.LogFileReport.ChannelJoiningLeaving', true);
		opt.logging.LogFileReport.MembersJoiningUpdating = readConfig('logging.LogFileReport.MembersJoiningUpdating', true);
		opt.logging.LogFileReport.MembersJoinLeaveVoice = readConfig('logging.LogFileReport.MembersJoinLeaveVoice', true);
		opt.logging.LogFileReport.RecordDebugMessages = readConfig('logging.LogFileReport.RecordDebugMessages', false);
		opt.logging.LogFileReport.ChannelDebugJoinQueue = readConfig('logging.LogFileReport.ChannelDebugJoinQueue', false);
		opt.logging.LogFileReport.RecFilesSavedAndProcessed = readConfig('logging.LogFileReport.RecFilesSavedAndProcessed', false);
		opt.logging.LogFileReport.SoundsPlaybackDebug = readConfig('logging.LogFileReport.SoundsPlaybackDebug', false);
		opt.logging.LogFileReport.DelayDebug = readConfig('logging.LogFileReport.DelayDebug', false);
		opt.logging.LogFileReport.FfmpegDebug = readConfig('logging.LogFileReport.FfmpegDebug', false);

		opt.debug.ShowMemoryUsed = readConfig('debug.ShowMemoryUsed', false);
		opt.debug.ShowMemoryUsedPeriodMs = readConfig('debug.ShowMemoryUsedPeriodMs', 1000);
	},

}