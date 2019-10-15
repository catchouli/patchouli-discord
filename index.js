const Discord = require('discord.js')
const {
  prefix,
  token,
  youtube_key
} = require('./config.json')
const ytdl = require('ytdl-core')
const fs = require('fs')
const search = require('youtube-search')
const isurl = require('is-url')

// A map of discord server -> song queue
const queue = new Map()

// The discord client
const client = new Discord.Client()

// Log when the bot's ready
client.once('ready', () => {
  console.log('ready')
})

// Log when we're reconnecting
client.once('reconnecting', () => {
  console.log('reconnecting')
})

// Log when we disconnect
client.once('disconnect', () => {
  console.log('disconnect')
})

// When there's a message, parse it and accept commands
client.on('message', async message => {
  // If it's us sending the message ignore it
  if (message.author.bot)
    return
  // If the channel isn't our botspam channel ignore it
  if (message.channel.name != 'bot-spam-commands')
    return

  // Correct user if they use a !
  if (message.content.startsWith('!')) {
    return message.channel.send('try: patchouli help')
  }

  // If the message doesn't start with our prefix ignore it
  if (!message.content.startsWith(prefix))
    return

  // Get the server queue for this discord server
  // (might be undefined if this is the first time,
  //  in which case we create it later so don't worry about it)
  const serverQueue = queue.get(message.guild.id)

  // Allow !play commands
  if (message.content.startsWith(`${prefix}play `)) {
    playCommand(message, serverQueue)
  }
  // Allow !skip commands
  else if (message.content.startsWith(`${prefix}skip`)) {
    skipCommand(message, serverQueue)
  }
  // Allow !stop commands
  else if (message.content.startsWith(`${prefix}stop`)) {
    stopCommand(message, serverQueue)
  }
  // Allow !volume commands
  else if (message.content.startsWith(`${prefix}volume `)) {
    volumeCommand(message, serverQueue)
  }
  // Allow !help commands
  else if (message.content.startsWith(`${prefix}help`))
  {
    helpCommand(message, serverQueue)
  }
  else
  {
    message.channel.send('invalid command')
  }
})

// Handle !play commands
async function playCommand(message, serverQueue) {
  // Trim "!play " off the start, there's better ways to do this but it's fast
  const query = message.content.substring(5 + prefix.length)

  // if there's nothing after "!play " then we can't do anything
  if (query.length == 0)
  {
    return message.channel.send('not a valid query')
  }

  // Get the user's active voice channel
  const voiceChannel = message.member.voiceChannel

  // If they aren't in a voice channel scold them for being an idiot
  if (!voiceChannel)
    return message.channel.send('you arent in a voice channel idiot')

  // Make sure the user has permissions for the voice channel
  const permissions = voiceChannel.permissionsFor(message.client.user)
  if (!permissions.has('CONNECT') || !permissions.has('SPEAK'))
    return message.channel.send('i dont have permission to join idiot')

  // Get url
  let url

  // If the query is already a url just play that url, otherwise look one up
  if (isurl(query))
  {
    url = query
  }
  else
  {
    // Look up using youtube search
    let opts = { maxResults: 1, key: youtube_key }
    let result = await search(query, opts)
    if (!result || !result.results || result.results.length == 0)
    {
      return message.channel.send('no results for ' + query)
    }
    else
    {
      url = result.results[0].link
    }
  }

  // Get song info so we can play it
  let song
  try {
    const songInfo = await ytdl.getInfo(url)
    song = {
      title: songInfo.title,
      url: songInfo.video_url
    }
  }
  catch(err)
  {
    console.log('error when getting song info')
    return message.channel.send(`no video found: ${url}`)
  }

  // Now we either construct the server queue or just play the song
  if (!serverQueue) {
    // Create server queue
    const queueConstruct = {
      textChannel: message.channel,
      voiceChannel: voiceChannel,
      connection: null,
      songs: [],
      volume: 0.25,
      playing: true
    }

    // Store server queue in our map
    queue.set(message.guild.id, queueConstruct)

    // Push the song
    queueConstruct.songs.push(song)

    try {
      // Try connecting to voice channel
      var connection = await voiceChannel.join()
      queueConstruct.connection = connection

      // Initiate playback
      play(message.guild, queueConstruct.songs[0])
      return message.channel.send(`${song.title} has been added to the queue`)
    }
    catch (err) {
      // Handle errors and log them to the channel
      queue.delete(message.guild.id)
      return message.channel.send(err)
    }
  }
  else {
    // Otherwise just push it onto the existing queue
    // This is probably sensitive to race conditions..
    serverQueue.songs.push(song)
    return message.channel.send(`${song.title} has been added to the queue`)
  }
}

// Play a song
function play(guild, song) {
  console.log('huh')
  const serverQueue = queue.get(guild.id)
  if (!serverQueue)
    return

  // If there's no songs left, just leave
  if (!song) {
    serverQueue.voiceChannel.leave()
    queue.delete(guild.id)
    return
  }

  // Get the youtube audio stream and connect an error handler so we know wtf happened if it goes wrong
  let stream = ytdl(song.url, { filter: 'audioonly' })
  stream.on('error', (err) => {
    console.error(err)
  })

  // Stream options
  const streamOptions = { seek: 0, volume: 1 }

  // Connect the stream up to the discord dispatcher
  const dispatcher = serverQueue.connection.playStream(stream, streamOptions)
    .on('end', (reason) => {
      // Next song when the song ends
      serverQueue.songs.shift()
      play(guild, serverQueue.songs[0])
    })
    .on('error', error => {
      console.error(error)
    })

  // Set the volume
  dispatcher.setVolumeLogarithmic(serverQueue.volume)
}

// Handle skip commands
function skipCommand(message, serverQueue) {
  // Make sure there's an active server queue etc
  if (!serverQueue)
    return
  if (!message.member.voiceChannel)
    return message.channel.send("you aren't in a voice channel idiot")
  if (!serverQueue)
    return message.channel.send('no songs to skip dumbass')

  // Skip song
  message.channel.send('skipping')
  if (serverQueue.connection && serverQueue.connection.dispatcher)
    serverQueue.connection.dispatcher.end()
}

// Handle stop commands
function stopCommand(message, serverQueue) {
  /// Make sure there's an active server queue etc
  if (!serverQueue)
    return
  if (!message.member.voiceChannel)
    return message.channel.send('You have to be in a voice channel to stop the music!')

  // Stop and clear the server queue
  message.channel.send('stopping')
  serverQueue.songs = []
  if (serverQueue.connection && serverQueue.connection.dispatcher)
    serverQueue.connection.dispatcher.end()
}

// Handle volume commands
function volumeCommand(message, serverQueue) {
  let volume = parseFloat(message.content.substring(7 + prefix.length)) / 100.0

  if (volume > 1.0)
    volume = 1.0

  if (!serverQueue)
    return

  if (serverQueue.connection && serverQueue.connection.dispatcher)
    serverQueue.connection.dispatcher.setVolumeLogarithmic(volume)
}

// Help command
function helpCommand(message, serverQueue) {
  message.channel.send('patchouli 1.0')
  message.channel.send('commands: play <song url or name> | skip | stop | volume <volume>')
  message.channel.send('example: patchouli play despacito')
}

// Finally, set off this whole chain of events by connecting to discord
client.login(token)
