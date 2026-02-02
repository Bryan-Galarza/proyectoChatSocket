import express from 'express'
import logger from 'morgan'
import dotenv from 'dotenv'
import { createClient } from '@libsql/client'

import { Server } from 'socket.io'
import { createServer } from 'node:http'
//config
dotenv.config()
const port = process.env.PORT ?? 3000

//Express
const app = express()
app.use(express.static('client'))
const server = createServer(app)
const io = new Server(server, {
  connectionStateRecovery: {}
})
//Create client
const db = createClient({
  //url: 'libsql://cuddly-wasp-weaverm.aws-us-west-2.turso.io',
  url: process.env.DB_URL,
  authToken: process.env.DB_TOKEN
})

await db.execute(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT,
    user TEXT
  )
`)
//Notificar cuando alguien se une o desconecta del chat
io.on('connection', async (socket) => {
  const username = socket.handshake.auth.username ?? 'anonymous';
  console.log(`a user has connected!: ${username}`);
  io.emit('user status', `${username} se ha unido al chat`);

  socket.on('disconnect', () => {
    console.log(`an user has disconnected: ${username}`)
    io.emit('user status', `${username} ha salido del chat`);
  });

  socket.on('chat message', async (msg) => {
    let result
    const username = socket.handshake.auth.username ?? 'anonymous'
    console.log({ username })
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

  if (!socket.recovered) { // <- recuperase los mensajes sin conexión
    try {
      const results = await db.execute({
        sql: 'SELECT id, content, user FROM messages WHERE id > ?',
        args: [socket.handshake.auth.serverOffset ?? 0]
      })

      results.rows.forEach(row => {
        socket.emit('chat message', row.content, row.id.toString(), row.user)
      })
    } catch (e) {
      console.error(e)
    }
  }
})

app.use(logger('dev'))

app.get('/', (req, res) => {
  res.sendFile(process.cwd() + '/client/index.html')
})

server.listen(port, () => {
  console.log(`Server running on port ${port}`)
})
