#!/bin/sh

until node ./bot.js; do
    echo "Bot terminated! Respawning in 5 sec.." >&2
	echo `date +"%Y.%m.%d %H:%M:%S"`" Bot terminated! Respawning in 5 sec!" >> soundboard.log
    sleep 5
done
