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

//Private variables
var usersDB = {};
var soundsDB = {};


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
			files.forEach(file => {
				let fileNameParse = path.parse(file);
				//console.log(file);
				ffmpeg.ffprobe(path.resolve(__dirname, config.folders.Sounds, file), function (err, metadata) {
					checkCount++;
					if (err) {
						utils.report("FFMPEG: Could not read properties of '" + file + "' file, ignoring it. Error: " + err, 'y');
					}
					else {
						//console.log("File '" + file + "', Duration " + metadata.format.duration + " sec, size " + Math.round(metadata.format.size / 1024) + " Kb.");
						//Update the database record for this file
						//File has record in the DB
						if (!soundsDB[fileNameParse.name]) soundsDB[fileNameParse.name] = {};
						soundsDB[fileNameParse.name]['extension'] = fileNameParse.ext;
						if (metadata.format) {
							soundsDB[fileNameParse.name]['duration'] = metadata.format.duration;
							soundsDB[fileNameParse.name]['size'] = metadata.format.size;
							soundsDB[fileNameParse.name]['bitrate'] = metadata.format.bit_rate;
						}
						soundsDB[fileNameParse.name]['checked'] = true;
					}
					//If we checked all the files, launch database cleanup
					if (checkCount == files.length) {
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
					}
				});
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
	}

	// =========== YOUTUBE ===========
}