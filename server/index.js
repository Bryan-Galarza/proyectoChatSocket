import express from 'express'
import logger from 'morgan'
import dotenv from 'dotenv'
import { createClient } from '@libsql/client'

import { Server } from 'socket.io'
import { createServer } from 'node:http'

dotenv.config()
const port = process.env.PORT ?? 3000

const app = express()
app.use(express.static('client'))
app.use(logger('dev'))

const server = createServer(app)
const io = new Server(server, {
  connectionStateRecovery: {}
})

const db = createClient({
  url: process.env.DB_URL,
  authToken: process.env.DB_TOKEN
})

//Tablas para mensajes general y privado
await db.execute(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT,
    user TEXT
  )
`)

await db.execute(`
  CREATE TABLE IF NOT EXISTS private_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT,
    sender TEXT,
    receiver TEXT,
    room_id TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`)

io.on('connection', async (socket) => {
  const username = socket.handshake.auth.username ?? 'anonymous';
  console.log(`an user has connected!: ${username}`);
  socket.broadcast.emit('user status', {username, action: 'join' })

  const connectedUsers = Array.from(io.sockets.sockets.values())
    .map(s => s.handshake.auth.username)
    .filter(name => name && name !== username)
  
  connectedUsers.forEach(user => {
    socket.emit('user status', {username: user, action: 'join' })
  })

  socket.on('disconnect', () => {
    console.log(`an user has disconnected: ${username}`)
    io.emit('user status', {username, action: 'leave' })
  });

  //Chat general con soket on
  socket.on('chat:general', async (msg) => {
    const username = socket.handshake.auth.username ?? 'anonymous'
    let result

    try {
      result = await db.execute({
        sql: 'INSERT INTO messages (content, user) VALUES (:msg, :username)',
        args: { msg, username }
      })
    } catch (e) {
      console.error(e)
      return
    }
    io.emit('chat message', msg, result.lastInsertRowid.toString(), username)
  })

  //Recuperar mensajes
  if (!socket.recovered) {
    try {
      const results = await db.execute({
        sql: 'SELECT id, content, user FROM messages WHERE id > ? ORDER BY id DESC LIMIT 30',
        args: [socket.handshake.auth.serverOffset ?? 0]
      })

      results.rows.reverse().forEach(row => {
        socket.emit('chat message', row.content, row.id.toString(), row.user)
      })
    } catch (e) {
      console.error(e)
    }
  }

  //Regresaar al chat general
  socket.on('join:general', async () => {
    console.log(`${username} volviendo al chat general`)

    try {
      const results = await db.execute({
        sql: `SELECT id, content, user FROM(
                SELECT id, content, user FROM messages ORDER BY id DESC LIMIT 19) sub ORDER BY id ASC`,
        args: []
      })
      //reiniciar offset
      let lastId = 0
      
      results.rows.forEach(row => {
        socket.emit('chat message', row.content, row.id.toString(), row.user)
      lastId = row.id
      })
      socket.emit('reset offset', lastId)
    } catch (e) {
      console.error('Error al recuperar historial general:', e)
    }
  })

  //Union a sala privada
  socket.on('join:private', async (roomId) => {
    socket.join(roomId);
    console.log(`${username} unido a sala ${roomId}`)
    
    try {
      const results = await db.execute({
        sql: 'SELECT id, content, sender, receiver, room_id FROM private_messages WHERE room_id = ? ORDER BY id ASC LIMIT 20',
        args: [roomId]
      })

      results.rows.forEach(row => {
        socket.emit('private message history', {
          msg: row.content,
          sender: row.sender,
          receiver: row.receiver,
          roomId: row.room_id
        })
      })
    }catch (e) {
      console.error('Error al recuperar los mensajes privados:', e)
    }
  })

  //chat privado
  socket.on('chat:private', async ({ msg, roomId, target }) => {
    const username = socket.handshake.auth.username ?? 'anonymous'

    if (!socket.rooms.has(roomId)) {
      socket.join(roomId);
    }

    try {
      await db.execute({
        sql: 'INSERT INTO private_messages (content, sender, receiver, room_id) VALUES (:msg, :sender, :receiver, :roomId)',
        args: { msg, sender: username, receiver: target, roomId }
      })
    } catch (e) {
      console.error('Error al guardar mensaje privado:', e)
    }

    for (const [, targetSocket] of io.sockets.sockets) {
      if (targetSocket.handshake.auth.username === target) {
        if (!targetSocket.rooms.has(roomId)) {
          targetSocket.join(roomId);
        }
        break;
      }
    }
    //Emitir el mensaje con io
    io.to(roomId).emit('private message', { msg, username, roomId})
  })
})

app.get('/', (req, res) => {
  res.sendFile(process.cwd() + '/client/index.html')
})

server.listen(port, () => {
  console.log(`Server running on port ${port}`)
})