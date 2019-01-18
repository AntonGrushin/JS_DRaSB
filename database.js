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
const sqlite3 = require('sqlite3').verbose();
//var db = new sqlite3.Database('sqlite.db');
//var db = new sqlite3.Database(':memory:');
const Database = require('better-sqlite3');
const db = new Database('sqlite.db', { memory: false });

//Private variables
var usersVolume = {};
var soundsDB = {};

//Technical
var lastRecDBUpdate = 0;
var RecUpdateInQueue = false;

//SQL statements
var userUpdateAddSqlStmt;
var soundUpdateAddSqlStmt;
var recordingUpdateAddSqlStmt;
var recordingAddSqlStmt;

function handleError(error) {
	if (error) utils.report("Database error: " + error, 'r');
}

module.exports = {

	//Clean up function on progra exit
	shutdown: function () {
		db.close();
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

			try {
				//Execute DB creation
				let createDBResult = db.transaction(() => {
					CreatePermissionsDB.run();
					CreateRecordingsDB.run();
					CreateSettingsDB.run();
					CreateSoundsDB.run();
					CreateUsersDB.run();
				});
				createDBResult();

				//Indexes
				let CreatePermissionsIdx = db.prepare('CREATE INDEX IF NOT EXISTS `permissions_Id` ON `permissions` ( `UserOrRole_Id` )');
				let CreateRecIdx = db.prepare('CREATE INDEX IF NOT EXISTS `rec_startTime_idx` ON `recordings` ( `startTime` )');
				let CreateSoundsIdx = db.prepare('CREATE INDEX IF NOT EXISTS `sounds_filename_idx` ON `sounds` ( `filename` )');

				//Execute Indexes creation
				let createIdxResult = db.transaction(() => {
					CreatePermissionsIdx.run();
					CreateRecIdx.run();
					CreateSoundsIdx.run();
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
	userUpdateAddPrepare: function () { userUpdateAddSqlStmt = db.prepare('INSERT INTO "users" (userid, "name", guildname, volume) VALUES ($userid, $name, $guildname, $volume) ON CONFLICT(userid) DO UPDATE SET "name"= $name, guildname=$guildname'); },
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
			utils.report("Updated " + count + " records in 'users' database.", 'g');
		} catch (err) { handleError(err); }
	},

	//Fillup usersVolume variable
	fillUsersDB: function () {
		//usersVolume = {};
		let rows = db.prepare('SELECT `volume`, userid from `users`').all();
		for (i in rows) {
			usersVolume[rows.userid] = volume;
		}
	},

	setUserVolume: function (userid, value) { try { db.prepare('UPDATE "users" SET volume = $volume, lastCommand=$date WHERE userid = $userid').run({ userid: userid, volume: value, date: Date.now() }); } catch (err) { handleError(err); } },
	userPlayedSoundsInc: function (userid) { try { db.prepare('UPDATE "users" SET playedSounds = playedSounds+1, lastCommand=$date WHERE userid = $userid').run({ userid: userid, date: Date.now() }); } catch (err) { handleError(err); } },
	userPlayedYoutubeInc: function (userid) { try { db.prepare('UPDATE "users" SET playedYoutube = playedYoutube+1, lastCommand=$date WHERE userid = $userid').run({ userid: userid, date: Date.now() }); } catch (err) { handleError(err); } },
	userPlayedRecsInc: function (userid) { try { db.prepare('UPDATE "users" SET playedRecordings = playedRecordings+1, lastCommand=$date WHERE userid = $userid').run({ userid: userid, date: Date.now() }); } catch (err) { handleError(err); } },
	userUploadedSoundsInc: function (userid) { try { db.prepare('UPDATE "users" SET uploadedSounds = uploadedSounds+1 WHERE userid = $userid').run({ userid: userid }); } catch (err) { handleError(err); } },

	//getUserVolume: function (userid) { let row; try { row = db.prepare("SELECT `volume` from `users` WHERE userid = ?").get(userid); } catch (err) { handleError(err); } if (row) return row.volume; else return config.DefaultVolume; },
	getUserVolume: function (userid) { if (usersVolume[userid]) return usersVolume[userid]; else return config.DefaultVolume; },
	getUserPlayedSounds: function (userid) { let row; try { row = db.prepare("SELECT playedSounds from users WHERE userid = $userid").get({ userid: userid }); } catch (err) { handleError(err); } if (row) return row.playedSounds; else return 0; },
	getUserPlayedYoutube: function (userid) { let row; try { row = db.prepare("SELECT playedYoutube from users WHERE userid = $userid").get({ userid: userid }); } catch (err) { handleError(err); } if (row) return row.playedYoutube; else return 0; },
	getUserUploadedSounds: function (userid) { let row; try { row = db.prepare("SELECT uploadedSounds from users WHERE userid = $userid").get({ userid: userid }); } catch (err) { handleError(err); } if (row) return row.uploadedSounds; else return 0; },
	
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
	soundUpdateAddPrepare: function () { soundUpdateAddSqlStmt = db.prepare('INSERT INTO "sounds" (filenameFull, filename, extension, duration, size, bitrate, uploadedBy, uploadDate) VALUES ($filenameFull, $filename, $extension, $duration, $size, $bitrate, $uploadedBy, $uploadDate) ON CONFLICT(filenameFull) DO UPDATE SET filename=$filename, extension=$extension, duration=$duration, size=$size, `exists`=1'); },
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
				db.prepare('UPDATE "sounds" SET `exists` = 0 WHERE 1').run();
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
	soundPlayedInc: function (filename) { try { db.prepare('UPDATE `sounds` SET playedCount = playedCount+1, lastTimePlayed=$lastTimePlayed WHERE filenameFull = $filenameFull').run({ filenameFull: filename, lastTimePlayed: Date.now() }); } catch (err) { handleError(err); } },

	//Return filename array of a sound by full or partial search request
	findSound: function (search) {
		return new Promise((resolve, reject) => {
			let result = {};
			try {
				//First, search for a full name
				let fullSearch = db.prepare("SELECT filenameFull, filename, extension, volume, duration, `size`, bitrate, playedCount, uploadedBy, uploadDate, lastTimePlayed from `sounds` WHERE filename=? AND `exists`=1").get(search);
				//Found exact match
				if (fullSearch) {
					result['count'] = 1;
					result['sound'] = fullSearch;
					return resolve(result);
				}
				else {
					let partialSearch = db.prepare("SELECT filenameFull, filename, extension, volume, duration, size, bitrate, playedCount, uploadedBy, uploadDate, lastTimePlayed from `sounds` WHERE filename LIKE ? AND `exists`=1 ORDER BY filename ASC").all("%"+search.toLowerCase()+"%");
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
				output.random = Math.floor(Math.random() * (output.last - output.first)) + output.first;
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
	recordingAdd: function (file, startTime, duration, userId, size) {
		try {
			recordingAddSqlStmt.run({ filename: file, startTime: startTime, userId: userId, duration: duration, size: size });
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
						utils.report("Found " + checkCount + " voice recordings (Duration " + Math.floor(totalDuration / 36000) / 100 + " hours, size " + Math.floor(100 * totalSize / 1048576) / 100 + " Mb). Database updated!", 'g');
						scanRecordingsFolderDBTransaction(dataToInsert);
						return resolve();
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
				if (dbRecordsCount == files.length) {
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
					//Rescan is needed!
					utils.report("Found mismatch on database records and files in the '" + config.folders.VoiceRecording + "' folder! Rescanning...", 'y');
					this.scanRecordingsFolder()
						.then(() => { return resolve(); });
				}
			});

		});
	},

	//Create a list of files based on time and user request
	makeRecFileList: function (dateMs, mode = { how: 'sequence', duration:300000, gapToStop:30000, gapToAdd:100 }, timeLimitMs=0, users = [], includeHidden=false) {
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
		let output = {};
		let result = [];
		let lastElement = {};
		let additionalCondition = "";
		let endTimeCut = mode.how == "sequence" ? dateMs + mode.duration * 2 : dateMs + timeLimitMs;
		function setOutputParams() {
			output['list'] = result;
			output['duration'] = currentResultDuration;
			output['startTime'] = StartTime;
			output['endTime'] = FurthestEndingTime;
			output['totalAudioDuration'] = totalAudioDuration;
			output['method'] = peneterated ? 'mix' : 'concat';
			output['GapsRemoved'] = statGapsRemoved;
			output['GapsAdded'] = statGapsAdded;
			output['filesCount'] = statFilesCount;
		}
		try {
			let usersDict = {};
			if (users.length > 0) {
				additionalCondition += " AND (";
				for (i in users) {
					additionalCondition += " userId=$user" + i + "r OR";
					usersDict['user' + i+"r"] = users[i];
				}
				additionalCondition = additionalCondition.slice(0, additionalCondition.length - 2);
				additionalCondition += ")";
			}
			let inputParams = Object.assign({}, { recDurationThreshold: config.IgnoreRecordingDuration, startTime: dateMs, endTime: endTimeCut }, usersDict);
			
			const recStatement = db.prepare('SELECT filename, startTime, userId, duration FROM recordings WHERE duration>$recDurationThreshold AND startTime>$startTime AND startTime<$endTime ' + additionalCondition + " ORDER BY startTime ASC");
			for (const rec of recStatement.iterate(inputParams)) {
				
				//If its first iteration
				if (result.length == 0) {
					StartTime = rec.startTime;
				}
				else {
					if (FurthestEndingTime < lastElement['startTime'] + lastElement['duration'])
						FurthestEndingTime = lastElement['startTime'] + lastElement['duration'];
				}

				//mode: { how: 'sequence', duration:300000, gapToStop:30000, gapToAdd:100 } - list files sequentially untill duration is reached or gap between files is longer than gapToStop
				if (mode.how == 'sequence') {
					//If we reached duration or gap limit, return result
					if (currentResultDuration >= mode.duration || (mode.gapToStop > 0 && rec['startTime'] - (lastElement['startTime'] ? (lastElement['startTime'] + lastElement['duration']) : rec['startTime']) > mode.gapToStop)) {
						setOutputParams();
						return output;
					}
					else {
						//Check if audio is peneterating with anything else
						if (FurthestEndingTime > rec['startTime']) {
							peneterated = true;
							//console.log("Peneteration: " + (FurthestEndingTime - rec['startTime']) + 'ms on "'+i+'"');
						}
						//Remove or add the gap
						else {
							let gap = FurthestEndingTime ? rec['startTime'] - FurthestEndingTime : 0;
							if (mode.gapToAdd > 0 && FurthestEndingTime) {
								currentOffset += mode.gapToAdd - gap;
								if (mode.gapToAdd - gap >= 0) statGapsAdded += mode.gapToAdd - gap;
								else statGapsRemoved += gap - mode.gapToAdd;
							}
							else {
								currentOffset -= gap;
								statGapsRemoved += gap;
							}
						}
						//Add the result
						result.push({ file: path.resolve(__dirname, config.folders.VoiceRecording, rec['filename']), delay: (rec['startTime'] - StartTime + currentOffset) });
						statFilesCount++;

						currentResultDuration = rec['startTime'] + rec['duration'] + currentOffset - StartTime;

						totalAudioDuration += rec['duration'];
						lastElement = rec;
					}
				}
				//mode: { how: 'phrase', minDuration:3000, allowedGap:300, gapToAdd:100 } - search for a phrase that is longer than minDuration and has pauses between files less than allowedGap ms
				else if (mode.how == 'phrase') {
					return false;
				}

			}
			//If we looped throught all results and didnt fit output conditions
			if (result.length > 0) {
				if (mode.how == 'sequence') {
					setOutputParams();
					return output;
				}
				else
					return false;
			}
		} catch (err) { handleError(err); }
		return false;
	}
}