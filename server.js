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
  speedFactor: 0.100,
  foodSpawnRate: 10,
  viewDistance: 1500, // Расстояние видимости для спавна еды
  minSplitSize: 50, // Минимальный размер для разделения
  splitCooldown: 5000, // Задержка между разделениями в мс
  splitSpeed: 8, // Скорость отталкивания при разделении
  mergeTime: 15000, // Время в мс перед повторным слиянием клеток
  minSplitScore: 200 // Минимальный счет для разделения
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
    // Для каждой клетки игрока проверяем видимость еды
    player.cells.forEach(cell => {
      const viewDistance = gameSettings.viewDistance;
      
      Object.values(gameState.food).forEach(food => {
        const dx = cell.x - food.x;
        const dy = cell.y - food.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Если еда в поле зрения, отмечаем как видимую
        if (distance <= viewDistance) {
          food.visible = true;
        }
      });
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
    // Для каждой клетки игрока
    player.cells.forEach(cell => {
      // Определяем, сколько еды должно быть в поле зрения клетки
      const desiredFoodCount = 50; // можно настроить по желанию
      
      // Подсчитываем текущее количество еды в поле зрения клетки
      let visibleFoodCount = 0;
      Object.values(gameState.food).forEach(food => {
        const dx = cell.x - food.x;
        const dy = cell.y - food.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance <= gameSettings.viewDistance) {
          visibleFoodCount++;
        }
      });
      
      // Если еды меньше, чем нужно, добавляем новую
      const foodToCreate = Math.max(0, desiredFoodCount - visibleFoodCount);
      for (let i = 0; i < foodToCreate; i++) {
        createFoodInArea(cell.x, cell.y, gameSettings.viewDistance * 0.8);
      }
    });
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

// Отправка игрового состояния всем игрокам
function broadcastGameState() {
  const playersData = {};

  // Подготавливаем данные игроков для отправки
  Object.keys(gameState.players).forEach(id => {
    const player = gameState.players[id];
    playersData[id] = {
      name: player.name,
      cells: player.cells.map(cell => ({
        id: cell.id,
        x: cell.x,
        y: cell.y,
        size: cell.size
      })),
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

// Функция для проверки столкновений с едой
function checkFoodCollisions() {
  // Для каждого игрока
  Object.keys(gameState.players).forEach(playerId => {
    const player = gameState.players[playerId];
    
    // Для каждой клетки игрока
    player.cells.forEach(cell => {
      // Для каждой еды
      Object.keys(gameState.food).forEach(foodId => {
        const food = gameState.food[foodId];
        
        // Рассчитываем расстояние
        const dx = cell.x - food.x;
        const dy = cell.y - food.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Проверяем столкновение - используем визуальный размер для столкновения
        if (distance < cell.size / 2 + food.size / 2) {
          // Игрок съел еду - используем actualSize для очков
          player.score += food.actualSize;
          cell.size += food.actualSize / 10;
          
          // Удаляем съеденную еду
          delete gameState.food[foodId];
        }
      });
    });
  });
}

// Функция для проверки столкновений между игроками
function checkPlayerCollisions() {
  const playerIds = Object.keys(gameState.players);
  
  // Проверяем каждую пару игроков
  for (let i = 0; i < playerIds.length; i++) {
    const playerId1 = playerIds[i];
    const player1 = gameState.players[playerId1];
    
    for (let j = i + 1; j < playerIds.length; j++) {
      const playerId2 = playerIds[j];
      const player2 = gameState.players[playerId2];
      
      // Проверяем каждую пару клеток этих игроков
      for (let ci = 0; ci < player1.cells.length; ci++) {
        const cell1 = player1.cells[ci];
        
        for (let cj = 0; cj < player2.cells.length; cj++) {
          const cell2 = player2.cells[cj];
          
          // Вычисляем расстояние между клетками
          const dx = cell1.x - cell2.x;
          const dy = cell1.y - cell2.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          // Проверяем условие поедания (клетка должна быть больше на 10%)
          if (cell1.size > cell2.size * 1.1 && distance < cell1.size / 2) {
            // Клетка 1 съедает клетку 2
            const gainedMass = Math.PI * cell2.size * cell2.size;
            cell1.size = Math.sqrt(cell1.size * cell1.size + cell2.size * cell2.size * 0.8);
            player1.score += Math.round(player2.score / player2.cells.length);
            
            // Удаляем съеденную клетку
            player2.cells.splice(cj, 1);
            cj--;
            
            // Проверяем, остались ли у игрока 2 клетки
            if (player2.cells.length === 0) {
              // Игрок 2 проиграл
              const ws = player2.ws;
              const finalScore = player2.score;
              
              // Отправляем сообщение о проигрыше
              if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: 'playerDeath',
                  playerId: playerId2,
                  finalScore: finalScore
                }));
              }
              
              // Удаляем игрока
              delete gameState.players[playerId2];
              
              // Выходим из цикла, так как игрока 2 больше нет
              j = playerIds.length;
              break;
            }
          } 
          else if (cell2.size > cell1.size * 1.1 && distance < cell2.size / 2) {
            // Клетка 2 съедает клетку 1
            const gainedMass = Math.PI * cell1.size * cell1.size;
            cell2.size = Math.sqrt(cell2.size * cell2.size + cell1.size * cell1.size * 0.8);
            player2.score += Math.round(player1.score / player1.cells.length);
            
            // Удаляем съеденную клетку
            player1.cells.splice(ci, 1);
            ci--;
            
            // Проверяем, остались ли у игрока 1 клетки
            if (player1.cells.length === 0) {
              // Игрок 1 проиграл
              const ws = player1.ws;
              const finalScore = player1.score;
              
              // Отправляем сообщение о проигрыше
              if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: 'playerDeath',
                  playerId: playerId1,
                  finalScore: finalScore
                }));
              }
              
              // Удаляем игрока
              delete gameState.players[playerId1];
              
              // Выходим из цикла, так как игрока 1 больше нет
              i = playerIds.length;
              break;
            }
          }
        }
        
        // Если игрока 1 больше нет, выходим из цикла
        if (!gameState.players[playerId1]) {
          break;
        }
      }
    }
  }
}

// Функция для обновления физики и движения клеток
function updateCellsPhysics() {
  Object.values(gameState.players).forEach(player => {
    // Обновляем движение каждой клетки
    player.cells.forEach(cell => {
      // Если у клетки есть скорость, применяем ее
      if (cell.vx || cell.vy) {
        // Перемещаем клетку согласно скорости
        cell.x += cell.vx;
        cell.y += cell.vy;
        
        // Постепенно уменьшаем скорость
        cell.vx *= 0.95;
        cell.vy *= 0.95;
        
        // Если скорость стала очень маленькой, обнуляем
        if (Math.abs(cell.vx) < 0.1) cell.vx = 0;
        if (Math.abs(cell.vy) < 0.1) cell.vy = 0;
      }
      
      // Если у клетки есть направление движения от игрока, применяем его
      if (cell.dx || cell.dy) {
        // Вычисляем базовую скорость в зависимости от размера
        const speed = gameSettings.speedFactor * (50 / Math.max(10, cell.size));
        
        // Перемещаем клетку
        cell.x += cell.dx * speed * 30; // 30 - примерно количество миллисекунд между кадрами
        cell.y += cell.dy * speed * 30;
      }
    });
    
    // Проверяем необходимость слияния клеток
    checkCellMerge(player);
  });
}

// Функция для проверки слияния клеток
function checkCellMerge(player) {
  // Если у игрока меньше 2 клеток, слияние не нужно
  if (player.cells.length < 2) return;
  
  // Проверяем пары клеток для слияния
  for (let i = 0; i < player.cells.length; i++) {
    for (let j = i + 1; j < player.cells.length; j++) {
      const cell1 = player.cells[i];
      const cell2 = player.cells[j];
      
      // Проверяем, достаточно ли времени прошло с момента разделения
      const now = Date.now();
      if (cell1.mergeTime && now < cell1.mergeTime) continue;
      if (cell2.mergeTime && now < cell2.mergeTime) continue;
      
      // Вычисляем расстояние между клетками
      const dx = cell1.x - cell2.x;
      const dy = cell1.y - cell2.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      // Если клетки достаточно близко друг к другу, сливаем их
      if (distance < (cell1.size + cell2.size) * 0.5) {
        // Создаем новую клетку с суммарной массой
        const newSize = Math.sqrt(cell1.size * cell1.size + cell2.size * cell2.size);
        const newX = (cell1.x * cell1.size + cell2.x * cell2.size) / (cell1.size + cell2.size);
        const newY = (cell1.y * cell1.size + cell2.y * cell2.size) / (cell1.size + cell2.size);
        
        // Удаляем старые клетки
        player.cells.splice(j, 1);
        player.cells.splice(i, 1);
        
        // Добавляем новую клетку
        player.cells.push({
          id: uuidv4(),
          x: newX,
          y: newY,
          size: newSize,
          dx: cell1.dx,
          dy: cell1.dy,
          vx: 0,
          vy: 0
        });
        
        // Выходим из циклов, так как индексы клеток изменились
        return;
      }
    }
  }
}

// Функция для ограничения игроков в пределах игрового поля
function constrainPlayers() {
  Object.values(gameState.players).forEach(player => {
    player.cells.forEach(cell => {
      cell.x = Math.max(cell.size / 2, Math.min(gameSettings.fieldWidth - cell.size / 2, cell.x));
      cell.y = Math.max(cell.size / 2, Math.min(gameSettings.fieldHeight - cell.size / 2, cell.y));
    });
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
            cells: [{
              id: uuidv4(),
              x: Math.random() * (gameSettings.fieldWidth - 200) + 100,
              y: Math.random() * (gameSettings.fieldHeight - 200) + 100,
              size: gameSettings.initialPlayerSize,
              dx: 0,
              dy: 0,
              vx: 0,
              vy: 0
            }],
            score: 0,
            color: getRandomColor(),
            ws: ws,
            lastSplitTime: 0
          };

          // Отправляем параметры игры новому игроку
          ws.send(JSON.stringify({
            type: 'gameParams',
            data: gameSettings,
            playerId: playerId
          }));
          
          // Инициализируем немного еды вокруг нового игрока
          for (let i = 0; i < 30; i++) {
            createFoodInArea(gameState.players[playerId].cells[0].x, gameState.players[playerId].cells[0].y, gameSettings.viewDistance * 0.8);
          }
          
          break;

        case 'playerMove':
          // Обновление направления движения игрока
          if (gameState.players[playerId]) {
            // Получаем нормализованный вектор направления
            const dx = msg.dx;
            const dy = msg.dy;
            
            // Обновляем направление для всех клеток игрока
            gameState.players[playerId].cells.forEach(cell => {
              cell.dx = dx;
              cell.dy = dy;
            });
          }
          break;
          
        case 'split':
          // Обработка команды разделения
          if (gameState.players[playerId]) {
            const player = gameState.players[playerId];
            const now = Date.now();
            
            // Проверка времени последнего разделения
            if (now - player.lastSplitTime < gameSettings.splitCooldown) {
              return; // Слишком рано для нового разделения
            }
            
            // Обновляем время последнего разделения
            player.lastSplitTime = now;
            
            // Создаем новые клетки
            const newCells = [];
            const splitCells = [];
            
            // Проходимся по всем клеткам игрока
            player.cells.forEach(cell => {
              // Проверяем, достаточно ли большая клетка для разделения
              if (cell.size >= gameSettings.minSplitSize) {
                // Уменьшаем размер исходной клетки
                cell.size = cell.size / Math.sqrt(2);
                
                // Создаем новую клетку
                const newCell = {
                  id: uuidv4(),
                  x: cell.x,
                  y: cell.y,
                  size: cell.size,
                  dx: cell.dx,
                  dy: cell.dy,
                  vx: cell.dx * gameSettings.splitSpeed,
                  vy: cell.dy * gameSettings.splitSpeed,
                  mergeTime: now + gameSettings.mergeTime
                };
                
                // Добавляем время запрета на слияние исходной клетке
                cell.mergeTime = now + gameSettings.mergeTime;
                
                // Сохраняем обе клетки
                newCells.push(cell);
                splitCells.push(newCell);
              } else {
                // Если клетка слишком маленькая, оставляем её без изменений
                newCells.push(cell);
              }
            });
            
            // Добавляем новые клетки к существующим
            player.cells = [...newCells, ...splitCells];
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
  // Обновляем физику клеток
  updateCellsPhysics();
  
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