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
const { PassThrough } = require('stream')  //For piping file stream to ffmpeg
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

	//Delete file
	deleteFile: function (dest) {
		fs.unlink(dest, err => {
			if (err)
				this.report("Could't delete file '" + dest + "'. Error: " + err, 'r');
		});
	},

	//Move file
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

	//Convert string hh:mm:ss or mm:ss to seconds
	toSeconds: function(str) {
		let match = null;
		if (match = str.match(/([:]+)/)) {
			var p = str.split(':'),
				s = 0, m = 1;

			while (p.length > 0) {
				s += m * parseInt(p.pop(), 10);
				m *= 60;
			}

			return s;
		}
		else if (match = str.match(/([0-9]+[hmsd]+)/g)) {
			let result = 0;

			for (i in match) {
				console.log(match[i])
				let thisMatch = match[i].match(/([0-9]+)([hmsd]+)/)
				if (thisMatch[2] == 'd')
					result += Number(thisMatch[1]) * 3600 * 24;
				else if (thisMatch[2] == 'h')
					result += Number(thisMatch[1]) * 3600;
				else if (thisMatch[2] == 'm')
					result += Number(thisMatch[1]) * 60;
				else if (thisMatch[2] == 's')
					result += Number(thisMatch[1]);
			}
			return result;
		}
		else
			return Number(str);
	},

	//Return additional flags from command string
	readFlags: function (inString) {
		let output = {};
		let effects = [];
		/* Output example
			{ volume: 45.3,
			  start: 3671,
			  end: 201,
			  duration: 5,
			  effects:
			   [ [ 'pitch', -20 ],
				 [ 'vibrato', 12, 50 ],
				 [ 'chorius' ],
				 [ 'pitch', -40 ],
				 [ 'echo' ] ] }   */

		//Volume
		let volResult = inString.match(/[ ]+(?:v|vol|volume|loud|loudness)[ ]{0,}([0-9.]+)/);
		if (volResult)
			output['volume'] = Number(volResult[1]);
		//Start time
		let startResult = inString.match(/[ ]+(?:s|start|back|b|ago)[ ]{0,}([0-9.:|0-9hmsd]+)/);
		if (startResult)
			output['start'] = this.toSeconds(startResult[1]);
		let endResult = inString.match(/[ ]+(?:end|e)[ ]{0,}([0-9.:mhs]+)/);
		//End time
		if (endResult)
			output['end'] = this.toSeconds(endResult[1]);
		//Duration
		let durResult = inString.match(/[ ]+(?:dur|len|d|duration|length|t|time)[ ]{0,}([0-9:mhs]+)/);
		if (durResult)
			output['duration'] = this.toSeconds(durResult[1]);

		//Effects
		let effResult = inString.match(/[ ]+(echo|pot|telephone|telep|phone|tube|bath|can|iron|horn|pitch|pitchhigh|ph|pitchlow|pl|vibrato|vib|crying|cry|chorius|choir)([ ]{1,}[\-0-9.]{1,}|)([ ]{1,}[\-0-9.]{1,}|)/g);
		let afirAdded = false;

		for (i in effResult) {
			let thisMatch = null;
			if (thisMatch = effResult[i].match(/(echo|pot|telephone|telep|phone|tube|bath|can|iron|horn)/)) {
				if (!afirAdded) {
					afirAdded = true;
					if (thisMatch[1] == 'echo')
						effects.push(['afir', 'echo']);
					else if (thisMatch[1] == 'pot')
						effects.push(['afir', 'pot']);
					else if (thisMatch[1] == 'telephone' || thisMatch[1] == 'telep' || thisMatch[1] == 'phone')
						effects.push(['afir', 'telephone']);
					else if (thisMatch[1] == 'tube')
						effects.push(['afir', 'tube']);
					else if (thisMatch[1] == 'bath')
						effects.push(['afir', 'bath']);
					else if (thisMatch[1] == 'can')
						effects.push(['afir', 'can']);
					else if (thisMatch[1] == 'iron')
						effects.push(['afir', 'iron']);
					else if (thisMatch[1] == 'horn')
						effects.push(['afir', 'horn']);
				}
			}
			else if (thisMatch = effResult[i].match(/(pitch|pitchhigh|ph|pitchlow|pl)[ ]{0,}([\-0-9.]{0,})/)) {
				if (thisMatch[1] == 'pitch' && thisMatch[2]) {
					effects.push(['pitch', Number(thisMatch[2])]);
				}
				else if (thisMatch[1] == 'pitchlow' || thisMatch[1] == 'pl')
					effects.push(['pitch', -40]);
				else //pitchhigh ph
					effects.push(['pitch', 40]);
			}
			else if (thisMatch = effResult[i].match(/(?:vibrato|vib|crying|cry)[ ]{0,}([\-0-9.]{0,})[ ]{0,}([\-0-9.]{0,})/)) {
				effects.push(['vibrato', thisMatch[1] ? Number(thisMatch[1]) : 10, thisMatch[2] ? Number(thisMatch[2]) : 50]);
			}
			else if (thisMatch = effResult[i].match(/(?:chorius|choir)/)) {
				effects.push(['chorius']);
			}
		}
		if (effects.length > 0)
			output['effects'] = effects;
		return output;
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

	//Add all effects from the list to ffmpeg command
	addAudioEffects: function (ffmpegCommand, effects) {
		let newCommand = ffmpegCommand;
		let complexFilters = [];
		for (i in effects) {
			if (effects[i][0] == 'pitch') {
				let speed = (1 - effects[i][1] / 100);
				if (speed < 0.5)
					speed = 0.5;
				complexFilters.push('asetrate=48000*' + (1 + effects[i][1] / 100) + ',aresample=48000,atempo=' + speed);
			}
			else if (effects[i][0] == 'vibrato')
				complexFilters.push('vibrato=' + effects[i][1] + ':' + (effects[i][2] / 100));
			else if (effects[i][0] == 'chorius')
				complexFilters.push('chorus=0.5:0.9:50|60|40:0.4|0.32|0.3:0.25|0.4|0.3:2|2.3|1.3');
			else if (effects[i][0] == 'afir') {
				if (effects[i][1] == 'echo')
					newCommand = newCommand.input(path.resolve(__dirname, config.folders.SoundFilters, 'carPark.wav'));
				else if (effects[i][1] == 'pot')
					newCommand = newCommand.input(path.resolve(__dirname, config.folders.SoundFilters, 'pot.wav'));
				else if (effects[i][1] == 'telephone')
					newCommand = newCommand.input(path.resolve(__dirname, config.folders.SoundFilters, 'telephone.wav'));
				else if (effects[i][1] == 'tube')
					newCommand = newCommand.input(path.resolve(__dirname, config.folders.SoundFilters, 'tube.wav'));
				else if (effects[i][1] == 'bath')
					newCommand = newCommand.input(path.resolve(__dirname, config.folders.SoundFilters, 'bath.wav'));
				else if (effects[i][1] == 'can')
					newCommand = newCommand.input(path.resolve(__dirname, config.folders.SoundFilters, 'can.wav'));
				else if (effects[i][1] == 'iron')
					newCommand = newCommand.input(path.resolve(__dirname, config.folders.SoundFilters, 'ironBucket.wav'));
				else if (effects[i][1] == 'horn')
					newCommand = newCommand.input(path.resolve(__dirname, config.folders.SoundFilters, 'hornInHall.wav'));
				
				newCommand = newCommand.outputOptions(['-lavfi', 'afir']);
				//newCommand = newCommand.audioFilters('afir');
			}
		}
		if (complexFilters.length > 0)
			newCommand = newCommand.complexFilter(complexFilters);
		return newCommand;
	},

	//Process stream
	processStream: function (input, flags, opusBitrate=false) {
		let self = this;
		let effects = {};
		if ('effects' in flags)
			effects = flags.effects;

		let command = ffmpeg(input);
		command = this.addAudioEffects(command, effects);
		
		const ffstream = new PassThrough();
		if (opusBitrate)
			command = command.format('s16le');
		else
			command = command.format('s16le');
			command
			.on('error', function (err) {
				self.report("ffmpeg reported error: " + err, 'r');
				if (ffstream)
					ffstream.end();
			})
			.on('end', function (stdout, stderr) {
				//if (stream)
				//	stream.close();
				//if (ffstream)
				//	ffstream.end();
			})
			.on('start', function (commandLine) {
				console.log('Spawned Ffmpeg with command: ' + commandLine);
			})
			.pipe(ffstream);
		return ffstream;
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