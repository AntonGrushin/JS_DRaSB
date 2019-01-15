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

//Private variables
var usersDB = {};
var soundsDB = {};
var recDB = {};

//Technical
var lastRecDBUpdate = 0;
var RecUpdateInQueue = false;

// ===== Private functions =====

//Update or create the database file
function updateDBFile(filename, DB) {
	let fileToCreate = path.resolve(__dirname, config.folders.Database, filename);
	if (fs.existsSync(fileToCreate)) {
		//Detele the file if it exists first
		fs.unlink(fileToCreate, err => {
			if (err) {
				utils.report("Couldn't delete database file '" + fileToCreate + "', check permissions! Error: " + err, 'r');
				return false;
			}
		});
	}
	//Stringify the database object
	let json = JSON.stringify(DB);
	fs.writeFile(fileToCreate, json, 'utf8', err => {
		if (err) {
			utils.report("Couldn't create database file '" + fileToCreate + "', check permissions! Error: " + err, 'r');
			return false;
		}
		else return true;
	});
}

function setRecordProperty (DB, key, property, value = '+') {
	//Key exists in the DB
	if (DB[key]) {
		//If we want to increment the value
		if (value == '+') {
			//Read the old value if it exists
			//let thisVal = 0;
			if (DB[key][property])
				DB[key][property]++;
			else
				DB[key][property] = 1;
		}
		else {
			//Replace the value by a new one
			DB[key][property] = value;
		}
	}
	//Key does not exist, add new record
	else {
		DB[key] = {};
		if (value == '+')
			DB[key][property] = 1;
		else
			DB[key][property] = value;
	}
	//Update the DB files
	if (DB == usersDB)
		updateDBFile('users.json', DB);
	else if (DB == soundsDB)
		updateDBFile('sounds.json', DB);
}

//Get value from a Database or return default value if it does not exists
function getValueFromDB(DB, key, property, defaultValue = 0) {
	if (DB[key]) {
		if (DB[key][property]) {
			return DB[key][property];
		}
		else return defaultValue;
	}
	else return defaultValue;
}

function loop_FilesFfmpegCheck(array, folder, currentIndex, callback, endcallb) {
	if (array.length > currentIndex) {
		utils.checkAudioFormat(path.resolve(__dirname, folder, array[currentIndex]))
			.then(result => {
				callback(array[currentIndex], currentIndex, result);
				loop_FilesFfmpegCheck(array, folder, currentIndex + 1, callback, endcallb);
			})
			.catch(err => {
				utils.report("Couldn't execute ffprobe on '" + array[currentIndex] + "' file. Reason: " + err, 'y');
				callback(array[currentIndex], currentIndex, null);
				loop_FilesFfmpegCheck(array, folder, currentIndex + 1, callback, endcallb);
			});
	}
	else
		endcallb();
}

module.exports = {

	// =========== USERS ===========
	/* DB structure
		'userid': {
			'volume': 100.0,
			'playedSounds': 0,
			'playedYoutube': 0,
			'uploadedSounds': 0,

		}                                 */

	//Read DB file and store it in the variable
	loadUsersDB: function () {
		if (fs.existsSync(path.resolve(__dirname, config.folders.Database, 'users.json'))) {
			usersDB = require(path.resolve(__dirname, config.folders.Database, 'users.json'));
			utils.report("Loaded " + Object.keys(usersDB).length + " records from 'users.json' database.", 'w');
		}
		else
			utils.report("'users.json' database does not exist. Using empty list.", 'y');
	},

	getUserVolume: function (userid) {
		return getValueFromDB(usersDB, userid, 'volume', 100.00);
	},
	setUserVolume: function (userid, value) { setRecordProperty(usersDB, userid, 'volume', value); },
	userPlayedSoundsInc: function (userid) { setRecordProperty(usersDB, userid, 'playedSounds', '+'); },
	userPlayedYoutubeInc: function (userid) { setRecordProperty(usersDB, userid, 'playedYoutube', '+'); },
	userUploadedSoundsInc: function (userid) { setRecordProperty(usersDB, userid, 'uploadedSounds', '+'); },

	getUserPlayedSounds: function (userid) { return getValueFromDB(usersDB, userid, 'playedSounds', 0); },
	getUserPlayedYoutube: function (userid) { return getValueFromDB(usersDB, userid, 'playedYoutube', 0); },
	getUserUploadedSounds: function (userid) { return getValueFromDB(usersDB, userid, 'uploadedSounds', 0); },

	// =========== SOUNDS ===========
	/* DB structure
		'filename': {
			'extension': 'mp3'
			'volume': 100.0,  <== Global sound multiplier
			'duration': 0,
			'size': 0,
			'playedCount': 0,
			'uploadedBy': "000000000000000000",
			'uploadDate': 0,

		}                                 */

	//Update list of files and make sure we have it in the DB
	scanSoundsFolder: function () {
		fs.readdir(path.resolve(__dirname, config.folders.Sounds), (err, files) => {
			let checkCount = 0;
			async.eachLimit(files, config.FfmpegParallelProcLimit, (file, callback) => {
				checkCount++;
				utils.checkAudioFormat(path.resolve(__dirname, config.folders.Sounds, file))
					.then(result => {
						let fileNameParse = path.parse(file);
						if (result['mode'] != 'none') {
							//Update the database record for this file
							//File has record in the DB
							if (!soundsDB[fileNameParse.name]) soundsDB[fileNameParse.name] = {};
							soundsDB[fileNameParse.name]['extension'] = fileNameParse.ext;
							if (result['metadata'].format) {
								soundsDB[fileNameParse.name]['duration'] = result['metadata'].format.duration;
								soundsDB[fileNameParse.name]['size'] = result['metadata'].format.size;
								soundsDB[fileNameParse.name]['bitrate'] = result['metadata'].format.bit_rate;
							}
							soundsDB[fileNameParse.name]['checked'] = true;
						}
						callback();
					})
					.catch(err => {
						utils.report("Couldn't execute ffprobe on '" + file + "' file. Reason: " + err, 'y');
						callback();
					});
			}, () => {
				utils.report("Found " + checkCount + " sound files! Updating the database...", 'g');
				for (var key in soundsDB) {
					if (!soundsDB[key]['checked']) {
						delete soundsDB[key];
						utils.report("Deleting sounds DB record '" + key + "', file does not exists anymore.", 'y');
					}
					else delete soundsDB[key]['checked'];

				}
				//update the database file
				updateDBFile('sounds.json', soundsDB);
			});
		})
	},
	//Read DB file and store it in the variable
	loadSoundsDB: function() {
		if (fs.existsSync(path.resolve(__dirname, config.folders.Database, 'sounds.json'))) {
			soundsDB = require(path.resolve(__dirname, config.folders.Database, 'sounds.json'));
			utils.report("Loaded " + Object.keys(soundsDB).length + " records from 'sounds.json' database.", 'w');
		}
		else
			utils.report("'sounds.json' database does not exist. Using empty list.", 'y');
	},

	getSoundVolume: function (filename) { return getValueFromDB(soundsDB, filename, 'volume', 100.0); },
	setSoundVolume: function (filename, value) { setRecordProperty(soundsDB, filename, 'volume', value); },
	getSoundExtension: function (filename) { return getValueFromDB(soundsDB, filename, 'extension', 'mp3'); },
	getSoundDuration: function (filename) { return getValueFromDB(soundsDB, filename, 'duration', 0.0); },
	getSoundSize: function (filename) { return getValueFromDB(soundsDB, filename, 'size', 0.0); },
	getSoundBitrate: function (filename) { return getValueFromDB(soundsDB, filename, 'bitrate', 0.0); },

	//return filename array of a sound by full or partial search request
	findSound: function (search, all = false) {
		let result = [];
		//First, search for a full name
		for (var key in soundsDB) {
			if (key.toLowerCase() == search.toLowerCase() || all)
				result.push(key);
		}
		if (result.length == 0) {
			//Nothing was found, search for partial name
			for (var key in soundsDB) {
				if (key.toLowerCase().indexOf(search.toLowerCase()) != -1) {
					result.push(key);
				}
			}
		}
		return result;
	},

	// =========== VOICE RECORDINGS ===========
	/* DB structure
		'filename': {
			'UserId': '654654654654'
			'startTime': 456546546,
			'duration': 1001,
			'extension': 'webm',
			'size': 4654654,
		}                                 */
	//Read DB file and store it in the variable
	loadRecDB: function () {
		if (fs.existsSync(path.resolve(__dirname, config.folders.Database, 'recordings.json'))) {
			recDB = require(path.resolve(__dirname, config.folders.Database, 'recordings.json'));
			let totalSize = 0;
			let totalDuration = 0;
			for (i in recDB) {
                totalSize += recDB[i]['size'] ? recDB[i]['size'] : 0;
				totalDuration += recDB[i]['duration'] ? recDB[i]['duration'] : 0;
			}
			utils.report("Loaded " + Object.keys(recDB).length + " records from 'recordings.json' database. (Total recordings duration " + Math.floor(totalDuration / 36000) / 100 + " hours, size " + Math.floor(100 * totalSize / 1048576) / 100 + " Mb).", 'w');
        }
		else
			utils.report("'recordings.json' database does not exist. Using empty list.", 'y');
    },

    //Get first and last date for list of users (or all users if none provided)
    getRecDates: function (users=[]) {
        let output = { first:0, last:0, count:0, random:0 };

        for (i in recDB) {
            if (users.length == 0 || users.indexOf(recDB[i]['UserId']) > -1) {
                if (output.first == 0) output.first = recDB[i]['startTime'];
                output.last = recDB[i]['startTime'];
                output.count++;
            }
        }
        output.random = Math.floor(Math.random() * (output.last - output.first)) + output.first;
        return output;
    },

	//Scan RecordingsFolder and update recDB
	scanRecordingsFolder: function () {
		return new Promise((resolve, reject) => {
			fs.readdir(path.resolve(__dirname, config.folders.VoiceRecording), (err, files) => {
				let checkCount = 0;
				let lastReportTime = 0;
				let totalDuration = 0;
				let totalSize = 0;
				//Run FFMPEG check to find out duration
				async.eachLimit(files, config.FileScanParallelLimit, (file, callback) => {
					checkCount++;
					let fileNameParse = path.parse(file);
					if (!recDB[fileNameParse.name]) recDB[fileNameParse.name] = {};
					recDB[fileNameParse.name]['extension'] = fileNameParse.ext;
					//Parse the filename for date and userId
					let parsed = fileNameParse.name.match(/([0-9]{4})\-([0-9]+)\-([0-9]+)_([0-9]+)\-([0-9]+)\-([0-9]+)_([0-9]+)[_]+([0-9]+)_([0-9]{0,})[_]{0,}([^\r\n\t\f\v]+)/);
					if (parsed) {
						recDB[fileNameParse.name]['startTime'] = new Date(parsed[1], parsed[2] - 1, parsed[3], parsed[4], parsed[5], parsed[6], parsed[7]).getTime();
						recDB[fileNameParse.name]['UserId'] = parsed[8];
						recDB[fileNameParse.name]['duration'] = Number(parsed[9]);
						totalDuration += Number(parsed[9]);
					}
					recDB[fileNameParse.name]['size'] = fs.statSync(path.resolve(__dirname, config.folders.VoiceRecording, file)).size;
					totalSize += recDB[fileNameParse.name]['size'];
					//recDB[fileNameParse.name]['checked'] = true;

					//Periodically report progress of the scan to the console
					if (Date.now() - lastReportTime >= 1000 || checkCount == files.length) {
						utils.report("ScanRecordings scan progress: " + checkCount + "/" + files.length + " (" + (Math.round(10000 * checkCount / files.length)/100) + " %) done...", 'c');
						lastReportTime = Date.now();
					}

					callback();
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
					
					//update the database file
					if (updateDBFile('recordings.json', recDB))
						return resolve();
					else
						return resolve(true);
				});
			});
		});
	},

	//Check if we have any extra file in the folder that are not in the DB or files listed in the DB are missing
	RecordingsUpdateNeededCheck: function () {
		return new Promise((resolve, reject) => {
			let needToUpdate = false;
			fs.readdir(path.resolve(__dirname, config.folders.VoiceRecording), (err, files) => {
				let checkCount = 0;
				for (key in files) {
					checkCount++;
					let fileNameParse = path.parse(files[key]);
					if (!recDB[fileNameParse.name]) {
						needToUpdate = true;
						//utils.report("recDB does not have '" + fileNameParse.name + "' key, forcing DB update...", 'y');
						//break;
					}
					else
						recDB[fileNameParse.name]['checked'] = true;
				}
				//If we checked all the files
				if (checkCount == files.length) {
					for (var key in recDB) {
						if (!recDB[key]['checked']) {
							//utils.report("File '" + key + "' does not exist in the Recordings folder, forcing DB update...", 'y');
							delete recDB[key];
							utils.report("Deleting recDB record '" + key + "', file does not exists anymore.", 'y');
							needToUpdate = true;
							//break;
						}
					}
				}
				//Update database if needed
				if (needToUpdate) {
					utils.report("recDB database is out of sync, forcing update...", 'y');
					this.scanRecordingsFolder()
						.then(() => { return resolve(null); });
				}
				else
					return resolve(null);
			});
		});
	},

	//Queue Recordings HDD DB update
	RecordingsHDD_DBQueueUpdate: function () {
		if (!RecUpdateInQueue) {
			setTimeout(() => {
				lastRecDBUpdate = Date.now();
				updateDBFile('recordings.json', recDB);
				RecUpdateInQueue = false;
			}, ((Date.now() - lastRecDBUpdate >= config.RecDBUpdatePeriod * 1000) ? 0 : config.RecDBUpdatePeriod - (Date.now() - lastRecDBUpdate) + 100));
		}
	},

	//Add a recording to recDB
	addRecording: function (file, startTime, duration, userId, size) {
		let fileNameParse = path.parse(file);
		recDB[fileNameParse.name] = {};
		recDB[fileNameParse.name]['extension'] = fileNameParse.ext;
		recDB[fileNameParse.name]['startTime'] = startTime;
		recDB[fileNameParse.name]['UserId'] = userId;
		recDB[fileNameParse.name]['duration'] = duration;
		recDB[fileNameParse.name]['size'] = size;
		this.RecordingsHDD_DBQueueUpdate();
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