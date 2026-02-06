import { io } from 'https://cdn.socket.io/4.3.2/socket.io.esm.min.js'

let currentRoom = null
let currentTarget = null

//Funcion para pedir username al usuario
const promptUsername = () => new Promise((resolve) =>{
  const modal = document.getElementById('username-modal')
  const form = document.getElementById('username-form')
  const inputField = document.getElementById('username-input')
  const skipButton = document.getElementById('username-skip')

  const cleanup = () =>{
    form.removeEventListener('submit', onSubmit)
    skipButton.removeEventListener('click', onSkip)
    modal.classList.remove('is-open')
  }

  const onSubmit = (event) =>{
    event.preventDefault()
    const value = inputField.value.trim()
    cleanup()
    resolve(value || null)
  }

  const onSkip = () => {
    cleanup()
    resolve(null)
  }
  form.addEventListener('submit', onSubmit)
  skipButton.addEventListener('click', onSkip)
  modal.classList.add('is-open')
  inputField.focus()
})

//Obtener el username del usuario o generar uno con randomuser
const getUsername = async () => {
  const username = localStorage.getItem('username')
  if (username && username !== "undefined") return username

  const manualUsername = await promptUsername()
  if (manualUsername) {
    localStorage.setItem('username', manualUsername)
    return manualUsername
  }

  try{
    //Generar usuario aleatorio
    const res = await fetch('https://randomuser.me/api/0.8/?results=1')
    const data = await res.json()
    const randomUsername = data.results[0].user.username

    console.log("Fetched new username:", randomUsername)
    localStorage.setItem('username', randomUsername)
    return randomUsername
  }catch (error){
    console.error("Fetch failed:", error)
  }
}

;(async () => {
  const socket = io({
    auth: {username: await getUsername(), serverOffset: 0}
  })

  //constantes
  const form = document.getElementById('form')
  const input = document.getElementById('input')
  const messages = document.getElementById('messages')
  const statusMessages = document.getElementById('status-messages')
  const notificationList = document.getElementById('notification-list')
  const headerTitle = document.getElementById('header-title')
  const backButton = document.getElementById('back-button')
  const currentUser = socket.auth.username

  //Configuracion de notificaciones
  if (!localStorage.getItem('notifications')){
    localStorage.setItem('notifications', JSON.stringify([]))
  }

  function updateNotificationList(){
    const notifications = JSON.parse(localStorage.getItem('notifications'))
    notificationList.innerHTML = ''

    if (notifications.length === 0){
      notificationList.innerHTML = '<li style="padding: 10px; color: #888;">No hay notificaciones</li>'
      return 
    }
    //Mostrar notificación de nuevo mensaje
    notifications.forEach(notif => {
      const item = document.createElement('li')
      item.className = 'notification-item'
      item.innerHTML = `<strong>${notif.user}</strong><small>Nuevo mensaje</small>`
      item.style.cssText = 'padding: 10px; border-bottom: 1px solid #333; cursor: pointer; background: #2a2a2a; margin-bottom: 5px; border-radius: 5px;'

      item.addEventListener('click', () => {
        openPrivateChat(notif.user)
        const updated = notifications.filter(n => n.user !== notif.user)
        localStorage.setItem('notifications', JSON.stringify(updated))
        updateNotificationList()
      })

      notificationList.appendChild(item)
    })
  }

  function showNotification(fromUser, roomId){
    console.log('Mostrando notificación de:', fromUser, 'room:', roomId)
    const notifications = JSON.parse(localStorage.getItem('notifications'))
    const existing = notifications.find(n => n.user === fromUser)

    if (!existing) {
      notifications.push({ user: fromUser, roomId, timestamp: Date.now() })
      localStorage.setItem('notifications', JSON.stringify(notifications))
      updateNotificationList()
    }
  }

  //Configuraciones del chat
  function openPrivateChat(targetUser){
    if (targetUser === currentUser) return

    const roomId = [currentUser, targetUser].sort().join('-')
    currentRoom = roomId
    currentTarget = targetUser

    headerTitle.textContent = `Chat con ${targetUser}`
    backButton.style.display = 'block'

    messages.innerHTML += `<li style="text-align: center; color: #888; font-style: italic; background: transparent;">
      --- Chat privado con ${targetUser} ---
    </li>`

    //Limpiar la bandeja de notificacion
    const notifications = JSON.parse(localStorage.getItem('notifications'))
    const updated = notifications.filter(n => n.user !== targetUser)
    localStorage.setItem('notifications', JSON.stringify(updated))
    updateNotificationList()
    //unirse a la sala
    socket.emit('join:private', roomId)
  }

  //Regresar al chat general
  function returnToGeneral(){
    currentRoom = null
    currentTarget = null
    headerTitle.textContent = 'Chat General'
    backButton.style.display = 'none'
    messages.innerHTML = `<li style="text-align: center; color: #888; font-style: italic; background: transparent;">
      --- volviendo al Chat General ---
    </li>`

    socket.emit('join:general')
    socket.auth.serverOffset = 0
  }

  //Event Listeners
  backButton.addEventListener('click', returnToGeneral)

  statusMessages.addEventListener('click', (e) => {
    const li = e.target.closest('.user-item')
    if (!li) return

    const targetUser = li.dataset.username || li.textContent.split(' (')[0]
    if (targetUser !== currentUser) {
      openPrivateChat(targetUser)
    }
  })

  //Enviar mensaje segun corresponda chat privado o general
  form.addEventListener('submit', (e) =>{
    e.preventDefault()
    const msg = input.value.trim()
    if (!msg) return

    if (currentRoom && currentTarget) {
      messages.insertAdjacentHTML('beforeend', `
        <li style="align-self: flex-end; max-width: 75%;">
          <small>Tú</small>
          <p>${msg}</p>
        </li>
      `)
      
      socket.emit('chat:private', {
        msg: msg,
        roomId: currentRoom,
        target: currentTarget
      })
    } else {
      socket.emit('chat:general', msg)
    }
    input.value = ''
    messages.scrollTop = messages.scrollHeight
  })

  //Escucha del socket para el chat general
  socket.on('chat message', (msg, serverOffset, username) =>{
    if (!currentRoom) {
      messages.insertAdjacentHTML('beforeend', `
        <li>
          <small>${username}</small>
          <p>${msg}</p>
        </li>
      `)
    }
    socket.auth.serverOffset = serverOffset
    messages.scrollTop = messages.scrollHeight
  })

  socket.on('reset offset', (lastId) => {
    socket.auth.serverOffset = lastId
  })

  socket.on('private message', ({msg, username, roomId}) => {
    const roomIdExpected = [currentUser, username].sort().join('-')
    if (roomId !== roomIdExpected) return
    if (username === currentUser) {return}

    if (currentRoom === roomId) {
      messages.insertAdjacentHTML('beforeend', `
        <li style="align-self: flex-start; max-width: 75%;">
          <small>${username}</small>
          <p>${msg}</p>
        </li>
      `)
      messages.scrollTop = messages.scrollHeight
    }
    else {
      showNotification(username, roomId)
    }
  })

  //Historial para chats privados
  socket.on('private message history', ({ msg, sender, receiver, roomId }) => {
    if (currentRoom !== roomId) return

    const isMine = sender === currentUser
    messages.insertAdjacentHTML('beforeend', `
      <li style="align-self: ${isMine ? 'flex-end' : 'flex-start'}; max-width: 75%;">
        <small>${isMine ? 'Tú' : sender}</small>
        <p>${msg}</p>
      </li>
    `)
    messages.scrollTop = messages.scrollHeight
  })

  //Mostrar estado de los usuarios
  socket.on('user status', ({ username, action }) => {
    if (username === currentUser) return

    if (action === 'join') {
      const item = document.createElement('li')
      item.className = 'user-item'
      item.dataset.username = username
      item.textContent = `${username} se ha unido al chat`
      item.style.cssText = 'cursor:pointer; color:#09f; padding:5px 10px;'
      statusMessages.appendChild(item)

    } else if (action === 'leave') {
      const item = document.createElement('li')
      item.style.cssText = 'color:#888; font-style:italic; padding:5px 10px;'
      item.textContent = `${username} se ha desconectado del chat`
      statusMessages.appendChild(item)
    }
  })

  updateNotificationList()

  //Iniciar chat
  const currentUserItem = document.createElement('li')
  currentUserItem.className = 'user-item'
  currentUserItem.dataset.username = currentUser
  currentUserItem.textContent = `${currentUser} (tú)`
  currentUserItem.style.cssText = 'color:#888; padding:5px 10px; margin:2px 0;'
  statusMessages.appendChild(currentUserItem)
})()