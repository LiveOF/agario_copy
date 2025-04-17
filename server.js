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
  foodAmount: 5000,
  foodSize: { min: 5, max: 15 },
  initialPlayerSize: 48,
  speedFactor: 0.02,
  foodSpawnRate: 25,
  viewDistance: 1500,
  minFoodDensity: 100,
  gridCellSize: 2000,
  maxPlayerSize: 2000,
  playerSizeDecayRate: 0.0001
};

// Состояние игры
const gameState = {
  players: {},
  food: {},
  foodGrid: {}, // Сетка для оптимизации проверки еды
  leaderboard: []
};

// Инициализация сетки для еды
function initFoodGrid() {
  const gridWidth = Math.ceil(gameSettings.fieldWidth / gameSettings.gridCellSize);
  const gridHeight = Math.ceil(gameSettings.fieldHeight / gameSettings.gridCellSize);
  
  for (let x = 0; x < gridWidth; x++) {
    for (let y = 0; y < gridHeight; y++) {
      const cellKey = `${x},${y}`;
      gameState.foodGrid[cellKey] = [];
    }
  }
}

// Получение ключа ячейки сетки по координатам
function getGridCellKey(x, y) {
  const gridX = Math.floor(x / gameSettings.gridCellSize);
  const gridY = Math.floor(y / gameSettings.gridCellSize);
  return `${gridX},${gridY}`;
}

// Статические файлы
app.use(express.static(path.join(__dirname, 'public')));

// Предварительная генерация пула еды
function initializeFood() {
  // Создаем базовый пул еды по всему полю
  for (let i = 0; i < gameSettings.foodAmount; i++) {
    const x = Math.random() * gameSettings.fieldWidth;
    const y = Math.random() * gameSettings.fieldHeight;
    
    createFood(x, y);
  }
}

// Функция для создания еды
function createFood(x, y) {
  const id = uuidv4();
  // Определяем базовый размер еды
  const baseSize = Math.floor(Math.random() *
    (gameSettings.foodSize.max - gameSettings.foodSize.min)) +
    gameSettings.foodSize.min;

  // Увеличиваем визуальный размер для лучшей видимости
  const visualSizeBonus = Math.floor(Math.random() * 20) + 10;
  
  // Убедимся, что еда не выходит за границы игрового поля
  const constrainedX = Math.max(0, Math.min(gameSettings.fieldWidth, x));
  const constrainedY = Math.max(0, Math.min(gameSettings.fieldHeight, y));

  const food = {
    id,
    x: constrainedX,
    y: constrainedY,
    size: baseSize + visualSizeBonus,
    actualSize: baseSize,
    color: getRandomColor(),
    visible: false // изначально не видима
  };
  
  gameState.food[id] = food;
  
  // Добавляем еду в соответствующую ячейку сетки
  const cellKey = getGridCellKey(constrainedX, constrainedY);
  if (gameState.foodGrid[cellKey]) {
    gameState.foodGrid[cellKey].push(id);
  }
  
  return food;
}

// Функция для создания еды в заданной области с оптимизацией
function createFoodInArea(x, y, radius, count) {
  const newFood = [];
  
  for (let i = 0; i < count; i++) {
    // Создаем случайные координаты в пределах указанного радиуса
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * radius;
    const foodX = x + Math.cos(angle) * distance;
    const foodY = y + Math.sin(angle) * distance;
    
    const food = createFood(foodX, foodY);
    newFood.push(food);
  }
  
  return newFood;
}

// Функция для генерации случайного цвета
function getRandomColor() {
  const colors = ["#FFB3BA", "#FFDFBA", "#FFFFBA", "#BAFFC9", "#BAE1FF", "#FFC6FF"];
  return colors[Math.floor(Math.random() * colors.length)];
}

// Функция для оптимизированного поиска еды вокруг игрока
function getFoodAroundPlayer(player) {
  const viewDistance = gameSettings.viewDistance;
  
  // Получаем диапазон ячеек сетки, которые могут содержать видимую еду
  const minGridX = Math.floor((player.x - viewDistance) / gameSettings.gridCellSize);
  const maxGridX = Math.ceil((player.x + viewDistance) / gameSettings.gridCellSize);
  const minGridY = Math.floor((player.y - viewDistance) / gameSettings.gridCellSize);
  const maxGridY = Math.ceil((player.y + viewDistance) / gameSettings.gridCellSize);
  
  const visibleFood = [];
  const viewDistanceSquared = viewDistance * viewDistance;
  
  // Проверяем каждую ячейку сетки в диапазоне
  for (let gridX = minGridX; gridX <= maxGridX; gridX++) {
    for (let gridY = minGridY; gridY <= maxGridY; gridY++) {
      const cellKey = `${gridX},${gridY}`;
      if (!gameState.foodGrid[cellKey]) continue;
      
      // Проверяем каждую еду в ячейке
      gameState.foodGrid[cellKey].forEach(foodId => {
        const food = gameState.food[foodId];
        if (!food) return;
        
        const dx = player.x - food.x;
        const dy = player.y - food.y;
        const distanceSquared = dx * dx + dy * dy;
        
        if (distanceSquared <= viewDistanceSquared) {
          food.visible = true;
          visibleFood.push(food);
        }
      });
    }
  }
  
  return visibleFood;
}

// Улучшенная функция для обновления видимости еды с агрессивным созданием новой еды
function updateFoodVisibility() {
  // Для каждой еды устанавливаем флаг видимости в false
  Object.values(gameState.food).forEach(food => {
    food.visible = false;
  });
  
  // Для оптимизации создаем отображение всей видимой еды
  const visibleFoodMap = new Map();
  
  // Проверяем для каждого игрока, какая еда попадает в поле зрения
  Object.values(gameState.players).forEach(player => {
    const visibleFood = getFoodAroundPlayer(player);
    
    // Если еды мало вокруг игрока, немедленно добавляем новую
    if (visibleFood.length < gameSettings.minFoodDensity) {
      const foodNeeded = gameSettings.minFoodDensity - visibleFood.length;
      const newFoods = createFoodInArea(player.x, player.y, gameSettings.viewDistance * 0.8, foodNeeded);
      
      // Сразу помечаем новую еду как видимую
      newFoods.forEach(food => {
        food.visible = true;
        visibleFoodMap.set(food.id, food);
      });
    }
    
    // Добавляем уже существующую видимую еду
    visibleFood.forEach(food => {
      visibleFoodMap.set(food.id, food);
    });
  });
  
  return Array.from(visibleFoodMap.values());
}

// Функция для агрессивного пополнения еды при низкой плотности
function ensureFoodDensity() {
  Object.values(gameState.players).forEach(player => {
    // Подсчитываем текущее количество еды в зоне видимости
    const currentFood = getFoodAroundPlayer(player);
    
    if (currentFood.length < gameSettings.minFoodDensity) {
      const foodToCreate = Math.min(25, gameSettings.minFoodDensity - currentFood.length);
      createFoodInArea(player.x, player.y, gameSettings.viewDistance * 0.7, foodToCreate);
    }
  });
}

// Функция для постепенного уменьшения размера больших игроков
function decayPlayerSizes() {
  Object.values(gameState.players).forEach(player => {
    // Если размер больше начального, постепенно уменьшаем
    if (player.size > gameSettings.initialPlayerSize) {
      // Уменьшаем размер пропорционально текущему размеру
      const decayAmount = player.size * gameSettings.playerSizeDecayRate;
      player.size -= decayAmount;
      
      // Не позволяем размеру стать меньше начального
      if (player.size < gameSettings.initialPlayerSize) {
        player.size = gameSettings.initialPlayerSize;
      }
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

// Отправка игрового состояния всем игрокам - только видимой для них еды
function broadcastGameState() {
  const visibleFood = updateFoodVisibility();
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

  // Отправляем данные только о видимой еде
  broadcastToAll({
    type: 'foodUpdate',
    foods: visibleFood
  });
}

// Функция для проверки столкновений с едой - исправленная версия
function checkFoodCollisions() {
  // Создадим массив еды для удаления, чтобы избежать модификации во время итерации
  const foodToRemove = [];
  
  // Для каждого игрока
  Object.keys(gameState.players).forEach(playerId => {
    const player = gameState.players[playerId];
    const playerRadius = player.size / 2;
    
    // Используем оптимизированную функцию для получения еды вокруг игрока
    const visibleFood = getFoodAroundPlayer(player);
    
    visibleFood.forEach(food => {
      // Рассчитываем расстояние
      const dx = player.x - food.x;
      const dy = player.y - food.y;
      const distanceSquared = dx * dx + dy * dy;
      const collisionRadius = playerRadius + food.size / 2;
      const collisionRadiusSquared = collisionRadius * collisionRadius;
      
      // Улучшенная проверка столкновения с запасом для более надежного взаимодействия
      if (distanceSquared <= collisionRadiusSquared * 1.2) { // Добавляем 20% запаса
        // Игрок съел еду
        player.score += food.actualSize;
        
        // Прирост размера с учетом ограничений
        const growth = food.actualSize / 10;
        
        // Если игрок почти достиг максимального размера, снижаем прирост
        if (player.size > gameSettings.maxPlayerSize * 0.8) {
          player.size += growth * ((gameSettings.maxPlayerSize - player.size) / (gameSettings.maxPlayerSize * 0.2));
        } else {
          player.size += growth;
        }
        
        // Ограничиваем максимальный размер
        player.size = Math.min(player.size, gameSettings.maxPlayerSize);
        
        // Добавляем еду в список на удаление
        foodToRemove.push(food.id);
      }
    });
  });
  
  // Удаляем всю съеденную еду сразу после обработки всех игроков
  foodToRemove.forEach(foodId => {
    const food = gameState.food[foodId];
    if (food) {
      // Удаляем из сетки
      const cellKey = getGridCellKey(food.x, food.y);
      if (gameState.foodGrid[cellKey]) {
        const index = gameState.foodGrid[cellKey].indexOf(foodId);
        if (index !== -1) {
          gameState.foodGrid[cellKey].splice(index, 1);
        }
      }
      
      // Удаляем из общего списка еды
      delete gameState.food[foodId];
    }
  });
  
  // Сразу создаем новую еду взамен съеденной
  if (foodToRemove.length > 0) {
    const foodNeeded = Math.min(50, foodToRemove.length);
    for (let i = 0; i < foodNeeded; i++) {
      const x = Math.random() * gameSettings.fieldWidth;
      const y = Math.random() * gameSettings.fieldHeight;
      createFood(x, y);
    }
  }
}

// Проверка столкновений между игроками - исправленная версия
function checkPlayerCollisions() {
  const playersToRemove = [];
  const players = Object.values(gameState.players);
  
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const player1 = players[i];
      const player2 = players[j];
      
      // Проверяем, не помечен ли уже игрок на удаление
      if (playersToRemove.includes(player1.id) || playersToRemove.includes(player2.id)) {
        continue;
      }
      
      // Вычисляем дистанцию между игроками
      const dx = player1.x - player2.x;
      const dy = player1.y - player2.y;
      const distanceSquared = dx * dx + dy * dy;
      const combinedRadius = (player1.size / 2) + (player2.size / 2);
      
      // Проверяем возможность поглощения с более щедрым порогом столкновения
      if (distanceSquared < combinedRadius * combinedRadius * 0.9) { // 90% от суммы радиусов
        const sizeDifference = player1.size - player2.size;
        const requiredDifference = Math.min(player1.size, player2.size) * 0.15; // Снизили до 15%
        
        if (sizeDifference > requiredDifference) {
          // player1 съедает player2
          player1.score += Math.floor(player2.score / 2);
          player1.size += Math.min(player2.size / 4, gameSettings.maxPlayerSize - player1.size);
          
          // Уведомляем о смерти
          if (player2.ws && player2.ws.readyState === WebSocket.OPEN) {
            player2.ws.send(JSON.stringify({
              type: 'playerDeath',
              playerId: player2.id
            }));
          }
          
          // Помечаем игрока на удаление
          playersToRemove.push(player2.id);
          
        } else if (sizeDifference < -requiredDifference) {
          // player2 съедает player1
          player2.score += Math.floor(player1.score / 2);
          player2.size += Math.min(player1.size / 4, gameSettings.maxPlayerSize - player2.size);
          
          // Уведомляем о смерти
          if (player1.ws && player1.ws.readyState === WebSocket.OPEN) {
            player1.ws.send(JSON.stringify({
              type: 'playerDeath',
              playerId: player1.id
            }));
          }
          
          // Помечаем игрока на удаление
          playersToRemove.push(player1.id);
        }
      }
    }
  }
  
  // Удаляем всех съеденных игроков за один проход
  playersToRemove.forEach(id => {
    delete gameState.players[id];
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
          const spawnX = Math.random() * (gameSettings.fieldWidth - 200) + 100;
          const spawnY = Math.random() * (gameSettings.fieldHeight - 200) + 100;
          
          gameState.players[playerId] = {
            id: playerId,
            name: msg.name || 'Игрок',
            x: spawnX,
            y: spawnY,
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
          
          // Инициализируем еду вокруг нового игрока
          createFoodInArea(spawnX, spawnY, gameSettings.viewDistance, 50);
          break;

        case 'playerMove':
          // Обновление позиции игрока
          if (gameState.players[playerId]) {
            gameState.players[playerId].x = msg.x;
            gameState.players[playerId].y = msg.y;
          }
          break;

        case 'actionKey':
          // Обработка нажатия клавиш действия (A1-E5)
          ws.send(JSON.stringify({
            type: 'actionResponse',
            key: msg.key
          }));
          break;
          
        case 'gridCellChange':
          // Отслеживание изменения активной ячейки сетки
          console.log(`Игрок ${gameState.players[playerId]?.name} переместился в ячейку ${msg.cell}`);
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

// Инициализируем сетку для еды
initFoodGrid();

// Инициализируем еду в начале работы сервера
initializeFood();

// Основной игровой цикл с улучшенной частотой проверки столкновений
setInterval(() => {
  // Уменьшаем размер крупных игроков со временем
  decayPlayerSizes();
  
  // Проверяем столкновения игроков с едой (чаще и с более высоким приоритетом)
  checkFoodCollisions();
  
  // Проверяем столкновения между игроками
  checkPlayerCollisions();

  // Ограничиваем игроков в пределах игрового поля
  constrainPlayers();
}, 20); // 50 FPS для более плавных столкновений

// Отдельный интервал для обновления и рендеринга
setInterval(() => {
  // Агрессивное обеспечение необходимой плотности еды
  ensureFoodDensity();
  
  // Обновляем таблицу лидеров
  updateLeaderboard();

  // Отправляем обновленное состояние игры всем клиентам
  broadcastGameState();
}, 30); // ~30 FPS для обновлений UI

// Регулярное создание еды для поддержания стабильного количества
setInterval(() => {
  const totalFoodCount = Object.keys(gameState.food).length;
  
  if (totalFoodCount < gameSettings.foodAmount) {
    const foodToCreate = Math.min(50, gameSettings.foodAmount - totalFoodCount);
    
    for (let i = 0; i < foodToCreate; i++) {
      const x = Math.random() * gameSettings.fieldWidth;
      const y = Math.random() * gameSettings.fieldHeight;
      createFood(x, y);
    }
  }
}, 1000); // Проверка каждую секунду

// Запуск сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});