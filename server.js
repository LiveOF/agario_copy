const express = require('express');
const WebSocket = require('ws');
const path = require('path');

// Создание Express приложения
const app = express();
const port = 3000;  // Порт для веб-сервера

// Создание WebSocket сервера
const wss = new WebSocket.Server({ noServer: true });

// Параметры игры, которые будут передаваться клиентам
const gameParams = {
  speedFactor: 0.01,  // Скорость движения игрока
  initialSize: 48,    // Начальный размер игрока
  foodSpawnRate: 100, // Частота спавна еды
  minSpeed: 0.5,
  maxSpeed: 5
};

const players = [];

// Статический сервер для обслуживания файлов
app.use(express.static(path.join(__dirname, 'public')));

// Сервер для WebSocket
app.server = app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});

app.server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', (ws) => {
  console.log('Player connected');
  ws.on('message', (message) => {
    const data = JSON.parse(message);

    if (data.type === 'join') {
      const newPlayer = {
        name: data.name,
        score: 0,
        socket: ws,
      };
      players.push(newPlayer);

      // Отправляем параметры игры новому клиенту
      ws.send(JSON.stringify({ type: 'gameParams', data: gameParams }));

      // Обновляем таблицу лидеров
      updateLeaderboard();

      ws.on('close', () => {
        const index = players.indexOf(newPlayer);
        if (index !== -1) {
          players.splice(index, 1);
        }
        updateLeaderboard();
      });
    }

    if (data.type === 'score') {
      // Обновляем счёт игрока
      const player = players.find((p) => p.name === data.name);
      if (player) {
        player.score = data.score;
        updateLeaderboard();
      }
    }
  });
});

// Функция для обновления таблицы лидеров
function updateLeaderboard() {
  const leaderboard = players
    .sort((a, b) => b.score - a.score)
    .map((player) => ({ name: player.name, score: player.score }));

  players.forEach((player) => {
    player.socket.send(
      JSON.stringify({ type: 'leaderboard', data: leaderboard })
    );
  });
}
