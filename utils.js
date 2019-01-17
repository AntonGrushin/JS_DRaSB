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
const { PassThrough } = require('stream');  //For piping file stream to ffmpeg

//technical
var timings = {};

////Class to combine ffmpeg complex filters together
//class complexFilterBuild {
//	constructor() {
//		this.iteration = 0;
//		this.output = [];
//		this.endresult = "";
//	}

//	addFilter(filter, input = null) {
//		let inputSource = "";
//		if (!input && this.iteration == 0)
//			inputSource = "[0:a]";
//		else if (input)
//			inputSource = input;
//		else
//			inputSource = "[s" + this.iteration + "]";
//		this.output.push(inputSource + filter + "[s" + (++this.iteration) + "]");
//		this.endresult = "s" + this.iteration;
//	}
//}

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
		let out = {};
		let now = new Date();
		var timeonly = this.pad(now.getHours()) + '-' + this.pad(now.getMinutes()) + '-' + this.pad(now.getSeconds()) + '_' + this.pad(now.getMilliseconds(), 3);
		out['now'] = now;
		out['file'] = (now.getFullYear() + '-' + this.pad(now.getMonth() + 1) + "-" + this.pad(now.getDate()) + "_" + timeonly);
		return out;
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

	//Return 's' if number is greather than 1
	addS: function(number) {
		if (number > 1)
			return "s";
		else
			return "";
	},

//Convert time in seconds to human readabale format
	humanTime: function(seconds) {
		let numdays = Math.floor(seconds / 86400);
		let numhours = Math.floor(seconds / 3600);
		let numminutes = Math.floor(seconds / 60);
		if (numdays)
			return numdays + " day" + this.addS(numdays);
		else if (numhours)
			return numhours + " hour" + this.addS(numhours);
		else if (numminutes)
			return numminutes + " minute" + this.addS(numminutes);
		else
			return Math.floor(seconds) + " second" + this.addS(seconds);
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
		else if (match = str.match(/([0-9.]+[hmsd]+)/g)) {
			let result = 0;

			for (i in match) {
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
			  date: 2018-01-01T15:00:00.000Z,
			  effects:
			   [ [ 'pitch', -20 ],
				 [ 'vibrato', 12, 50 ],
				 [ 'chorius' ],
				 [ 'pitch', -40 ],
				 [ 'afir', 'echo' ] ] }   */

		//Volume
		let volResult = inString.match(/[ ]+(?:v|vol|volume|loud|loudness)[ ]{0,}([0-9.]+)/);
		if (volResult)
			output['volume'] = Number(volResult[1]);
		//Start time
		let startResult = inString.match(/[ ]+(?:s|start|back|b|ago)[ ]{0,}([0-9.:|0-9hmsd]+)/);
		if (startResult)
			output['start'] = this.toSeconds(startResult[1]);
		//Start time (exact date)
		let dateResult = inString.match(/[ ]+(?:s|start|date|when)[ =]{0,}['"\()]{1,}([0-9a-zA-Z :\-\/\\]+)['"\)]{1,}/);
		if (dateResult)
			output['date'] = new Date(Date.parse(dateResult[1]));
        //End time
        let endResult = inString.match(/[ ]+(?:end|e)[ ]{0,}([0-9.:mhs]+)/);
		if (endResult)
			output['end'] = this.toSeconds(endResult[1]);
		//Duration
		let durResult = inString.match(/[ ]+(?:dur|len|d|duration|length|t|time)[ ]{0,}([0-9.:mhs]+)/);
		if (durResult)
			output['duration'] = this.toSeconds(durResult[1]);
		//Timetag
		let ttagResult = inString.match(/[ ]+([0-9.:mhs]+)/);
		if (ttagResult)
			output['timetag'] = this.toSeconds(ttagResult[1]);
		
		//Effects
		let effResult = inString.match(/[ ]+(echo|pot|telephone|telep|phone|tube|bath|can|iron|horn|pitch|pitchhigh|ph|pitchlow|pl|vibrato|vib|crying|cry|chorus|choir)([ ]{1,}[\-0-9.]{1,}|)([ ]{1,}[\-0-9.]{1,}|)/g);
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
			else if (thisMatch = effResult[i].match(/(?:chorus|choir)/)) {
				effects.push(['chorus']);
			}
		}
		if (effects.length > 0)
			output['effects'] = effects;
		return output;
	},

	//Report filters into a string
	flagsToString: function (flags) {
		let out = "";
		if (Object.keys(flags).length > 0) {
			if (flags['effects']) {
				out = " with effects: ";
				for (i in flags['effects']) {
					if (flags['effects'][i][0] == 'afir') {
						out += "*" +flags['effects'][i][1] + '*, ';
					}
					else
						out += "*"+flags['effects'][i][0] + (flags['effects'][i][1] ? " " + flags['effects'][i][1] : "") + (flags['effects'][i][2] ? " " + flags['effects'][i][2] : "") + '*, ';
				}
				out = out.slice(0, out.length - 2); //remove ', ' from the end
			}
		}
		return out;
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
								break;
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

	//Build FFMPEG command
	//	What's going on here:
	//		Depending on mode ('concat' or 'mix') we need to apply filters in the following order
	//		CONCAT (add up audios one after another)
	//			ffmpeg -imp0 -inmRL -inpSilence -inp1 -inp2 -inpN -filter [concatInputs + concatIR][afir][other]
	//		MIX (delay audios and mix them up)
	//			ffmpeg -imp0 -inpRL -inpSilence -inp1 -inp2 -inpN -filter [delay1][delay2][delayN][amix][concatIR][afir][other]
	buildFfmpegCommand: function (inputs, effects, mode='concat', effectCountLimit=0) {
		//'inputs' structure
		//[ { file:'some/file/name.mp3', delay:3251 },
		//	{ file:'some/file/name.mp3', delay:3251 },
		//	{ file:'some/file/name.mp3', delay:3251 } ] 
		let inputsToMix = [];
		let inputsToConcat = [];
		let filters = [];
		let afirPresented = false;
		let nextInput = '0:0';

		//Add first input
		let ffcom = ffmpeg(inputs.shift().file);

		//Add IR inputs and 'anullsrc' silence input for afir filter (can be only one) if we have any 'afir' effects
		for (i in effects) {
			if (effects[i][0] == 'afir') {
				if (effects[i][1] == 'echo')
					ffcom = ffcom.input(path.resolve(__dirname, config.folders.SoundFilters, 'carPark.wav')).input("anullsrc=r=48000:cl=stereo").inputOptions(["-t", 3, "-f", "lavfi"]);
				else if (effects[i][1] == 'pot')
					ffcom = ffcom.input(path.resolve(__dirname, config.folders.SoundFilters, 'pot.wav')).input("anullsrc=r=48000:cl=stereo").inputOptions(["-t", 1, "-f", "lavfi"]);
				else if (effects[i][1] == 'telephone')
					ffcom = ffcom.input(path.resolve(__dirname, config.folders.SoundFilters, 'telephone.wav')).input("anullsrc=r=48000:cl=stereo").inputOptions(["-t", 1, "-f", "lavfi"]);
				else if (effects[i][1] == 'tube')
					ffcom = ffcom.input(path.resolve(__dirname, config.folders.SoundFilters, 'tube.wav')).input("anullsrc=r=48000:cl=stereo").inputOptions(["-t", 2, "-f", "lavfi"]);
				else if (effects[i][1] == 'bath')
					ffcom = ffcom.input(path.resolve(__dirname, config.folders.SoundFilters, 'bath.wav')).input("anullsrc=r=48000:cl=stereo").inputOptions(["-t", 2, "-f", "lavfi"]);
				else if (effects[i][1] == 'can')
					ffcom = ffcom.input(path.resolve(__dirname, config.folders.SoundFilters, 'can.wav')).input("anullsrc=r=48000:cl=stereo").inputOptions(["-t", 1, "-f", "lavfi"]);
				else if (effects[i][1] == 'iron')
					ffcom = ffcom.input(path.resolve(__dirname, config.folders.SoundFilters, 'ironBucket.wav')).input("anullsrc=r=48000:cl=stereo").inputOptions(["-t", 1, "-f", "lavfi"]);
				else if (effects[i][1] == 'horn')
					ffcom = ffcom.input(path.resolve(__dirname, config.folders.SoundFilters, 'hornInHall.wav')).input("anullsrc=r=48000:cl=stereo").inputOptions(["-t", 2, "-f", "lavfi"]);

				//Concat source and silence input
				//filterBuilder.addFilter("concat=v=0:a=1", "[0:a][2:a]");
				afirPresented = true;
				break;
			}
		}

		//Add other inputs
		for (i in inputs) {
			ffcom = ffcom.input(inputs[i].file);
		}

		//Concat filters
		if (mode == 'concat') {
			inputsToConcat.push('0:0');
			for (i in inputs) {
				//If we added 'afir' filters, we have 2 additional inputs after 0:0, so add 3 to index number, otherwise add 1 (because first input is no longer in this array)
				inputsToConcat.push((afirPresented ? Number(i) + 3 : Number(i)+1) + ':0');
			}
			if (afirPresented)
				inputsToConcat.push('2:0');
			if (inputsToConcat.length > 1) {
				filters.push({
					filter: 'concat', options: { v: 0, a: 1, n: inputsToConcat.length },
					inputs: inputsToConcat, outputs: 'cnct'
				});
				nextInput = 'cnct';
			}

		}
		//Delay and mix filters
		else {
			inputsToMix.push('0:0');
			//'adelay' filter
			for (i in inputs) {
				let currIndex = afirPresented ? Number(i) + 3 : Number(i) + 1;
				let delay = inputs[i]['delay'] ? inputs[i]['delay'] : 0;
				filters.push({
					filter: 'adelay', options: delay + '|' + delay,
					inputs: currIndex + ':0', outputs: 'dv' + currIndex
				});
				filters.push({
					filter: 'volume', options: inputs.length - Number(i),
					inputs: 'dv' + currIndex, outputs: 'd' + currIndex
				});
				inputsToMix.push('d' + currIndex);
			}
			//'amix' filter
			if (inputsToMix.length > 1) {
				filters.push({
					filter: 'amix', options: { inputs: inputsToMix.length, duration: 'longest', dropout_transition: 0 },
					inputs: inputsToMix, outputs: 'mixOut'
				});
				//filters.push({
				//	filter: 'volume', options: inputsToMix.length,
				//	inputs: 'mixOutNv', outputs: 'mixOut'
				//});
				nextInput = 'mixOut';
			}
			//add concat here if we have afir filters
			if (afirPresented) {
				filters.push({
					filter: 'concat', options: { v: 0, a: 1, n:2 },
					inputs: [ nextInput, '2:0'], outputs: 'cnct'
				});
				nextInput = 'cnct';
			}
		}
		//add other filters if we have any (including 'afir')
		let effectCount = 0;
		for (i in effects) {
			effectCount++;
			if (effectCountLimit > 0 && effectCount > effectCountLimit)
				break;
			if (effects[i][0] == 'pitch') {
				let speed = (1 - effects[i][1] / 100);
				if (speed < 0.5)
					speed = 0.5;
				filters.push({ filter: 'asetrate', options: (48000 * (1 + effects[i][1] / 100)), inputs: nextInput, outputs: 'strt' });
				filters.push({ filter: 'aresample', options: '48000', inputs: 'strt', outputs: 'rsmpl' });
				filters.push({ filter: 'atempo', options: speed, inputs: 'rsmpl', outputs: 'e' + effectCount });
			}
			else if (effects[i][0] == 'vibrato')
				filters.push({ filter: 'vibrato', options: [ effects[i][1], (effects[i][2] / 100) ], inputs: nextInput, outputs: 'e' + effectCount });
			else if (effects[i][0] == 'chorus')
				filters.push({ filter: 'chorus', options: '0.5:0.9:50|60|40:0.4|0.32|0.3:0.25|0.4|0.3:2|2.3|1.3', inputs: nextInput, outputs: 'e' + effectCount });
			else if (effects[i][0] == 'afir')
				filters.push({ filter: 'afir', inputs: nextInput, outputs: 'e' + effectCount });
			nextInput = 'e' + effectCount;
		}
		//Add mapping to the command if we have any filters
		if (filters.length > 0)
			ffcom = ffcom.complexFilter(filters).outputOptions('-map', "[" + nextInput + "]");
		return ffcom;
	},

	////Add all effects from the list to ffmpeg command
	//addAudioEffects: function (ffmpegCommand, effects, inputsToAttach=null) {
	//	//inputsToAttach structure
	//	//{	mode: 'concat' or 'mix',
	//	//	list: [ { file:'some/file/name.mp3', delay:3251 },
	//	//			{ file:'some/file/name.mp3', delay:3251 },
	//	//			{ file:'some/file/name.mp3', delay:3251 } ] }

	//	let newCommand = ffmpegCommand;
	//	let filterBuilder = new complexFilterBuild();
	//	//First, add IR inputs and 'anullsrc' silence input for afir filter (can be only one)
	//	for (i in effects) {
	//		if (effects[i][0] == 'afir') {
	//			if (effects[i][1] == 'echo')
	//				newCommand = newCommand.input(path.resolve(__dirname, config.folders.SoundFilters, 'carPark.wav')).input("anullsrc=r=48000:cl=stereo").inputOptions(["-t", 3, "-f", "lavfi"]);
	//			else if (effects[i][1] == 'pot')
	//				newCommand = newCommand.input(path.resolve(__dirname, config.folders.SoundFilters, 'pot.wav')).input("anullsrc=r=48000:cl=stereo").inputOptions(["-t", 1, "-f", "lavfi"]);
	//			else if (effects[i][1] == 'telephone')
	//				newCommand = newCommand.input(path.resolve(__dirname, config.folders.SoundFilters, 'telephone.wav')).input("anullsrc=r=48000:cl=stereo").inputOptions(["-t", 1, "-f", "lavfi"]);
	//			else if (effects[i][1] == 'tube')
	//				newCommand = newCommand.input(path.resolve(__dirname, config.folders.SoundFilters, 'tube.wav')).input("anullsrc=r=48000:cl=stereo").inputOptions(["-t", 2, "-f", "lavfi"]);
	//			else if (effects[i][1] == 'bath')
	//				newCommand = newCommand.input(path.resolve(__dirname, config.folders.SoundFilters, 'bath.wav')).input("anullsrc=r=48000:cl=stereo").inputOptions(["-t", 2, "-f", "lavfi"]);
	//			else if (effects[i][1] == 'can')
	//				newCommand = newCommand.input(path.resolve(__dirname, config.folders.SoundFilters, 'can.wav')).input("anullsrc=r=48000:cl=stereo").inputOptions(["-t", 1, "-f", "lavfi"]);
	//			else if (effects[i][1] == 'iron')
	//				newCommand = newCommand.input(path.resolve(__dirname, config.folders.SoundFilters, 'ironBucket.wav')).input("anullsrc=r=48000:cl=stereo").inputOptions(["-t", 1, "-f", "lavfi"]);
	//			else if (effects[i][1] == 'horn')
	//				newCommand = newCommand.input(path.resolve(__dirname, config.folders.SoundFilters, 'hornInHall.wav')).input("anullsrc=r=48000:cl=stereo").inputOptions(["-t", 2, "-f", "lavfi"]);

	//			//Concat source and silence input
	//			filterBuilder.addFilter("concat=v=0:a=1", "[0:a][2:a]");
	//			break;
	//		}
	//	}
	//	//Add effects to complexFilterBuild Class
	//	for (i in effects) {
	//		if (effects[i][0] == 'pitch') {
	//			let speed = (1 - effects[i][1] / 100);
	//			if (speed < 0.5)
	//				speed = 0.5;
	//			//complexFilters.push('asetrate=48000*' + (1 + effects[i][1] / 100) + ',aresample=48000,atempo=' + speed);
	//			filterBuilder.addFilter('asetrate=48000*' + (1 + effects[i][1] / 100) + ',aresample=48000,atempo=' + speed);
	//		}
	//		else if (effects[i][0] == 'vibrato')
	//			filterBuilder.addFilter('vibrato=' + effects[i][1] + ':' + (effects[i][2] / 100));
	//		else if (effects[i][0] == 'chorus')
	//			filterBuilder.addFilter('chorus=0.5:0.9:50|60|40:0.4|0.32|0.3:0.25|0.4|0.3:2|2.3|1.3');
	//		else if (effects[i][0] == 'afir') {
	//			filterBuilder.addFilter('afir');
	//		}
	//	}
	//	if (filterBuilder.output.length > 0)
	//		newCommand = newCommand.complexFilter(filterBuilder.output).outputOptions('-map', "["+filterBuilder.endresult+"]");
	//	return newCommand;
	//},

	//Process stream
	processStream: function (inputs, flags, mode = 'concat', opusBitrate=false) {
		let self = this;
		let effects = {};
		if ('effects' in flags)
			effects = flags.effects;

		//let command = ffmpeg(inputs[0].file);
		//command = this.addAudioEffects(command, effects);
		let command = this.buildFfmpegCommand(inputs, effects, mode, config.ComplexFiltersAmountLimit);

		const ffstream = new PassThrough();
		if (opusBitrate)
			command = command.format('s16le');
		else
			command = command.format('s16le').audioChannels(2).audioFrequency(48000);


		//temp
		//let pathParse = path.parse(inputs[0].file); //tmp
		//let stopThis = false;
		//function checkMem(period, firsttick = true, memAtStart = 0, max=0) {
		//	let memUsedNow = process.memoryUsage().rss;
		//	let memStart = firsttick ? memUsedNow : memAtStart;
		//	let MaxThisFar = max < memUsedNow - memStart ? memUsedNow - memStart : max;
		//	console.log("Memory monitor: Now: " + Math.round(memUsedNow / 1024 / 1024 * 100) / 100 + " Mb (" + (memUsedNow - memStart >= 0 ? "+":"")+ Math.round((memUsedNow - memStart) / 1024 / 1024 * 100) / 100+" Mb), Max: " + Math.round(MaxThisFar / 1024 / 1024 * 100) / 100+" Mb")
		//	if (!stopThis)
		//		setTimeout(() => { checkMem(period, false, memStart, MaxThisFar); }, period);
		//}
		//checkMem(100);

		command
			.on('error', function (err) {
				self.report("ffmpeg reported error: " + err, 'r');
				if (ffstream)
					ffstream.end();
				
				//command.kill('SIGSTOP');
				//command.kill();
				delete command;
			})
			.on('end', function (stdout, stderr) {
				//if (stream)
				//	stream.close();
				//if (ffstream)
				//	ffstream.end();
			})
			//.on('progress', function (progress) {
			//	console.log('Processing: ' + Math.round(progress.percent) / 100 + '% done (' + progress.timemark + ') ' + progress.targetSize + ' Kb');
			//})
			.on('start', function (commandLine) {
				if (config.logging.ConsoleReport.FfmpegDebug) self.report('Spawned Ffmpeg with command: ' + commandLine, 'w', config.logging.LogFileReport.FfmpegDebug); //debug message
			})
			.pipe(ffstream);
			//.audioCodec('libmp3lame')
			//.audioBitrate('320k')
			//.output(path.resolve(__dirname, config.folders.Temp, flags.duration + "s_" + pathParse.name + '.mp3'))
			//.run();
		
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