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
var db = new sqlite3.Database(':memory:');


//Private variables
var usersDB = {};
var soundsDB = {};
var recDB = {};

//Technical
var lastRecDBUpdate = 0;
var RecUpdateInQueue = false;

// ===== Private functions =====


//Update or create the database file
//function updateDBFile(filename, DB) {
//	let fileToCreate = path.resolve(__dirname, config.folders.Database, filename);
//	if (fs.existsSync(fileToCreate)) {
//		//Detele the file if it exists first
//		fs.unlink(fileToCreate, err => {
//			if (err) {
//				utils.report("Couldn't delete database file '" + fileToCreate + "', check permissions! Error: " + err, 'r');
//				return false;
//			}
//		});
//	}
//	//Stringify the database object
//	let json = JSON.stringify(DB);
//	fs.writeFile(fileToCreate, json, 'utf8', err => {
//		if (err) {
//			utils.report("Couldn't create database file '" + fileToCreate + "', check permissions! Error: " + err, 'r');
//			return false;
//		}
//		else return true;
//	});
//}

//function setRecordProperty (DB, key, property, value = '+') {
//	//Key exists in the DB
//	if (DB[key]) {
//		//If we want to increment the value
//		if (value == '+') {
//			//Read the old value if it exists
//			//let thisVal = 0;
//			if (DB[key][property])
//				DB[key][property]++;
//			else
//				DB[key][property] = 1;
//		}
//		else {
//			//Replace the value by a new one
//			DB[key][property] = value;
//		}
//	}
//	//Key does not exist, add new record
//	else {
//		DB[key] = {};
//		if (value == '+')
//			DB[key][property] = 1;
//		else
//			DB[key][property] = value;
//	}
//	//Update the DB files
//	if (DB == usersDB)
//		updateDBFile('users.json', DB);
//	else if (DB == soundsDB)
//		updateDBFile('sounds.json', DB);
//}

////Get value from a Database or return default value if it does not exists
//function getValueFromDB(DB, key, property, defaultValue = 0) {
//	if (DB[key]) {
//		if (DB[key][property]) {
//			return DB[key][property];
//		}
//		else return defaultValue;
//	}
//	else return defaultValue;
//}

//function loop_FilesFfmpegCheck(array, folder, currentIndex, callback, endcallb) {
//	if (array.length > currentIndex) {
//		utils.checkAudioFormat(path.resolve(__dirname, folder, array[currentIndex]))
//			.then(result => {
//				callback(array[currentIndex], currentIndex, result);
//				loop_FilesFfmpegCheck(array, folder, currentIndex + 1, callback, endcallb);
//			})
//			.catch(err => {
//				utils.report("Couldn't execute ffprobe on '" + array[currentIndex] + "' file. Reason: " + err, 'y');
//				callback(array[currentIndex], currentIndex, null);
//				loop_FilesFfmpegCheck(array, folder, currentIndex + 1, callback, endcallb);
//			});
//	}
//	else
//		endcallb();
//}

function handleError(error) {
	if (error) utils.report("SQLITE error: " + error, 'r');
}

module.exports = {

	//Create all tables or make sure they exist
	prepareDatabase: function (reportStats = true) {
		return new Promise((resolve, reject) => {
			db.serialize(() => {
				let checkedCount = 0;
				function dbIsReady() {
					checkedCount++;
					if (checkedCount == 8) {
						if (reportStats) {
							//db.get("SELECT count(*) cnt from `users`", { $id: 2, $name: "bar" });
							db.get("SELECT count(*) AS 'count' from `users`", (err, row) => { if (!err) utils.report("Loaded " + row.count + " records from 'users' database.", 'w'); });
							db.get("SELECT count(*) AS 'count', SUM('size') AS 'size', SUM('duration') AS 'duration' from `sounds`", (err, row) => { if (!err) utils.report("Loaded " + row.count + " records from 'sounds' database." + (row.count ? "(Duration " + Math.floor(row.duration / 6000) / 100 + " minutes, size " + Math.floor(100 * row.size / 1048576) / 100 + " Mb)":""), 'w'); });
							db.get("SELECT count(*) AS 'count', SUM('size') AS 'size', SUM('duration') AS 'duration' from `recordings`", (err, row) => { if (!err) utils.report("Loaded " + row.count + " records from 'recordings' database." + (row.count ? "(Duration " + Math.floor(row.duration / 36000) / 100 + " hours, size " + Math.floor(100 * row.size / 1048576) / 100 + " Mb)" : ""), 'w'); });
						}
						return resolve();
					}
				}

				//Tables
				db.run('CREATE TABLE IF NOT EXISTS `permissions` ( `id` INTEGER PRIMARY KEY AUTOINCREMENT UNIQUE, `UserOrRole_Id` INTEGER, `thisIsUser` INTEGER DEFAULT 0, `permissions` INTEGER )', (res, err) => { if (!err) dbIsReady(); else return reject(err); });
				db.run('CREATE TABLE IF NOT EXISTS "recordings" ( `id` INTEGER PRIMARY KEY AUTOINCREMENT UNIQUE, `filename` TEXT UNIQUE, `startTime` INTEGER, `userId` INTEGER, `duration` INTEGER, `size` INTEGER, `exists` INTEGER DEFAULT 1, `hidden` INTEGER DEFAULT 0 )', (res, err) => { if (!err) dbIsReady(); else return reject(err); });
				db.run('CREATE TABLE IF NOT EXISTS `settings` ( `id` INTEGER PRIMARY KEY AUTOINCREMENT UNIQUE, `guildId` INTEGER, `enableSB` INTEGER, `enableRec` INTEGER, `ReportChannelId` INTEGER )', (res, err) => { if (!err) dbIsReady(); else return reject(err); });
				db.run('CREATE TABLE IF NOT EXISTS "sounds" ( `filenameFull` TEXT UNIQUE, `filename` TEXT, `extension` TEXT, `volume` REAL DEFAULT 100, `duration` REAL DEFAULT 0, `size` INTEGER DEFAULT 0, `bitrate` REAL DEFAULT 0, `playedCount` INTEGER DEFAULT 0, `uploadedBy` INTEGER DEFAULT 0, `uploadDate` INTEGER, `lastTimePlayed` INTEGER, `exists` INTEGER DEFAULT 1, PRIMARY KEY(`filenameFull`) )', (res, err) => { if (!err) dbIsReady(); else return reject(err); });
				db.run('CREATE TABLE IF NOT EXISTS "users" ( `userid` INTEGER UNIQUE, `name` TEXT, `guildName` TEXT, `volume` REAL DEFAULT 20.0, `playedSounds` INTEGER DEFAULT 0, `playedYoutube` INTEGER DEFAULT 0, `playedRecordings` INTEGER DEFAULT 0, `lastCommand` INTEGER, `lastRecording` INTEGER, `recDuration` INTEGER DEFAULT 0, `recFilesCount` INTEGER DEFAULT 0, `uploadedSounds` INTEGER DEFAULT 0, PRIMARY KEY(`userid`) )', (res, err) => { if (!err) dbIsReady(); else return reject(err); });

				//Indexes
				db.run('CREATE INDEX IF NOT EXISTS `permissions_Id` ON `permissions` ( `UserOrRole_Id` )', (res, err) => { if (!err) dbIsReady(); else return reject(err); });
				db.run('CREATE INDEX IF NOT EXISTS `rec_startTime_idx` ON `recordings` ( `startTime` )', (res, err) => { if (!err) dbIsReady(); else return reject(err); });
				db.run('CREATE INDEX IF NOT EXISTS `sounds_filename_idx` ON `sounds` ( `filename` )', (res, err) => { if (!err) dbIsReady(); else return reject(err); });

			});
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
	userUpdateAdd: function (userid, name, guildname, volume) {
		db.run('INSERT INTO "users" (userid, "name", guildname, volume) VALUES ($userid, $name, $guildname, $volume) ON CONFLICT(userid) DO UPDATE SET "name"= $name, guildname=$guildname', { $userid: userid, $name: name, $guildname: guildname ? guildname : name, $volume: volume }, handleError);
	},

	//Update users database
	updateUsersDB: function (members) {
		let count = 0;
		members.forEach((member, key, map) => {
			this.userUpdateAdd(member.id, member.user.username, member.nickname, config.DefaultVolume);
			count++;
		});
		utils.report("Updated " + count + " records in 'users' database.", 'g');
	},

	getUserVolume: function (userid) {
		db.get("SELECT volume from `users` WHERE userid=$userid", { $userid: userid }, (err, row) => {
			if (row.volume > 0) return row.volume;
			else return config.DefaultVolume;
		});
	},
	setUserVolume: function (userid, value) { db.run('UPDATE "users" SET volume = $volume, lastCommand=$date WHERE userid = $userid', { $userid: userid, $volume: volume, $date: Date.now() }, handleError); },
	userPlayedSoundsInc: function (userid) { db.run('UPDATE "users" SET playedSounds = playedSounds+1, lastCommand=$date WHERE userid = $userid', { $userid: userid, $date: Date.now() }, handleError); },
	userPlayedYoutubeInc: function (userid) { db.run('UPDATE "users" SET playedYoutube = playedYoutube+1, lastCommand=$date WHERE userid = $userid', { $userid: userid, $date: Date.now() }, handleError); },
	userPlayedRecsInc: function (userid) { db.run('UPDATE "users" SET playedRecordings = playedRecordings+1, lastCommand=$date WHERE userid = $userid', { $userid: userid, $date: Date.now() }, handleError); },
	userUploadedSoundsInc: function (userid) { db.run('UPDATE "users" SET uploadedSounds = uploadedSounds+1 WHERE userid = $userid', { $userid: userid }, handleError); },

	getUserPlayedSounds: function (userid) { db.get("SELECT playedSounds from `users`", (err, row) => { if (!err) return row.playedSounds; else return 0; }); },
	getUserPlayedYoutube: function (userid) { db.get("SELECT playedYoutube from `users`", (err, row) => { if (!err) return row.playedYoutube; else return 0; }); },
	getUserUploadedSounds: function (userid) { db.get("SELECT uploadedSounds from `users`", (err, row) => { if (!err) return row.uploadedSounds; else return 0; }); },

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
	soundUpdateAdd: function (filenameFull, duration, size, bitrate, uploadedBy=0) {
		let fileNameParse = path.parse(filenameFull);
		db.run('INSERT INTO "sounds" (filenameFull, filename, extension, duration, size, bitrate, uploadedBy, uploadDate) VALUES ($filenameFull, $filename, $extension, $duration, $size, $bitrate, $uploadedBy, $uploadDate) ON CONFLICT(filenameFull) DO UPDATE SET filename=$filename, extension=$extension, duration=$duration, size=$size, `exists`=1', { $filenameFull: filenameFull, $filename: fileNameParse.name, $extension: fileNameParse.ext, $duration: duration, $size: size, $uploadedBy: uploadedBy, $uploadDate: Date.now(), $bitrate: bitrate }, handleError);
	},

	//Update list of files and make sure we have it in the DB
	scanSoundsFolder: function () {
		db.run('UPDATE "sounds" SET `exists` = 0 WHERE 1', (res, err) => {
			if (!err) {
				fs.readdir(path.resolve(__dirname, config.folders.Sounds), (err, files) => {
					let checkCount = 0;
					async.eachLimit(files, config.FfmpegParallelProcLimit, (file, callback) => {
						checkCount++;
						utils.checkAudioFormat(path.resolve(__dirname, config.folders.Sounds, file))
							.then(result => {
								let fileNameParse = path.parse(file);
								if (result['mode'] != 'none' && result['metadata'].format) 
									//Update the database record for this file
									this.soundUpdateAdd(file, result['metadata'].format.duration, result['metadata'].format.size, result['metadata'].format.bit_rate);
								callback();
							})
							.catch(err => {
								utils.report("Couldn't execute ffprobe on '" + file + "' file. Reason: " + err, 'y');
								callback();
							});
					}, () => {
						utils.report("Found " + checkCount + " sound files, Database updated!", 'g');
					});
				})
			}
		});
	},

	setSoundVolume: function (filename, value) { db.run('UPDATE `sounds` SET volume = $value WHERE filenameFull = $filenameFull', { $filenameFull: filename, $value: value }, handleError); },
	soundPlayedInc: function (filename) { db.run('UPDATE `sounds` SET playedCount = playedCount+1, lastTimePlayed=$lastTimePlayed WHERE filenameFull = $filenameFull', { $filenameFull: filename, $lastTimePlayed: Date.now() }, handleError); },


	//Return filename array of a sound by full or partial search request
	findSound: function (search) {
		return new Promise((resolve, reject) => {
			let result = {};
			//First, search for a full name
			db.get("SELECT filenameFull, filename, extension, volume, duration, `size`, bitrate, playedCount, uploadedBy, uploadDate, lastTimePlayed from `sounds` WHERE filename=$filename AND `exists`=1", { $filename: search }, (err, row) => {
				//Found exact match
				if (row && !err) {
					result['count'] = 1;
					result['sound'] = row;
					return resolve(result);
				}
				else {
					db.all("SELECT filenameFull, filename, extension, volume, duration, size, bitrate, playedCount, uploadedBy, uploadDate, lastTimePlayed from `sounds` WHERE filename like '%" + search.toLowerCase() +"%' AND `exists`=1 ORDER BY filename ASC", [], (errL, rows) => {
						if (rows.length > 0 && !errL) {
							result['count'] = rows.length;
							result['sound'] = rows[0];
							return resolve(result);
						}
						else
							return resolve(result);
					});
				}
			});
		});
	},

	//Return list of all sounds in DB
	getSoundsList: function () {
		return new Promise((resolve, reject) => {
			let result = [];
			db.all("SELECT filename WHERE `exists`=1 ORDER BY filename ASC", [], (errL, rows) => {
				if (rows.length > 0 && !errL) {
					rows.forEach(row => {
						result.push(row.filename);
					});
					return resolve(result);
				}
				else
					return resolve(result);
			});
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
		let addition = " WHERE ";
		for (i in users) addition += "userId='" + users[i] + "' OR ";
		if (addition.length)
			addition = addition.slice(0, addition.length - 4);

		db.get("SELECT MIN(startTime) AS 'min', MAX(startTime) AS 'max', COUNT(*) AS 'count' FROM `recordings`" + (addition.length ? addition : ""), [], (err, row) => {
			//Found exact match
			if (row && !err) {
				output.first = row.min;
				output.last = row.max;
				output.count = row.count;
				output.random = Math.floor(Math.random() * (output.last - output.first)) + output.first;
				return output;
			}
			else
				return output;
		});
        
        return output;
    },

	//Add or update recording in DB
	recordingUpdateAdd: function (filename, startTime, userId, duration, size) {
		return new Promise((resolve, reject) => {
			db.run('INSERT INTO "recordings" (filename, startTime, userId, duration, size) VALUES ($filename, $startTime, $userId, $duration, $size) ON CONFLICT(filename) DO UPDATE SET startTime=$startTime, userId=$userId, duration=$duration, size=$size, `exists`=1', { $filename: filename, $startTime: startTime, $userId: userId, $duration: duration, $size: size }, (res, err) => {
				if (err) {
					handleError(err);
					return resolve();
				}
				else
					return resolve();
			});
		});
	},

	//Add recording to DB (when we know its a new one for sure)
	recordingAdd: function (file, startTime, duration, userId, size) {
		db.run('INSERT INTO "recordings" (filename, startTime, userId, duration, size) VALUES ($filename, $startTime, $userId, $duration, $size)', { $filename: file, $startTime: startTime, $userId: userId, $duration: duration, $size: size }, handleError);
	},

	//Scan RecordingsFolder and update recDB
	scanRecordingsFolder: function () {
		return new Promise((resolve, reject) => {
			//db.serialize(() => {
				db.run('UPDATE "recordings" SET `exists` = 0 WHERE 1', (res, err) => {
					if (!err) { 
						fs.readdir(path.resolve(__dirname, config.folders.VoiceRecording), (err, files) => {
							let checkCount = 0;
							let lastReportTime = 0;
							let totalDuration = 0;
							let totalSize = 0;
							//Run FFMPEG check to find out duration
							async.eachLimit(files, config.FileScanParallelLimit, (file, callback) => {
								checkCount++;
								let fileNameParse = path.parse(file);
								//Parse the filename for date and userId
								let parsed = fileNameParse.name.match(/([0-9]{4})\-([0-9]+)\-([0-9]+)_([0-9]+)\-([0-9]+)\-([0-9]+)_([0-9]+)[_]+([0-9]+)_([0-9]{0,})[_]{0,}([^\r\n\t\f\v]+)/);
								if (parsed) {
									totalDuration += Number(parsed[9]);
									let thisSize = fs.statSync(path.resolve(__dirname, config.folders.VoiceRecording, file)).size;
									totalSize += thisSize;
									this.recordingUpdateAdd(file, new Date(parsed[1], parsed[2] - 1, parsed[3], parsed[4], parsed[5], parsed[6], parsed[7]).getTime(), parsed[8], Number(parsed[9]), thisSize)
										.then(() => {
											//Periodically report progress of the scan to the console
											if (Date.now() - lastReportTime >= 1000 || checkCount == files.length) {
												utils.report("ScanRecordings scan progress: " + checkCount + "/" + files.length + " (" + (Math.round(10000 * checkCount / files.length) / 100) + " %) done...", 'c');
												lastReportTime = Date.now();
											}

											callback();
										});
								}

								
								//utils.checkAudioFormat(path.resolve(__dirname, config.folders.VoiceRecording, file))
								//	.then(result => {
								//		if (result['mode'] != 'none') {
								//			if (result['metadata'].format) {
								//				recDB[fileNameParse.name]['duration'] = result['metadata'].format.duration;
								//				recDB[fileNameParse.name]['size'] = result['metadata'].format.size;
								//				recDB[fileNameParse.name]['good'] = 1;
								//			}
								//			recDB[fileNameParse.name]['checked'] = true;
								//		}

								//		//Periodically report progress of the scan to the console
								//		if (Date.now() - lastReportTime >= 1000) {
								//			utils.report("ScanRecordings scan progress: " + checkCount + "/" + files.length + " (" + (Math.round(10000 * checkCount / files.length)/100) + " %) done...", 'c');
								//			lastReportTime = Date.now();
								//		}

								//		callback();
								//	})
								//	.catch(err => {
								//		utils.report("Couldn't execute ffprobe on '" + file + "' file. Ignoring.", 'y');
								//		//utils.report("Couldn't execute ffprobe on '" + file + "' file. Error: " + err, 'y');
								//		if (!recDB[fileNameParse.name]) recDB[fileNameParse.name] = {};
								//		recDB[fileNameParse.name]['extension'] = fileNameParse.ext;
								//		recDB[fileNameParse.name]['good'] = 0;
								//		recDB[fileNameParse.name]['checked'] = true;
								//		callback();
								//	});
							}, () => {
								utils.report("Found " + checkCount + " voice recordings (Duration " + Math.floor(totalDuration / 36000) / 100 + " hours, size " + Math.floor(100*totalSize/1048576)/100 + " Mb)! Updating the database...", 'g');
					
								return resolve();
							});
						});
					}
				});
			//});
		});
	},

	//Create a list of files based on time and user request
	makeRecFileList: function (dateMs, mode = { how: 'sequence', duration:300000, gapToStop:30000, gapToAdd:100 }, timeLimitMs=0, users = []) {
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
		for (i in recDB) {
            //We search only in records that happened after 'dateMs'
			if (recDB[i]['duration']>20 && ((users.length > 0 && recDB[i]['startTime'] > dateMs && users.indexOf(recDB[i]['UserId']) > -1) || (users.length == 0 && recDB[i]['startTime'] > dateMs))) {
				let timePeriodChecked = recDB[i]['startTime'] - dateMs;
				//If we exceeded search region, return false (nothing found)
				if (mode.timeLimitMs > 0 && timeLimitMs < timePeriodChecked && !foundResult)
					return false;
				//If its first iteration
				if (result.length == 0) {
                    StartTime = recDB[i]['startTime'];
                    //FurthestEndingTime = recDB[i]['startTime'] + recDB[i]['duration'];
                }
                else {
                    if (FurthestEndingTime < lastElement['startTime'] + lastElement['duration'])
                        FurthestEndingTime = lastElement['startTime'] + lastElement['duration'];
                }
                
				//mode: { how: 'sequence', duration:300000, gapToStop:30000, gapToAdd:100 } - list files sequentially untill duration is reached or gap between files is longer than gapToStop
				if (mode.how == 'sequence') {
					//If we reached duration or gap limit, return result
					if (currentResultDuration >= mode.duration || (mode.gapToStop > 0 && recDB[i]['startTime'] - (lastElement['startTime'] ? (lastElement['startTime'] + lastElement['duration']) : recDB[i]['startTime']) > mode.gapToStop)) {
						output['list'] = result;
						output['duration'] = currentResultDuration;
						output['startTime'] = StartTime;
                        output['totalAudioDuration'] = totalAudioDuration;
                        output['method'] = peneterated ? 'mix' : 'concat';
                        output['GapsRemoved'] = statGapsRemoved;
						output['GapsAdded'] = statGapsAdded;
						output['filesCount'] = statFilesCount;
						return output;
					}
					else {
						//Check if audio is peneterating with anything else
                        if (FurthestEndingTime > recDB[i]['startTime']) {
                            peneterated = true;
                            //console.log("Peneteration: " + (FurthestEndingTime - recDB[i]['startTime']) + 'ms on "'+i+'"');
                        }
                        //Remove or add the gap
                        else {
                            let gap = FurthestEndingTime ? recDB[i]['startTime'] - FurthestEndingTime : 0;
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
                        result.push({ file: path.resolve(__dirname, config.folders.VoiceRecording, i + recDB[i]['extension']), delay: (recDB[i]['startTime'] - StartTime + currentOffset) });
						statFilesCount++;

                        currentResultDuration = recDB[i]['startTime'] + recDB[i]['duration'] + currentOffset - StartTime;

                        //Check if there is a gap that needs to be removed

                        totalAudioDuration += recDB[i]['duration'];
						lastElement = recDB[i];
					}
					
				}
				//mode: { how: 'phrase', minDuration:3000, allowedGap:300, gapToAdd:100 } - search for a phrase that is longer than minDuration and has pauses between files less than allowedGap ms
				else if (mode.how == 'phrase') {
					return false;
				}
			}
		}
	}
}