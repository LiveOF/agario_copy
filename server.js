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
  foodAmount: 10000,
  foodSize: { min: 5, max: 15 },
  initialPlayerSize: 48,
  speedFactor: 0.02,
  foodSpawnRate: 10,
  viewDistance: 1500 // Расстояние видимости для спавна еды
};

// Состояние игры
const gameState = {
  players: {},
  food: {},
  leaderboard: []
};

// Статические файлы
app.use(express.static(path.join(__dirname, 'public')));

// Функция для создания еды в заданной области
function createFoodInArea(x, y, radius) {
  const id = uuidv4();
  // Определяем базовый размер еды
  const baseSize = Math.floor(Math.random() *
    (gameSettings.foodSize.max - gameSettings.foodSize.min)) +
    gameSettings.foodSize.min;

  // Увеличиваем визуальный размер на 10-20 пикселей
  const visualSizeBonus = Math.floor(Math.random() * 20) + 20;
  
  // Создаем случайные координаты в пределах указанного радиуса
  const angle = Math.random() * Math.PI * 2;
  const distance = Math.random() * radius;
  const foodX = x + Math.cos(angle) * distance;
  const foodY = y + Math.sin(angle) * distance;
  
  // Убедимся, что еда не выходит за границы игрового поля
  const constrainedX = Math.max(0, Math.min(gameSettings.fieldWidth, foodX));
  const constrainedY = Math.max(0, Math.min(gameSettings.fieldHeight, foodY));

  gameState.food[id] = {
    id,
    x: constrainedX,
    y: constrainedY,
    size: baseSize + visualSizeBonus,
    actualSize: baseSize,
    color: getRandomColor(),
    visible: true // добавляем флаг видимости
  };

  return gameState.food[id];
}

// Функция для генерации случайного цвета
function getRandomColor() {
  const colors = ["#FFB3BA", "#FFDFBA", "#FFFFBA", "#BAFFC9", "#BAE1FF", "#FFC6FF"];
  return colors[Math.floor(Math.random() * colors.length)];
}


// Функция для обновления видимости еды для каждого игрока
function updateFoodVisibility() {
  // Для каждой еды устанавливаем флаг видимости в false
  Object.values(gameState.food).forEach(food => {
    food.visible = false;
  });
  
  // Проверяем для каждого игрока, какая еда попадает в поле зрения
  Object.values(gameState.players).forEach(player => {
    const viewDistance = gameSettings.viewDistance;
    
    Object.values(gameState.food).forEach(food => {
      const dx = player.x - food.x;
      const dy = player.y - food.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      // Если еда в поле зрения, отмечаем как видимую
      if (distance <= viewDistance) {
        food.visible = true;
      }
    });
  });
  
  // Удаляем еду, которая не видна никому из игроков
  const foodToRemove = [];
  Object.keys(gameState.food).forEach(foodId => {
    if (!gameState.food[foodId].visible) {
      foodToRemove.push(foodId);
    }
  });
  
  foodToRemove.forEach(foodId => {
    delete gameState.food[foodId];
  });
}

// Функция для динамического добавления еды вокруг игроков
function spawnFoodAroundPlayers() {
  // Для каждого игрока проверяем, нужно ли добавить еду
  Object.values(gameState.players).forEach(player => {
    // Определяем, сколько еды должно быть в поле зрения игрока
    const desiredFoodCount = 50; // можно настроить по желанию
    
    // Подсчитываем текущее количество еды в поле зрения игрока
    let visibleFoodCount = 0;
    Object.values(gameState.food).forEach(food => {
      const dx = player.x - food.x;
      const dy = player.y - food.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance <= gameSettings.viewDistance) {
        visibleFoodCount++;
      }
    });
    
    // Если еды меньше, чем нужно, добавляем новую
    const foodToCreate = Math.max(0, desiredFoodCount - visibleFoodCount);
    for (let i = 0; i < foodToCreate; i++) {
      createFoodInArea(player.x, player.y, gameSettings.viewDistance * 0.8);
    }
  });
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

// Отправка игрового состояния всем игрокам - изменяем чтобы отправлять только видимую еду
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

  // Фильтруем только видимую еду для отправки клиентам
  const visibleFood = Object.values(gameState.food).filter(food => food.visible);

  // Отправляем данные только о видимой еде
  broadcastToAll({
    type: 'foodUpdate',
    foods: visibleFood
  });
}

// Проверка столкновений между игроками
function checkPlayerCollisions() {
  // Код остается без изменений
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
        player.score += food.actualSize;
        player.size += food.actualSize / 10;
        
        // Удаляем съеденную еду
        delete gameState.food[foodId];
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

// Обработка подключений WebSocket - оставляем без изменений
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
          
          // Инициализируем немного еды вокруг нового игрока
          for (let i = 0; i < 30; i++) {
            createFoodInArea(gameState.players[playerId].x, gameState.players[playerId].y, gameSettings.viewDistance * 0.8);
          }
          
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
  // Обновляем видимость еды
  updateFoodVisibility();
  
  // Создаем новую еду вокруг игроков, если нужно
  spawnFoodAroundPlayers();
  
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
}, 30); // ~30 FPS

// Запуск сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});