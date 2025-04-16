const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Настройки игры
const gameSettings = {
  fieldWidth: 10000,
  fieldHeight: 10000,
  foodAmount: 1000,
  foodSize: { min: 5, max: 15 },
  initialPlayerSize: 48,
  speedFactor: 0.02,
  foodSpawnRate: 10
};

// Состояние игры
const gameState = {
  players: {},
  food: {},
  leaderboard: []
};

// Статические файлы
app.use(express.static(path.join(__dirname, 'public')));

// Функция для создания еды
function createFood() {
  const id = uuidv4();
  // Определяем базовый размер еды
  const baseSize = Math.floor(Math.random() *
    (gameSettings.foodSize.max - gameSettings.foodSize.min)) +
    gameSettings.foodSize.min;

  // Увеличиваем визуальный размер на 10-20 пикселей
  const visualSizeBonus = Math.floor(Math.random() * 10) + 10; // 10-20 пикселей больше

  gameState.food[id] = {
    id,
    x: Math.random() * gameSettings.fieldWidth,
    y: Math.random() * gameSettings.fieldHeight,
    size: baseSize + visualSizeBonus, // Визуальный размер больше
    actualSize: baseSize, // Храним настоящий размер для подсчета очков
    color: getRandomColor()
  };

  return gameState.food[id];
}

// Функция для генерации случайного цвета
function getRandomColor() {
  const colors = ["#FFB3BA", "#FFDFBA", "#FFFFBA", "#BAFFC9", "#BAE1FF", "#FFC6FF"];
  return colors[Math.floor(Math.random() * colors.length)];
}

// Инициализация еды
function initializeFood() {
  for (let i = 0; i < gameSettings.foodAmount; i++) {
    createFood();
  }
}

// Обновление таблицы лидеров
function updateLeaderboard() {
  const players = Object.values(gameState.players);
  gameState.leaderboard = players
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(p => ({ name: p.name, score: p.score }));

  // Отправляем таблицу лидеров всем клиентам
  broadcastToAll({
    type: 'leaderboard',
    data: gameState.leaderboard
  });
}

// Отправка сообщения всем клиентам
function broadcastToAll(message) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

// Отправка игрового состояния всем игрокам
function broadcastGameState() {
  const playersData = {};

  // Подготавливаем данные игроков для отправки
  Object.keys(gameState.players).forEach(id => {
    const player = gameState.players[id];
    playersData[id] = {
      name: player.name,
      x: player.x,
      y: player.y,
      size: player.size,
      score: player.score
    };
  });

  // Отправляем обновление всем клиентам
  broadcastToAll({
    type: 'playerUpdate',
    players: playersData
  });

  // Отправляем данные о еде
  broadcastToAll({
    type: 'foodUpdate',
    foods: Object.values(gameState.food)
  });
}

// Проверка столкновений между игроками
function checkPlayerCollisions() {
  const playerIds = Object.keys(gameState.players);

  for (let i = 0; i < playerIds.length; i++) {
    const player1Id = playerIds[i];
    const player1 = gameState.players[player1Id];

    for (let j = i + 1; j < playerIds.length; j++) {
      const player2Id = playerIds[j];
      const player2 = gameState.players[player2Id];

      // Рассчитываем расстояние между игроками
      const dx = player1.x - player2.x;
      const dy = player1.y - player2.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Проверяем столкновение
      if (distance < (player1.size + player2.size) / 2) {
        // Если один игрок значительно больше другого, он съедает меньшего
        if (player1.size > player2.size * 1.1) {
          // Игрок 1 съедает игрока 2
          player1.score += Math.floor(player2.score / 2);
          player1.size += player2.size / 4;

          // Сообщаем игроку 2, что он был съеден
          if (player2.ws && player2.ws.readyState === WebSocket.OPEN) {
            player2.ws.send(JSON.stringify({
              type: 'playerDeath',
              playerId: player2Id
            }));
          }

          // Удаляем съеденного игрока
          delete gameState.players[player2Id];

          // Прерываем цикл, так как один игрок был удален
          break;

        } else if (player2.size > player1.size * 1.1) {
          // Игрок 2 съедает игрока 1
          player2.score += Math.floor(player1.score / 2);
          player2.size += player1.size / 4;

          // Сообщаем игроку 1, что он был съеден
          if (player1.ws && player1.ws.readyState === WebSocket.OPEN) {
            player1.ws.send(JSON.stringify({
              type: 'playerDeath',
              playerId: player1Id
            }));
          }

          // Удаляем съеденного игрока
          delete gameState.players[player1Id];

          // Прерываем цикл, так как один игрок был удален
          break;
        }
      }
    }
  }
}

// Функция для проверки столкновений с едой
function checkFoodCollisions() {
  // Для каждого игрока
  Object.keys(gameState.players).forEach(playerId => {
    const player = gameState.players[playerId];
    
    // Для каждой еды
    Object.keys(gameState.food).forEach(foodId => {
      const food = gameState.food[foodId];
      
      // Рассчитываем расстояние
      const dx = player.x - food.x;
      const dy = player.y - food.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      // Проверяем столкновение - используем визуальный размер для столкновения
      if (distance < player.size / 2 + food.size / 2) {
        // Игрок съел еду - используем actualSize для очков
        player.score += food.actualSize;  // Используем настоящий размер для очков
        player.size += food.actualSize / 10;  // Используем настоящий размер для роста
        
        // Удаляем съеденную еду
        delete gameState.food[foodId];
        
        // Создаем новую еду
        createFood();
      }
    });
  });
}

// Функция для ограничения игроков в пределах игрового поля
function constrainPlayers() {
  Object.values(gameState.players).forEach(player => {
    player.x = Math.max(player.size / 2, Math.min(gameSettings.fieldWidth - player.size / 2, player.x));
    player.y = Math.max(player.size / 2, Math.min(gameSettings.fieldHeight - player.size / 2, player.y));
  });
}

// Обработка подключений WebSocket
wss.on('connection', (ws) => {
  const playerId = uuidv4();

  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);

      switch (msg.type) {
        case 'join':
          // Новый игрок подключился
          gameState.players[playerId] = {
            id: playerId,
            name: msg.name || 'Игрок',
            x: Math.random() * (gameSettings.fieldWidth - 200) + 100,
            y: Math.random() * (gameSettings.fieldHeight - 200) + 100,
            size: gameSettings.initialPlayerSize,
            score: 0,
            color: getRandomColor(),
            ws: ws
          };

          // Отправляем параметры игры новому игроку
          ws.send(JSON.stringify({
            type: 'gameParams',
            data: gameSettings,
            playerId: playerId
          }));

          break;

        case 'playerMove':
          // Обновление позиции игрока
          if (gameState.players[playerId]) {
            gameState.players[playerId].x = msg.x;
            gameState.players[playerId].y = msg.y;
          }
          break;

        case 'score':
          // Обновление счета игрока
          if (gameState.players[playerId]) {
            gameState.players[playerId].score = msg.score;
            updateLeaderboard();
          }
          break;
      }
    } catch (e) {
      console.error("Error processing message:", e);
    }
  });

  ws.on('close', () => {
    // Удаляем игрока при отключении
    delete gameState.players[playerId];
    updateLeaderboard();
  });
});

// Основной игровой цикл
setInterval(() => {
  // Проверяем столкновения игроков с едой
  checkFoodCollisions();

  // Проверяем столкновения между игроками
  checkPlayerCollisions();

  // Ограничиваем игроков в пределах игрового поля
  constrainPlayers();

  // Обновляем таблицу лидеров
  updateLeaderboard();

  // Отправляем обновленное состояние игры всем клиентам
  broadcastGameState();
}, 33); // ~30 FPS

// Инициализация игры
initializeFood();

// Запуск сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});