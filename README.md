# JavaScript Discord Recorder and Soundboard Bot (JS DRaSB) BETA
This is a Discord bot running on Node.js using discord.js library. It’s written to perform two main features:
  -  __**Automatic voice recording**__: Automatically join channels and record audio to local files compressed with desired codec (using ffmpeg).
  -  __**Soundboard (playing sounds on request)**__: Joins a channel and plays sounds on request. Sounds can be either local files or YouTube links.
# List of all features
> Most of features listed here can be turned on/off in the [config.js]( https://github.com/AntonGrushin/JS_DRaSB/blob/master/config.js) file.
> For example, you can use this bot only as a recorder without any soundboard functionality
> or as a soundboard only. Also, mind that currently **bot can run for a single server only**.
  -  Automatically join and leave voice channels depending on amount of members or by user command.
  -  Bot will start recording on any channel joining automatically
  -  Queuing files or YouTube links for playing in sequence
  -  Volume control is personal: if someone changes the volume level either while something is playing or bot is silent it will remember that level (even after bot restart) and will always play sounds requested by this user with that volume until he changes it.
  -  You can play a short audio file while something long is playing: long sound will pause, short plays and then long resumes. Handy if you have music playing on the bot and you don’t want to stop it.
  -  Can accept commands either globally anywhere or on a special channel only.
  -  Bot will report requested audios and commands to a specified channel

# Installation
Bot requires [Node.js](https://nodejs.org/) with npm and [FFMPEG](https://www.ffmpeg.org/), to use npm automatic installation you will also need building tools for compilation.
> **Tested on Linux Ubuntu 18.10 with Nodejs v8.11.4 and npm v5.8.0)**

First, install all dependencies
```sh
sudo apt-get update
sudo apt-get install nodejs npm ffmpeg build-essential
```
Navigate to the folder where you want your bot to be installed and run (I'm using `/root/`), clone git repository and run npm automatic installation to install all the  libraries needed to run the bot (discord.js, node-opus, bufferutil, erlpack, fluent-ffmpeg and others).
```sh
cd /root/
git clone https://github.com/AntonGrushin/JS_DRaSB.git
cd /root/JS_DRaSB/
npm install
```
Now, you need to create bot account:
1. Head over to the applications page [here](https://discordapp.com/developers/applications/me).
2. Click “new application”. Give it a name, picture and description.
3. Click “Create Bot User” and click “Yes, Do It!” when the dialog pops up.
4. Copy down the token.

Open config.js and paste the token in the 'token' value.
```sh
nano /root/JS_DRaSB/config.js
```
`Ctrl+O`, then `Ctrl+X` to save and exit.
There are three values in [config.js]( https://github.com/AntonGrushin/JS_DRaSB/blob/master/config.js) that are mandatory for bot to function: `token`, `guildId` and `ReportChannelId`.
To get guildId and ReportChannelId you will need to switch Discord into [developer mode](https://discordia.me/developer-mode) and copy ID of your server and then desired channel using right-click. 
You are free to change any other options, make sure you read description on each value before you change it.

# Running the bot
Use `screen` to run the application.
```sh
screen -aAxR -S jsdrasb
node bot.js
```
That’s it! It's running now!
To detach from screen session, use `Ctrl+A`, then `D`. If you want to reattach running bot session use same command ```screen -aAxR -S jsdrasb```
