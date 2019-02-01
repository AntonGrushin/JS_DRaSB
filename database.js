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
 *        database.js
 *    Library that has all the loading and writing functions that we use
 *    to remember different values in .json files in 'database' folder.
 *********************************************************************/
const fs = require('fs');
const config = require('./config.js');
const path = require('path');
const utils = require('./utils.js');
const ffmpeg = require('fluent-ffmpeg');
const async = require("async");
//const sqlite3 = require('sqlite3').verbose();
//var db = new sqlite3.Database('sqlite.db');
//var db = new sqlite3.Database(':memory:');
const Database = require('better-sqlite3');
const db = new Database('sqlite.db', { memory: false });

//Private variables
var usersVolume = {};
var soundsDB = {};
var lastRecs = [];
var recBuffer = {};

//Technical
var lastRecDBUpdate = 0;
var RecUpdateInQueue = false;
var phrasesToAddToDBBuffer = [];
var lastRecTime = 0;

//SQL statements
var userUpdateAddSqlStmt;
var soundUpdateAddSqlStmt;
var recordingUpdateAddSqlStmt;
var recordingAddSqlStmt;
var addPhraseSqlStmt;
var GetUserCountAtTimeSqlStmt;

function handleError(error) {
	if (error) utils.report("Database error: " + error, 'r');
}

module.exports = {

	//Clean up function on progra exit
	shutdown: function () {
		db.close();
	},

	//Get bd connection
	getDB: function () {
		return db;
	},

	//Create all tables or make sure they exist
	prepareDatabase: function (reportStats = true) {
		return new Promise((resolve, reject) => {

			//Tables
			let CreatePermissionsDB = db.prepare('CREATE TABLE IF NOT EXISTS `permissions` ( `id` INTEGER PRIMARY KEY AUTOINCREMENT UNIQUE, `UserOrRole_Id` INTEGER, `thisIsUser` INTEGER DEFAULT 0, `permissions` INTEGER )');
			let CreateRecordingsDB = db.prepare('CREATE TABLE IF NOT EXISTS "recordings" ( `id` INTEGER PRIMARY KEY AUTOINCREMENT UNIQUE, `filename` TEXT UNIQUE, `startTime` INTEGER, `userId` INTEGER, `duration` INTEGER DEFAULT 0, `size` INTEGER, `exists` INTEGER DEFAULT 1, `hidden` INTEGER DEFAULT 0 )');
			let CreateSettingsDB = db.prepare('CREATE TABLE IF NOT EXISTS `settings` ( `id` INTEGER PRIMARY KEY AUTOINCREMENT UNIQUE, `guildId` INTEGER, `enableSB` INTEGER, `enableRec` INTEGER, `ReportChannelId` INTEGER )');
			let CreateSoundsDB = db.prepare('CREATE TABLE IF NOT EXISTS "sounds" ( `filenameFull` TEXT UNIQUE, `filename` TEXT, `extension` TEXT, `volume` REAL DEFAULT 100, `duration` REAL DEFAULT 0, `size` INTEGER DEFAULT 0, `bitrate` INTEGER DEFAULT 0, `playedCount` INTEGER DEFAULT 0, `uploadedBy` INTEGER DEFAULT 0, `uploadDate` INTEGER, `lastTimePlayed` INTEGER, `exists` INTEGER DEFAULT 1, PRIMARY KEY(`filenameFull`) )');
			let CreateUsersDB = db.prepare('CREATE TABLE IF NOT EXISTS "users" ( `userid` INTEGER UNIQUE, `name` TEXT, `guildName` TEXT, `volume` REAL DEFAULT 20.0, `playedSounds` INTEGER DEFAULT 0, `playedYoutube` INTEGER DEFAULT 0, `playedRecordings` INTEGER DEFAULT 0, `lastCommand` INTEGER, `lastRecording` INTEGER, `recDuration` INTEGER DEFAULT 0, `recFilesCount` INTEGER DEFAULT 0, `uploadedSounds` INTEGER DEFAULT 0, PRIMARY KEY(`userid`) )');
			let CreateTalkSessionsDB = db.prepare('CREATE TABLE IF NOT EXISTS `talk_sessions` ( `id` INTEGER PRIMARY KEY AUTOINCREMENT UNIQUE, `startTime` INTEGER, `endTime` INTEGER, `duration` INTEGER, `usersCount` INTEGER, `usersList` TEXT, `count` INTEGER )');
			let CreatUserActivityDB = db.prepare('CREATE TABLE IF NOT EXISTS "user_activity_log" ( `id` INTEGER PRIMARY KEY AUTOINCREMENT UNIQUE, `userId` INTEGER, `time` INTEGER, `channel` INTEGER, `action` INTEGER, `resultUsersChannCount` INTEGER )');
			let CreatePhrasesDB = db.prepare('CREATE TABLE IF NOT EXISTS "phrases" ( `id` INTEGER PRIMARY KEY AUTOINCREMENT UNIQUE, `userId` INTEGER, `idStart` INTEGER, `recs` INTEGER, `timeStart` INTEGER, `duration` INTEGER, `usersListening` INTEGER, `channel` INTEGER )');

			try {
				//Execute DB creation
				let createDBResult = db.transaction(() => {
					CreatePermissionsDB.run();
					CreateRecordingsDB.run();
					CreateSettingsDB.run();
					CreateSoundsDB.run();
					CreateUsersDB.run();
					CreateTalkSessionsDB.run();
					CreatUserActivityDB.run();
					CreatePhrasesDB.run();
				});
				createDBResult();

				//Indexes
				let CreatePermissionsIdx = db.prepare('CREATE INDEX IF NOT EXISTS `permissions_Id` ON `permissions` ( `UserOrRole_Id` )');
				let CreateRecIdx = db.prepare('CREATE INDEX IF NOT EXISTS `rec_startTime_idx` ON `recordings` ( `startTime` )');
				let CreateSoundsIdx = db.prepare('CREATE INDEX IF NOT EXISTS `sounds_filename_idx` ON `sounds` ( `filename` )');
				let CreateActivityIdx = db.prepare('CREATE INDEX IF NOT EXISTS `user_activity_idx` ON `user_activity_log`(`time` ASC, `channel`)');

				//Execute Indexes creation
				let createIdxResult = db.transaction(() => {
					CreatePermissionsIdx.run();
					CreateRecIdx.run();
					CreateSoundsIdx.run();
					CreateActivityIdx.run();
				});
				createIdxResult();

				//Check records
				let checkUsersCount = db.prepare("SELECT count(*) AS 'count' from `users`");
				let checkCountSizeDurSounds = db.prepare("SELECT count(*) AS 'count', SUM(`size`) AS 'size', SUM(duration) AS 'duration' from `sounds`");
				let checkCountSizeDurRec = db.prepare("SELECT count(*) AS 'count', SUM(`size`) AS 'size', SUM(duration) AS 'duration' from `recordings`");

				//Check if we have any records
				let checkTables = db.transaction(() => {
					let CountUsers = checkUsersCount.get();
					utils.report("Loaded " + CountUsers.count + " records from 'users' database.", 'w');

					let CountSizeDurSounds = checkCountSizeDurSounds.get();
					utils.report("Loaded " + CountSizeDurSounds.count + " records from 'sounds' database." + (CountSizeDurSounds.count ? " (Duration " + Math.floor(100*CountSizeDurSounds.duration / 60) / 100 + " minutes, size " + Math.floor(100 * CountSizeDurSounds.size / 1048576) / 100 + " Mb)" : ""), 'w');

					let CountSizeDurRec = checkCountSizeDurRec.get();
					utils.report("Loaded " + CountSizeDurRec.count + " records from 'recordings' database." + (CountSizeDurRec.count ? " (Duration " + Math.floor(CountSizeDurRec.duration / 36000) / 100 + " hours, size " + Math.floor(100 * CountSizeDurRec.size / 1048576) / 100 + " Mb)" : ""), 'w');
				});
				checkTables();

				//PREPARE QUERIES
				this.userUpdateAddPrepare();
				this.soundUpdateAddPrepare();
				this.recordingUpdateAddPrepare();
				this.recordingAddPrepare();
				this.addPhrasePrepare();
				this.GetUserCountAtTimePrepare();

				return resolve();
			} catch (err) {
				handleError(err);
				return reject();
			}
		});
	},

	// =========== USERS ===========
	/* DB structure
		`userid`	INTEGER UNIQUE,
		`name`	TEXT,
		`guildName`	TEXT,
		`volume`	REAL DEFAULT 20.0,
		`playedSounds`	INTEGER DEFAULT 0,
		`playedYoutube`	INTEGER DEFAULT 0,
		`playedRecordings`	INTEGER DEFAULT 0,
		`lastCommand`	INTEGER,
		`lastRecording`	INTEGER,
		`recDuration`	INTEGER DEFAULT 0,
		`recFilesCount`	INTEGER DEFAULT 0,
		`uploadedSounds`	INTEGER DEFAULT 0,      */
	
	//Update or add a single user
	userUpdateAddPrepare: function () { userUpdateAddSqlStmt = db.prepare('INSERT INTO `users` (userid, `name`, guildname, volume) VALUES ($userid, $name, $guildname, $volume) ON CONFLICT(userid) DO UPDATE SET "name"= $name, guildname=$guildname'); },
	userUpdateAdd: function (userid, name, guildname, volume) {
		try {
			userUpdateAddSqlStmt.run({ userid: userid, name: name, guildname: guildname ? guildname : name, volume: volume });
		} catch (err) { handleError(err); }
	},

	//Update users database
	updateUsersDB: function (members) {
		try {
			let count = 0;
			let updateUsersDBTransaction = db.transaction(() => {
				members.forEach((member, key, map) => {
					this.userUpdateAdd(member.id, member.user.username, member.nickname, config.DefaultVolume);
					count++;
				});
			});
			updateUsersDBTransaction();
			this.fillUsersDB();
			utils.report("Updated " + count + " records in 'users' database.", 'g');
		} catch (err) { handleError(err); }
	},

	//Fillup usersVolume variable
	fillUsersDB: function () {
		//usersVolume = {};
		let rows = db.prepare('SELECT `volume`, userid from `users`').all();
		for (i in rows) {
			usersVolume[rows[i].userid] = rows[i].volume;
		}
	},

	setUserVolume: function (userid, value) {
		try {
			usersVolume[userid] = value;
			db.prepare('UPDATE `users` SET volume = $volume, lastCommand=$date WHERE userid = $userid').run({ userid: userid, volume: value, date: Date.now() });
		} catch (err) { handleError(err); }
	},
	userPlayedSoundsInc: function (userid) { try { db.prepare('UPDATE `users` SET playedSounds = playedSounds+1, lastCommand=$date WHERE userid = $userid').run({ userid: userid, date: Date.now() }); } catch (err) { handleError(err); } },
	userPlayedYoutubeInc: function (userid) { try { db.prepare('UPDATE `users` SET playedYoutube = playedYoutube+1, lastCommand=$date WHERE userid = $userid').run({ userid: userid, date: Date.now() }); } catch (err) { handleError(err); } },
	userPlayedRecsInc: function (userid) { try { db.prepare('UPDATE `users` SET playedRecordings = playedRecordings+1, lastCommand=$date WHERE userid = $userid').run({ userid: userid, date: Date.now() }); } catch (err) { handleError(err); } },
	userUploadedSoundsInc: function (userid) { try { db.prepare('UPDATE `users` SET uploadedSounds = uploadedSounds+1 WHERE userid = $userid').run({ userid: userid }); } catch (err) { handleError(err); } },

	//getUserVolume: function (userid) { let row; try { row = db.prepare("SELECT `volume` from `users` WHERE userid = ?").get(userid); } catch (err) { handleError(err); } if (row) return row.volume; else return config.DefaultVolume; },
	getUserVolume: function (userid) { if (usersVolume[userid]) return usersVolume[userid]; else return config.DefaultVolume; },
	getUserPlayedSounds: function (userid) { let row; try { row = db.prepare("SELECT playedSounds from users WHERE userid = $userid").get({ userid: userid }); } catch (err) { handleError(err); } if (row) return row.playedSounds; else return 0; },
	getUserPlayedYoutube: function (userid) { let row; try { row = db.prepare("SELECT playedYoutube from users WHERE userid = $userid").get({ userid: userid }); } catch (err) { handleError(err); } if (row) return row.playedYoutube; else return 0; },
	getUserUploadedSounds: function (userid) { let row; try { row = db.prepare("SELECT uploadedSounds from users WHERE userid = $userid").get({ userid: userid }); } catch (err) { handleError(err); } if (row) return row.uploadedSounds; else return 0; },
	getUserGuildName: function (userid) { let row; try { row = db.prepare("SELECT guildName from users WHERE userid = $userid").get({ userid: userid }); } catch (err) { handleError(err); } if (row) return row.guildName; else return userid; },

	// =========== SOUNDS ===========
	/* DB structure
		`filenameFull`	TEXT UNIQUE,
		`filename`	TEXT,
		`extension`	TEXT,
		`volume`	REAL DEFAULT 100,
		`duration`	REAL DEFAULT 0,
		`size`	INTEGER DEFAULT 0,
		`bitrate`	REAL DEFAULT 0,
		`playedCount`	INTEGER DEFAULT 0,
		`uploadedBy`	INTEGER DEFAULT 0,
		`uploadDate`	INTEGER,
		`lastTimePlayed`	INTEGER,
		`exists`	INTEGER DEFAULT 1,           */

	//Update or add a single sound record
	soundUpdateAddPrepare: function () { soundUpdateAddSqlStmt = db.prepare('INSERT INTO `sounds` (filenameFull, filename, extension, duration, size, bitrate, uploadedBy, uploadDate) VALUES ($filenameFull, $filename, $extension, $duration, $size, $bitrate, $uploadedBy, $uploadDate) ON CONFLICT(filenameFull) DO UPDATE SET filename=$filename, extension=$extension, duration=$duration, size=$size, `exists`=1'); },
	soundUpdateAdd: function (filenameFull, duration, size, bitrate, uploadedBy = 0) {
		try {
			let fileNameParse = path.parse(filenameFull);
			soundUpdateAddSqlStmt.run({ filenameFull: filenameFull, filename: fileNameParse.name, extension: fileNameParse.ext, duration: duration, size: size, uploadedBy: uploadedBy, uploadDate: Date.now(), bitrate: bitrate });
		} catch (err) { handleError(err); }
	},

	//Update list of files and make sure we have it in the DB
	scanSoundsFolder: function () {
		return new Promise((resolve, reject) => {
			try {
				db.prepare('UPDATE `sounds` SET `exists` = 0 WHERE 1').run();
				let scanSoundsFolderDBTransaction = db.transaction((inputs) => {
					while (element = inputs.shift())
						this.soundUpdateAdd(element.filenameFull, element.duration, element.size, element.bitrate);
				});

				let dataToInsert = [];
				fs.readdir(path.resolve(__dirname, config.folders.Sounds), (err, files) => {
					let checkCount = 0;
					async.eachLimit(files, config.FfmpegParallelProcLimit, (file, callback) => {
						checkCount++;
						utils.checkAudioFormat(path.resolve(__dirname, config.folders.Sounds, file))
							.then(result => {
								let fileNameParse = path.parse(file);
								if (result['mode'] != 'none' && result['metadata'].format)
									dataToInsert.push({ filenameFull: file, duration: result['metadata'].format.duration, size: result['metadata'].format.size, bitrate: result['metadata'].format.bit_rate })
								if (config.DBInsertsPerTransaction > 0 && dataToInsert.length >= config.DBInsertsPerTransaction)
									scanSoundsFolderDBTransaction(dataToInsert);
								callback();
							})
							.catch(err => {
								utils.report("Couldn't execute ffprobe on '" + file + "' file. Reason: " + err, 'y');
								callback();
							});
					}, () => {
						scanSoundsFolderDBTransaction(dataToInsert);
						utils.report("Found " + checkCount + " sound files, Database updated!", 'g');
						return resolve();
					});
				});
			} catch (err) {
				handleError(err);
				return resolve();
			}
		});
	},

	setSoundVolume: function (filename, value) { try { db.prepare('UPDATE `sounds` SET volume = $value WHERE filenameFull = $filenameFull').run({ filenameFull: filename, value: value }); } catch (err) { handleError(err); } },
	renameSound: function (filenameFull, filenameFullNew, filename, extension) { try { db.prepare('UPDATE `sounds` SET filenameFull = $filenameFullNew, filename=$filename, extension=$extension WHERE filenameFull = $filenameFull').run({ filenameFull: filenameFull, filenameFullNew: filenameFullNew, filename: filename, extension: extension }); } catch (err) { handleError(err); } },
	deleteSound: function (filename) { try { db.prepare('DELETE FROM `sounds` WHERE filenameFull = $filenameFull').run({ filenameFull: filename }); } catch (err) { handleError(err); } },
	soundPlayedInc: function (filename) { try { db.prepare('UPDATE `sounds` SET playedCount = playedCount+1, lastTimePlayed=$lastTimePlayed WHERE filenameFull = $filenameFull').run({ filenameFull: filename, lastTimePlayed: Date.now() }); } catch (err) { handleError(err); } },

	//Return filename array of a sound by full or partial search request
	findSound: function (search) {
		return new Promise((resolve, reject) => {
			let result = {};
			try {
				//First, search for a full name
				let fullSearch = db.prepare("SELECT filenameFull, filename, extension, volume, duration, `size`, bitrate, playedCount, cast(uploadedBy AS text) AS uploadedBy, uploadDate, lastTimePlayed from `sounds` WHERE filename=? AND `exists`=1").get(search);
				//Found exact match
				if (fullSearch) {
					result['count'] = 1;
					result['sound'] = fullSearch;
					return resolve(result);
				}
				else {
					let partialSearch = db.prepare("SELECT filenameFull, filename, extension, volume, duration, size, bitrate, playedCount, cast(uploadedBy AS text) AS uploadedBy, uploadDate, lastTimePlayed from `sounds` WHERE filename LIKE ? AND `exists`=1 ORDER BY filename ASC").all("%"+search.toLowerCase()+"%");
					if (partialSearch) {
						result['count'] = partialSearch.length;
						result['sound'] = partialSearch[0];
						return resolve(result);
					}
					else
						return resolve(result);
				}
			} catch (err) {
				handleError(err);
				return resolve(result);
			}
		});
	},

	//Return list of all sounds in DB
	getSoundsList: function () {
		return new Promise((resolve, reject) => {
			let result = [];
			try {
				let rows = db.prepare("SELECT filename FROM sounds WHERE `exists`=1 ORDER BY filename ASC").all();
				if (rows) {
					rows.forEach(row => {
						result.push(row.filename);
					});
					return resolve(result);
				}
				else
					return resolve(result);
			} catch (err) {
				handleError(err);
				return resolve(result);
			}
		});
	},

	// =========== VOICE RECORDINGS ===========
	/* DB structure 'recordings'
		`id`	INTEGER PRIMARY KEY AUTOINCREMENT UNIQUE,
		`filename`	TEXT UNIQUE,
		`startTime`	INTEGER,
		`userId`	INTEGER,
		`duration`	INTEGER,
		`size`	INTEGER,
		`exists`	INTEGER DEFAULT 1,
		`hidden`	INTEGER DEFAULT 0                     */


    //Get first and last date for list of users (or all users if none provided)
    getRecDates: function (users=[]) {
        let output = { first:0, last:0, count:0, random:0 };
		let addition = " AND ( ";
		for (i in users) addition += "userId='" + users[i] + "' OR ";
		addition += " )";
		try {
			row = db.prepare("SELECT MIN(startTime) AS 'min', MAX(startTime) AS 'max', COUNT(*) AS 'count' FROM `recordings` WHERE `exists`=1 " + (addition.length>9 ? addition : "")).get();
			if (row) {
				output.first = row.min;
				output.last = row.max;
				output.count = row.count;
				//output.random = Math.floor(Math.random() * (output.last - output.first)) + output.first;
				return output;
			}
			else
				return output;
		} catch (err) {
			handleError(err);
		}
        return output;
    },

	//Add or update recording in DB
	recordingUpdateAddPrepare: function () { recordingUpdateAddSqlStmt = db.prepare('INSERT INTO "recordings" (filename, startTime, userId, duration, size) VALUES ($filename, $startTime, $userId, $duration, $size) ON CONFLICT(filename) DO UPDATE SET startTime=$startTime, userId=$userId, duration=$duration, size=$size, `exists`=1'); },
	recordingUpdateAdd: function (filename, startTime, userId, duration, size) {
			try {
				recordingUpdateAddSqlStmt.run({ filename: filename, startTime: startTime, userId: userId, duration: duration, size: size });
			} catch (err) { handleError(err); }
	},

	//Add recording to DB (when we know its a new one for sure)
	recordingAddPrepare: function () { recordingAddSqlStmt = db.prepare('INSERT INTO "recordings" (filename, startTime, userId, duration, size) VALUES ($filename, $startTime, $userId, $duration, $size)'); },
	recordingAdd: function (file, startTime, duration, userId, size, ignorePhrases = true, channel = null, usersListening=0) {
		try {
			let lastOne = recordingAddSqlStmt.run({ filename: file, startTime: startTime, userId: userId, duration: duration, size: size });
			if (!ignorePhrases && lastOne && channel) {
				if (lastOne.changes > 0 && lastOne.lastInsertRowid > -1) {
					this.checkForNewPhrases({ id: lastOne.lastInsertRowid, startTime: startTime, userId: userId, duration: duration }, channel, usersListening, false);
				}
			}
		} catch (err) { handleError(err); }
	},

	//Scan RecordingsFolder and update recDB
	scanRecordingsFolder: function () {
		return new Promise((resolve, reject) => {
			try {
				db.prepare('UPDATE "recordings" SET `exists` = 0 WHERE 1').run();
				let scanRecordingsFolderDBTransaction = db.transaction((inputs) => {
					while (element = inputs.shift())
						this.recordingUpdateAdd(element.filename, element.startTime, element.userId, element.duration, element.size);
				});
				fs.readdir(path.resolve(__dirname, config.folders.VoiceRecording), (err, files) => {
					let dataToInsert = [];
					let checkCount = 0;
					let lastReportTime = 0;
					let totalDuration = 0;
					let totalSize = 0;

					async.eachLimit(files, config.FileScanParallelLimit, (file, callback) => {
						checkCount++;
						let parsed = utils.parseRecFilename(file);
						if (parsed) {
							totalDuration += parsed.duration;
							let thisSize = fs.statSync(path.resolve(__dirname, config.folders.VoiceRecording, file)).size;
							totalSize += thisSize;
							dataToInsert.push({ filename: file, startTime: parsed.startTime, userId: parsed.userId, duration: parsed.duration, size: thisSize });
						}
						//Periodically report progress of the scan to the console
						if (Date.now() - lastReportTime >= 1000 || checkCount == files.length) {
							utils.report("ScanRecordings scan progress: " + checkCount + "/" + files.length + " (" + (Math.round(10000 * checkCount / files.length) / 100) + " %) done...", 'c');
							lastReportTime = Date.now();
						}
						//Check if we need to send a new transfer
						if (config.DBInsertsPerTransaction > 0 && dataToInsert.length >= config.DBInsertsPerTransaction)
							scanRecordingsFolderDBTransaction(dataToInsert);

						callback();
					}, () => {
						utils.report("Found " + checkCount + " voice recordings (Duration " + Math.floor(totalDuration / 36000) / 100 + " hours, size " + Math.floor(100 * totalSize / 1048576) / 100 + " Mb). Creating talk sessions...", 'g');
						scanRecordingsFolderDBTransaction(dataToInsert);

						//Calculate talk sessions list
						this.calculateTalksList(config.GapForNewTalkSession * 60000, 0, 0, 0, [], true)
							.then(() => {
								//Scan for phrases
								this.scanForPhrases()
									.then(() => {
										return resolve();
									});
							});
					});
				});
			} catch (err) {
				handleError(err);
				return resolve(true);
			}
		});
	},

	//Check if we need to scan recordings folder and launch it if needed
	checkRecordingsScanNeeded: function () {
		return new Promise((resolve, reject) => {
			if(config.CheckRecFolderOnStartup) {
				utils.report("Checking for 'Recordings' database integrity (this may take a while)...", 'w');
				let result = db.prepare("SELECT count(*) AS 'count', MIN(startTime) AS 'first', MAX(startTime) AS 'last', SUM(duration) AS 'dur' from `recordings` WHERE `exists`=1").get();
				let dbRecordsCount = result ? result.count : 0;
				let totalDurationFromDB = result ? result.dur : 0;
				let DBStartTime = result ? result.first : 0;
				let DBLastTime = result ? result.last : 0;

				//Get starting and ending time from the DB
				StartEnd = this.getRecDates();

				//Get files in the folder
				let totalDurationFiles = 0;
				fs.readdir(path.resolve(__dirname, config.folders.VoiceRecording), (err, files) => {
					//let files = [];
					////Delete unwanted files from this list in Windows
					//if (process.platform === "win32") {
					//	while (file = outFiles.shift()) {
					//		if (['.ini'].indexOf(path.extname(file).toLowerCase()) == -1)
					//			files.push(file);
					//	}
					//}
					//else
					//	files = outFiles;

					if (dbRecordsCount == files.length || dbRecordsCount+1 == files.length) {
						//Sum up all durations
						for (i in files) {
							let parsed = utils.parseRecFilename(files[i]);
							if (parsed)
								totalDurationFiles += parsed.duration;
						}
					}
					let firstFileParse = utils.parseRecFilename(files[0]);
					let firstFileTime = firstFileParse ? firstFileParse.startTime : 0;
					let lastFileParse = utils.parseRecFilename(files[files.length - 1]);
					let lastFileTime = lastFileParse ? lastFileParse.startTime : 0;

					if (dbRecordsCount == files.length &&
						firstFileTime == DBStartTime &&
						lastFileTime == DBLastTime &&
						totalDurationFiles == totalDurationFromDB) {

						//Looks like everything is fine, no need to rescan the folder
						return resolve();
					}
					else {
						//console.log("dbRecordsCount " + dbRecordsCount + " == " + files.length + "\n"
						//	+ "firstFileTime " + firstFileTime + " == " + DBStartTime + "\n"
						//	+ "lastFileTime " + lastFileTime + " == " + DBLastTime + "\n"
						//	+ "totalDurationFiles" + totalDurationFiles + " == " + totalDurationFromDB);

						//Rescan is needed!
						utils.report("Found mismatch on database records and files in the '" + config.folders.VoiceRecording + "' folder! Rescanning...", 'y');
						this.scanRecordingsFolder()
							.then(() => { return resolve(); });
					}
				});
			}
			else return resolve();
		});
	},

	//Create a list of files based on time and user request
	makeRecFileList: function (dateMs, mode = { how: 'sequence', duration:300000, gapToStop:30000, gapToAdd:100, endTime:0 }, timeLimitMs=0, users = [], includeHidden=false) {
        let foundResult = false;
        let peneterated = false;
        let currentResultDuration = 0;
        let totalAudioDuration = 0;
        let StartTime = 0;
        let FurthestEndingTime = 0;
        let currentOffset = 0;
        let statGapsAdded = 0;
		let statGapsRemoved = 0;
		let statFilesCount = 0;
		let thisgap = 0;
		let output = {};
		let result = [];
		let lastElement = {};
		let channelsToMix = [];
		let additionalCondition = "";
		//let endTimeCut = mode.how == "sequence" ? dateMs + config.SearchHoursPeriod * 3600000 : dateMs + timeLimitMs;
		let endTimeCut = mode.endTime ? mode.endTime : dateMs + config.SearchHoursPeriod * 3600000;
		
		function setOutputParams() {
			output['list'] = result;
			output['duration'] = currentResultDuration;
			output['startTime'] = StartTime;
			output['endTime'] = FurthestEndingTime;
			output['channelsToMix'] = channelsToMix.length;
			output['totalAudioDuration'] = totalAudioDuration;
			output['method'] = peneterated ? 'mix' : 'concat';
			output['GapsRemoved'] = statGapsRemoved;
			output['GapsAdded'] = statGapsAdded;
			output['filesCount'] = statFilesCount;
		}
		//Set users params
		let usersDict = {};
		if (users.length > 0) {
			additionalCondition += " AND (";
			for (i in users) {
				additionalCondition += " userId=$user" + i + "r OR";
				usersDict['user' + i + "r"] = users[i];
			}
			additionalCondition = additionalCondition.slice(0, additionalCondition.length - 2);
			additionalCondition += ")";
		}

		try {
			//mode: { how: 'sequence', duration:300000, gapToStop:30000, gapToAdd:100 } - list files sequentially untill duration is reached or gap between files is longer than gapToStop
			if (mode.how == 'sequence') {

				let inputParams = Object.assign({}, { recDurationThreshold: config.IgnoreRecordingDuration, startTime: dateMs, endTime: endTimeCut }, usersDict);

				const recStatement = db.prepare('SELECT filename, startTime, cast(userId AS text) AS userId, duration FROM recordings WHERE `exists`=1 AND duration>$recDurationThreshold AND startTime>$startTime AND startTime<$endTime ' + additionalCondition + " ORDER BY startTime ASC");
				for (const rec of recStatement.iterate(inputParams)) {

					//If its first iteration
					if (result.length == 0) {
						StartTime = rec.startTime;
						channelsToMix.push({ lastTime: rec.startTime + rec.duration, lastOffset: 0 });
					}
					else {
						if (FurthestEndingTime < lastElement['startTime'] + lastElement['duration'])
							FurthestEndingTime = lastElement['startTime'] + lastElement['duration'];
					}


					//If we reached duration or gap limit, return result
					if (currentResultDuration >= mode.duration && currentResultDuration || (mode.gapToStop > 0 && rec['startTime'] - (lastElement['startTime'] ? (lastElement['startTime'] + lastElement['duration']) : rec['startTime']) > mode.gapToStop)) {
						setOutputParams();
						return output;
					}
					else {
						let addToThisChannel = 0;
						//Check if audio is peneterating with anything else
						if (FurthestEndingTime > rec['startTime']) {
							peneterated = true;
							//console.log("Peneteration: " + (FurthestEndingTime - rec['startTime']) + 'ms on "'+i+'"');

							//Check which channel is free and add file there or make a new channel
							let needToAddNewChannel = true;
							for (i in channelsToMix) {
								if (channelsToMix[i].lastTime <= rec['startTime']) {
									needToAddNewChannel = false;
									addToThisChannel = i;
									break;
								}
							}
							if (needToAddNewChannel) {
								channelsToMix.push({ lastTime: StartTime, lastOffset: 0 });
								addToThisChannel = channelsToMix.length - 1;
							}
						}
						//Remove or add the gap
						else {
							let gap = FurthestEndingTime ? rec['startTime'] - FurthestEndingTime : 0;
							if (mode.gapToAdd > 0 && FurthestEndingTime) {
								currentOffset += mode.gapToAdd - gap;
								thisgap = mode.gapToAdd - gap;
								if (mode.gapToAdd - gap >= 0) statGapsAdded += mode.gapToAdd - gap;
								else statGapsRemoved += gap - mode.gapToAdd;
							}
							else {
								currentOffset -= gap;
								thisgap = gap;
								statGapsRemoved += gap;
							}
						}
						//Add the result
						//rec['startTime'] + currentOffset - channelsToMix[addToThisChannel].lastTime
						let delay = (rec['startTime'] + currentOffset - (channelsToMix[addToThisChannel].lastTime + channelsToMix[addToThisChannel].lastOffset))
						result.push({ file: path.resolve(__dirname, config.folders.VoiceRecording, rec['filename']), delay: delay, channel: addToThisChannel });
						channelsToMix[addToThisChannel].lastTime = rec['startTime'] + rec['duration'];
						channelsToMix[addToThisChannel].lastOffset = currentOffset;
						statFilesCount++;

						currentResultDuration = rec['startTime'] + rec['duration'] + currentOffset - StartTime;

						totalAudioDuration += rec['duration'];
						lastElement = rec;
					}


				}
			}
			//mode: { how: 'phrase', minDuration:3000, allowedGap:300, gapToAdd:100 } - search for a phrase that is longer than minDuration and has pauses between files less than allowedGap ms
			else if (mode.how == 'phrase') {
				if (config.PhraseSourceUsersCountOnChannel > 0) {
					additionalCondition += " AND usersListening >=$usersListening";
					usersDict['usersListening'] = config.PhraseSourceUsersCountOnChannel;
				}
				//Get random phrase
				let minMax = db.prepare('SELECT cast(userId AS text) AS userId, idStart, recs FROM phrases WHERE duration>=$duration ' + additionalCondition + ' ORDER BY random() LIMIT 1').get(Object.assign({}, { duration: mode.minDuration }, usersDict));
				if (minMax) {
					output['author'] = minMax.userId;
					let rows = db.prepare('SELECT filename, startTime, cast(userId AS text) AS userId, duration FROM recordings WHERE `exists`=1 AND id >= $id AND userId=$userId ORDER BY startTime ASC LIMIT $limit').all({ id: minMax.idStart, userId: minMax.userId, limit: minMax.recs });
					if (rows) {
						StartTime = rows[0].startTime;
						for (i in rows) {
							result.push({ file: path.resolve(__dirname, config.folders.VoiceRecording, rows[i]['filename']) });
							statFilesCount++;
							currentResultDuration = rows[i]['startTime'] + rows[i]['duration'] + currentOffset - StartTime;
							totalAudioDuration += rows[i]['duration'];
							lastElement = rows[i];
							FurthestEndingTime = rows[i]['startTime'] + rows[i]['duration'];
						}
						setOutputParams();
						return output;
					}
				}
			}
			//If we looped throught all results and didnt fit output conditions
			if (result.length > 0) {
				if (mode.how == 'sequence') {
					setOutputParams();
					if (!output.list)
						return false;
					return output;
				}
				else
					return false;
			}
		} catch (err) { handleError(err); }
		return false;
	},

	// =========== TALK SESSIONS ===========
	/* DB structure `talk_sessions`
		`id`	INTEGER PRIMARY KEY AUTOINCREMENT UNIQUE,
		`startTime`	INTEGER,
		`endTime`	INTEGER,
		`duration`	INTEGER,
		`usersCount`	INTEGER,
		`usersList`	TEXT,
		`count`	INTEGER                     */

	//Add record to talk_sessions table
	AddTalkSession: function (ResultListElement) {
		try {
			db.prepare('INSERT INTO "talk_sessions" (startTime, endTime, duration, usersCount, usersList, count) VALUES ($startTime, $endTime, $duration, $usersCount, $usersList, $count)').run({ startTime: ResultListElement.start, endTime: ResultListElement.end, duration: ResultListElement.duration, usersCount: ResultListElement.users.length, usersList: JSON.stringify(ResultListElement.users), count: ResultListElement.count });
		} catch (err) { handleError(err); }
	},

	//Calculate list of 'talk sessions' based on user, duration and gap between records
	calculateTalksList: function (gapForNextTalkMs, minTalkDuration = 0, startTime = 0, EndTime = 0, users = [], addToDB = false) {
		return new Promise((resolve, reject) => {
			try {
				let thisStartTime = 0;
				let lastRecordTime = 0;
				let ThisDuration = 0;
				let recCount = 0
				let userList = []
				function resetVariables() {
					thisStartTime = 0;
					ThisDuration = 0;
					lastRecordTime = 0;
					recCount = 0
					userList = [];
				}
				let additionalCondition = "";
				let flags = {};
				let ResultList = [];
				//add start time
				if (startTime) {
					additionalCondition += " AND startTime>$startTime ";
					flags['startTime'] = startTime;
				}
				//add end time
				if (EndTime) {
					additionalCondition += " AND startTime<$endTime ";
					flags['endTime'] = EndTime;
				}
				//add user list
				if (users.length > 0) {
					additionalCondition += " AND (";
					for (i in users) {
						additionalCondition += " userId=$user" + i + "r OR";
						flags['user' + i + "r"] = users[i];
					}
					additionalCondition = additionalCondition.slice(0, additionalCondition.length - 2);
					additionalCondition += ")";
				}
				const result = db.prepare('SELECT * FROM recordings WHERE 1 ' + additionalCondition + " ORDER BY startTime ASC").all(flags);
				for (i in result) {
					//Check if current record is too far away
					if (result[i]['startTime'] - lastRecordTime >= gapForNextTalkMs) {
						//If current talk is long enough and it has more that one users and recordings add it to result list
						if (ThisDuration > minTalkDuration && userList.length > 1 && recCount > 0)
							ResultList.push({ start: thisStartTime, end: lastRecordTime, duration: ThisDuration, count: recCount, users: userList });
						resetVariables();
					}
					if (!thisStartTime)
						thisStartTime = result[i].startTime;
					if (userList.indexOf(result[i]['userId']) == -1)
						userList.push(result[i]['userId']);
					lastRecordTime = result[i].startTime;
					ThisDuration += result[i].duration;
					recCount++;
				}
				//Add records to the database
				if (addToDB) {
					let execTransaction = db.transaction(() => {
						db.prepare('DELETE FROM "talk_sessions"').run();
						for (i in ResultList)
							this.AddTalkSession(ResultList[i]);
					});
					execTransaction();
					utils.report("Added " + ResultList.length + " talk sessions.", 'g');
				}
				return resolve(ResultList);
			} catch (err) {
				handleError(err);
				return resolve([]);
			}
		});
	},

	//Get list of 'talk sessions' from the database
	getTalksList: function (startTime = 0, limit=0, users=[]) {
		let output = { result: [], totalDuration: 0, talks: 0 };
		let usersCondition = "";
		let usersDict = {};
		try {
			//Get users name list
			const serverUsers = db.prepare('SELECT userid, guildName FROM users').all();
			let usernames = {};
			for (i in serverUsers)
				usernames[serverUsers[i].userid] = serverUsers[i].guildName;
			//Prepare condition with users
			if (users.length > 0) {
				usersCondition += " AND (";
				for (i in users) {
					usersCondition += " usersList LIKE $user" + i + "r OR";
					usersDict['user' + i + "r"] = users[i];
				}
				usersCondition = usersCondition.slice(0, usersCondition.length - 2);
				usersCondition += ")";
			}
			//Get talks list
			const rows = db.prepare('SELECT * FROM talk_sessions WHERE startTime>$startTime ' + usersCondition+' ORDER BY startTime ASC' + (limit > 0 ? " LIMIT $limit" : "")).all({ startTime: startTime, limit: limit });
			
			for (i in rows) {
				//result.push("`id45` __Jan 23 2018 21:54 CET__ (Duration: 45 minutes, Playback: 30 min).  3 users: *Falanor, FunkyJunky, Coronatorum*");
				output.totalDuration += rows[i].duration;
				output.talks++;
				let users = JSON.parse(rows[i].usersList);
				let userList = "";
				for (user in users)
					userList += usernames[users[user]] + ", ";
				if (userList)
					userList = userList.slice(0, userList.length - 2);
				output.result.push("`id" + rows[i].id + "` __" + utils.getDateFormatted(rows[i].startTime, "ddd D MMM YYYY HH:mm z") + "__ (Duration " + utils.humanTime((rows[i].endTime - rows[i].startTime) / 1000) + ", Playback " + utils.humanTime(rows[i].duration / 1000) + "). " + rows[i].usersCount+" users" + (rows[i].usersCount <= 5 ? ": *" + userList + "*;" : ";"));
			}
		} catch (err) { handleError(err); }
		return output;
	},

	getTalkSession: function (id) {
		try {
			return db.prepare('SELECT * FROM talk_sessions WHERE id=?').get(id);
		} catch (err) { handleError(err); }
	},

	// =========== USER ACTIVITY LOG ===========
	/* DB structure `user_activity_log`
		`id`	INTEGER PRIMARY KEY AUTOINCREMENT UNIQUE,
		`userId`	INTEGER,
		`time`	INTEGER,
		`channel`	INTEGER,
		`action`	INTEGER,
		`resultUsersChannCount`	INTEGER                     */

	// Actions: 0 - Joined, 1 - Left, 2 - Switched

	//Add activity record
	AddUserActivity: function (UserId, channelId, action, resultUsersChannCount) {
		try {
			db.prepare('INSERT INTO "user_activity_log" (userId, time, channel, action, resultUsersChannCount) VALUES ($userId, $time, $channel, $action, $resultUsersChannCount)').run({ userId: UserId, time: Date.now(), channel: channelId, action: action, resultUsersChannCount: resultUsersChannCount });
		} catch (err) { handleError(err); }
	},

	//Get users count on the channel at a time
	GetUserCountAtTimePrepare: function () { GetUserCountAtTimeSqlStmt = db.prepare('SELECT resultUsersChannCount FROM user_activity_log WHERE channel=$channelId AND `time`<=$time ORDER BY `time` DESC LIMIT 1'); },
	GetUserCountAtTime: function (channelId, time) {
		try {
			let result = GetUserCountAtTimeSqlStmt.get({ channelId: channelId, time: time });
			if (result)
				return result.resultUsersChannCount;
			else
				return 0;
		} catch (err) {
			handleError(err);
			return 0;
		}
	},

	//Return information about user's presence on the channel at the given time
	UserPresenceInfo: function (userId, time, channel=null) {
		let result = { presented: false };
		
		//Last action of this user before time
		let before = db.prepare("SELECT `time`, `action`, channel FROM user_activity_log WHERE `time`<=$time AND userId=$userId ORDER BY `time` DESC LIMIT 1").get({ time: time, userId: userId });
		if (before) {
			//If last action was joining or switching
			if ((before.action == 0 || before.action == 2) && (channel ? before.channel == channel : true)) {
				result['joined'] = before.time;
				result['channel'] = before.channel;
				result.presented = true;
				//Next action of this user after time
				let after = db.prepare("SELECT `time`, `action`, channel FROM user_activity_log WHERE `time`>$time AND userId=$userId ORDER BY `time` ASC LIMIT 1").get({ time: time, userId: userId });
				if (after) {
					if (after.action == 1 || after.action == 2) {
						result['left'] = after.time;
					}
				}
			}
		}
		return result;
	},

	//Return true if user was on the channel at this time
	CheckUserPresence: function (userId, time, channel=null) {
		let result = { presented: false };
		//Bot's presence
		let botPr = this.UserPresenceInfo(0, time, channel);
		
		//User's presence
		let userPr = this.UserPresenceInfo(userId, time, botPr.presented ? botPr.channel : channel);
		

		if (userPr.presented && botPr.presented) {
			result.presented = true;
			let lastTime = Math.min(userPr.left, botPr.left);
			if (lastTime) result.lastTime = lastTime;
		}

		return result;
	},


	// =========== PHRASES ===========
	/* DB structure `phrases` 
		`id`	INTEGER PRIMARY KEY AUTOINCREMENT UNIQUE,
		`userId`	INTEGER,
		`idStart`	INTEGER,
		`recs`	INTEGER,
		`timeStart`	INTEGER,
		`duration`	INTEGER
		`usersListening`	INTEGER
		`channel`	INTEGER           */

	//Add a phrase to DB
	addPhrasePrepare: function () { addPhraseSqlStmt = db.prepare('INSERT INTO "phrases" (userId, idStart, recs, timeStart, duration, usersListening, channel) VALUES ($userId, $idStart, $recs, $timeStart, $duration, $usersListening, $channel)'); },
	addPhrase: function (userId, idStart, recs, timeStart, duration, usersListening, channel) {
		try {
			addPhraseSqlStmt.run({ userId: userId, idStart: idStart, recs: recs, timeStart: timeStart, duration: duration, usersListening: usersListening, channel: channel });
		} catch (err) { handleError(err); }
	},
	//Same as above but with array
	addPhraseObjArray: function () {
		try {
			if (phrasesToAddToDBBuffer.length > 0) {
				let addPhraseDBTransaction = db.transaction(() => {
					while (element = phrasesToAddToDBBuffer.shift()) {
						addPhraseSqlStmt.run(element);
					}
				});
				addPhraseDBTransaction();
			}
		} catch (err) { handleError(err); }
	},

	//Process new recording for phrases
	checkForNewPhrases: function (row, channel, usersListening, dontAddToDBYet=false) {
		//If there any previous records
		if (recBuffer[row.userId]) {
			let duration = 0;
			let lastTime = 0;
			for (rec in recBuffer[row.userId]) {
				duration += recBuffer[row.userId][rec].duration;
				lastTime = recBuffer[row.userId][rec].startTime + recBuffer[row.userId][rec].duration;
			}
			//if enough time passed and buffer reached needed duration, add it to phrases
			if (duration >= config.PhraseMsDuration && row.startTime - lastTime > config.PhraseAllowedGapMsTime) {
				if (dontAddToDBYet) {
					let toAdd = { userId: row.userId, idStart: recBuffer[row.userId][0].id, recs: recBuffer[row.userId].length, timeStart: recBuffer[row.userId][0].startTime, duration: duration, usersListening: usersListening, channel: channel }
					phrasesToAddToDBBuffer.push(toAdd);
					//phrasesToAddToDBBuffer.push({ userId: row.userId, idStart: idStart, recs: recs, timeStart: timeStart, duration: duration });
				}
				else
					this.addPhrase(row.userId, recBuffer[row.userId][0].id, recBuffer[row.userId].length, recBuffer[row.userId][0].startTime, duration, usersListening, channel);
				//Reset buffer for this user
				recBuffer[row.userId] = [];
				recBuffer[row.userId].push(row);
				return 1;
			}
			//If enough time passed but duration was not reached, remove these records
			else if (duration < config.PhraseMsDuration && row.startTime - lastTime > config.PhraseAllowedGapMsTime) {

				recBuffer[row.userId] = [];
				recBuffer[row.userId].push(row);
			}
			//Else, add recording to the buffer and do nothing
			else {
				recBuffer[row.userId].push(row);
			}
		}
		else {
			recBuffer[row.userId] = [];
			recBuffer[row.userId].push(row);
			
		}
		return 0;
	},

	//Scan recordings for phrases
	scanForPhrases: function () {
		return new Promise((resolve, reject) => {
			try {
				let checkCount = 0;
				let lastReportTime = 0;
				let phrasesFound = 0;
				let lastJoinedByBotChannelId = null;
				let leftBotChannelTime = 0;

				db.prepare('DELETE FROM phrases').run();
				let rows = db.prepare('SELECT id, startTime, cast(userId AS text) AS userId, duration FROM recordings WHERE `exists`=1 ORDER BY startTime ASC').all();

				if (rows) {
					for (i in rows) {
						checkCount++;
						//Get current channel
						if (!lastJoinedByBotChannelId || leftBotChannelTime < rows[i].startTime) {
							lastJoinedByBotChannelId = null;
							leftBotChannelTime = 0;
							let joinRes = db.prepare('SELECT cast(channel AS text) AS channel FROM user_activity_log WHERE `time`<=$time AND userId="0" AND ( action="0" OR action="2" ) ORDER BY `time` DESC LIMIT 1').get({ time: rows[i].startTime });
							if (joinRes) lastJoinedByBotChannelId = joinRes.channel;

							let leftRes = db.prepare('SELECT `time` FROM user_activity_log WHERE `time`>$time AND userId="0" ORDER BY `time` ASC LIMIT 1').get({ time: rows[i].startTime });
							if (leftRes) leftBotChannelTime = leftRes.time;
							if (!lastJoinedByBotChannelId) lastJoinedByBotChannelId = "0"; //<= Unknown channel for compitability with the old bot version
						}

						//If we figured out the channel
						if (lastJoinedByBotChannelId) {
							//Get current users count on the channel
							let userCount = this.GetUserCountAtTime(lastJoinedByBotChannelId, rows[i].startTime);
							//If we figured out amount of users
							if (userCount) {
								phrasesFound += this.checkForNewPhrases(rows[i], lastJoinedByBotChannelId, userCount, true);
								//Add to the database through a transaction if buffer is big enough
								if (phrasesToAddToDBBuffer.length >= config.DBInsertsPerTransaction) {
									this.addPhraseObjArray();
								}
							}
						}

						//Periodically report progress of the scan to the console
						if (Date.now() - lastReportTime >= 1000 || checkCount == rows.length) {
							utils.report("Phrases scan progress: " + checkCount + "/" + rows.length + " (" + (Math.round(10000 * checkCount / rows.length) / 100) + " %) done. Found " + phrasesFound + " phrases so far...", 'c');
							lastReportTime = Date.now();
						}
					}
					this.addPhraseObjArray();
					return resolve(true);
				}
			} catch (err) {
				handleError(err);
				return resolve(true);
			}
		});
	}

}