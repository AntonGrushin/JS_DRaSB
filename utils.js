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
 *        utils.js
 *    Utility functions for general purpose.
 *********************************************************************/

const fs = require('fs');
const config = require('./config.js');
const path = require('path');
const mkdirp = require('mkdirp');
const ffmpeg = require('fluent-ffmpeg');
//technical
var timings = {};

module.exports = {

	//Pad a number with leading zeros
	pad: function (n, width = 2, z = '0') {
		return (String(z).repeat(width) + String(n)).slice(String(n).length)
	},

	//Sanatise filename
	sanitizeFilename: function (name, symbol = '_') {
		return name.replace(/[/\\?%*:|"<>]/g, symbol);
	},

	//Fill or cut filename data string to certain length
	cutFillString: function (string, width = 10, filler = '_') {
		let ready = String(string);
		if (String(ready).length > width)
			ready = ready.substring(0, width);
		return this.sanitizeFilename((String(filler).repeat(width) + String(ready)).slice(String(ready).length));
	},

	//Get filename string timestamp
	fileTimeNow: function () {
		let now = new Date();
		var timeonly = this.pad(now.getHours()) + '-' + this.pad(now.getMinutes()) + '-' + this.pad(now.getSeconds()) + '_' + this.pad(now.getMilliseconds(), 3);
		return (now.getFullYear() + '-' + this.pad(now.getMonth() + 1) + "-" + this.pad(now.getDate()) + "_" + timeonly);
	},

	// Delete file
	deleteFile: function (dest) {
		fs.unlink(dest, err => {
			if (err)
				this.report("Could't delete file '" + dest + "'. Error: " + err, 'r');
		});
	},

	// Move file
	moveFile: function (from, to, deleteIfFails=true) {
		return new Promise((resolve, reject) => {
			fs.rename(from, to, err => {
				if (err) {
					this.report("Could't move file from '" + from + "' to '" + to + "'. Error: " + err, 'r');
					if (deleteIfFails)
						this.deleteFile(from);
					return reject(err);
				}
				else
					return resolve();
			});
		});
	},

	// FFMPEG 

	checkAudioFormat: function (filepath) {
		return new Promise((resolve, reject) => {
			ffmpeg.ffprobe(filepath, (err, metadata) => {
				if (err)
					return reject(err);
				else {
					//Check if the format
					let countStreams = metadata.streams.length;
					let foundStreamIndex = null;
					let needToConvert = false;
					let needToRemux = false;
					if (countStreams > 1) needToRemux = true;
					let lastAudioStream = null;
					for (i in metadata.streams) {
						//console.log("Stream " + i + ", codec name: '" + metadata.streams[i].codec_name + "', codec type: '" + metadata.streams[i].codec_type + "'")
						//Check every stream if it fits the format
						for (fInx in config.AcceptedAudioFormats) {
							if (!foundStreamIndex && metadata.streams[i].codec_name == config.AcceptedAudioFormats[fInx] && metadata.streams[i].codec_type == 'audio') {
								foundStreamIndex = i;
							}
						}
						if (metadata.streams[i].codec_type == 'audio')
							lastAudioStream = i;
					}
					let result = { 'metadata': metadata };

					//If we found the proper format, no need to convert
					if (foundStreamIndex != null && !needToRemux) {
						result['mode'] = "fits";
					}
					//If format did fit, but we need to remux it because of several streams
					else if (foundStreamIndex != null && needToRemux) {
						result['mode'] = "remux";
						result['remuxStreamToKeep'] = foundStreamIndex;
					}
					//If format didnt fit but its an audio, convert it
					else if (foundStreamIndex == null && lastAudioStream != null) {
						result['mode'] = "convert";
						result['audioStream'] = lastAudioStream;
					}
					//If we didnt find an audio, the file is not acceptable
					else {
						result['mode'] = "none";
					}
					return resolve(result);
				}
			});
		});
	},

	// ========= LOGGING =========

	//Add color symbols for console coloring
	colorize: function (message, color) {
		if (color == 'r') //red
			return "[0;31m" + message + "[0m";
		else if (color == 'g') //green
			return "[0;32m" + message + "[0m";
		else if (color == 'y') //yellow
			return "[0;33m" + message + "[0m";
		else if (color == 'b') //blue
			return "[0;34m" + message + "[0m";
		else if (color == 'm') //magenta
			return "[0;35m" + message + "[0m";
		else if (color == 'c') //cyan
			return "[0;36m" + message + "[0m";
		else
			return message;
	},

	//Reporting process functions to console and logfile
	report: function (message, color=0, doLogfileReport=true) {
		//12:48:24.746 Joined channel 'Myth+'!				<== Console message
		//2018.12.09 12:48:24.746 Joined channel 'Myth+'!	<== Log message

		let now = new Date();
		var timeonly = this.pad(now.getHours()) + ':' + this.pad(now.getMinutes()) + ':' + this.pad(now.getSeconds()) + '.' + this.pad(now.getMilliseconds(), 3);
		var fulltimestamp = now.getFullYear() + '.' + this.pad(now.getMonth() + 1) + "." + this.pad(now.getDate()) + " " + timeonly;
	
		//report to console
		console.log(timeonly + ' ' + this.colorize(message, color));

		//report to logfile
		if (doLogfileReport && config.logging.EnableFileLog) {
			fs.appendFile(config.logging.LogFileName, '\n'+fulltimestamp + ' ' + message, err => {
				if (err) {
					this.report("Error Writing Message log file: " + err, 'r', false);
				}
			});
		}
	},

	//Make sure that all folders needed for bot to function exist
	checkFoldersExistance: function () {
		let allFolersAreReady = true;

		for (var key in config.folders) {
			mkdirp(path.resolve(__dirname, config.folders[key]), (err, made) => {
				if (err) {
					allFolersAreReady = false;
					this.report("Couldn't create folder '" + config.folders[key] + "', check permissions! Error: " + err, 'r');
				} else if (made) this.report("Couldn't find folder '" + made + "', made new one instead.", 'y');
			});
		}
		return allFolersAreReady;
	},

	sanatizeCommandName: function (name) {
		return path.parse(name).name.toLowerCase().replace(/[^a-z0-9_.]/g, '')
	}, 
	//Debug function to count milliseconds
	msCount: function (name, mode="normal",) {
		/* timings structure:
			{ "time1":[5555555, 5555556, 5555557],
			  "simething2":[6666666, 6666667, 6666668]  }
		*/
		let now = Date.now();
		if (!timings[name] || mode=="start") {
			timings[name] = [now];
			return "Delay debugging '" + name + "': Starting...";
		}
		timings[name].push(now);
		let delay = now - timings[name][timings[name].length - 2];
		let totalDelay = now - timings[name][0];
		if (mode == 'reset' && timings[name])
			delete timings[name];
		return "Delay debugging '" + name + "': " + delay + " ms since last operation, (" + totalDelay+" ms total).";
	},

}