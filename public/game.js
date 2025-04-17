let player = document.querySelector("#player");
let playerSize = 48;
let socket;
let playerName = "";
let playerId = null;
let gameParams = {};
let otherPlayers = {}; 
let foods = []; 
let viewportX = 0;
let viewportY = 0;
let mouseX = 0;
let mouseY = 0;
let currentGridCell = 'A3'; // Текущая активная ячейка сетки
let zoomLevel = 1; // Уровень зума камеры
let maxZoom = 2.5; // Максимальный зум при увеличении размера игрока
let maxPlayerSize = 2000; // Максимальный размер игрока для ограничения роста

// Настройка игрового поля
const gameField = document.createElement("div");
gameField.id = "game-field";
gameField.style.position = "absolute";
gameField.style.top = "0";
gameField.style.left = "0";
gameField.style.zIndex = "-1";
document.body.appendChild(gameField);

// Добавление обработчика события для движения мыши
window.addEventListener("mousemove", (event) => {
  mouseX = event.clientX;
  mouseY = event.clientY;
});

// Функция для показа инструкций
function showInstructions() {
  document.getElementById('menu').style.display = 'none';
  document.getElementById('instructions').style.display = 'flex';
}

// Функция для закрытия инструкций и возврата к меню
function closeInstructions() {
  document.getElementById('instructions').style.display = 'none';
  document.getElementById('menu').style.display = 'flex';
}

// Функция для установки активной ячейки в меню
function setActiveCell(cellId) {
  // Сначала сбросим все активные ячейки
  document.querySelectorAll('#game-menu button').forEach(btn => {
    btn.classList.remove('active');
  });
  
  // Установим новую активную ячейку
  const button = document.getElementById(`grid-${cellId}`);
  if (button) {
    button.classList.add('active');
  }
}

// Функция для старта игры
function startGame() {
  const input = document.getElementById("username");
  playerName = input.value.trim();
  if (!playerName) return alert("Введите имя!");

  document.getElementById("menu").style.display = "none";
  document.getElementById("score").style.display = "block";
  document.getElementById("leaderboard").style.display = "block";
  document.getElementById("game-menu").style.display = "block";

  // Подключение к WebSocket серверу
  socket = new WebSocket("ws://" + window.location.host);

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ type: "join", name: playerName }));
  });

  socket.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);

    switch(msg.type) {
      case "gameParams":
        // Получаем параметры игры с сервера
        gameParams = msg.data;
        playerSize = gameParams.initialPlayerSize;
        player.style.width = playerSize + "px";
        player.style.height = playerSize + "px";
        player.textContent = playerName; // Добавляем имя игрока на шарик
        playerId = msg.playerId;
        
        // Устанавливаем размеры игрового поля на основе данных с сервера
        gameField.style.width = gameParams.fieldWidth + "px";
        gameField.style.height = gameParams.fieldHeight + "px";
        gameField.style.backgroundColor = "#F0F0F0";
        
        // После получения параметров игры, запускаем игру
        startGameLoop();
        break;
      
      case "leaderboard":
        updateLeaderboard(msg.data);
        break;
      
      case "playerUpdate":
        updateOtherPlayers(msg.players);
        break;
      
      case "foodUpdate":
        updateFood(msg.foods);
        break;
      
      case "playerDeath":
        if (msg.playerId === playerId) {
          // Отображаем результат в красивом модальном окне
          const finalScore = otherPlayers[playerId]?.score || 0;
          
          const gameOverModal = document.createElement('div');
          gameOverModal.className = 'modal game-over-modal';
          gameOverModal.innerHTML = `
            <div class="modal-content">
              <h2>Игра окончена!</h2>
              <p>Ваш итоговый счет: <span class="final-score">${finalScore}</span></p>
              <button onclick="window.location.reload()">Играть снова</button>
            </div>
          `;
          document.body.appendChild(gameOverModal);
        }
        break;
        
      case "actionResponse":
        // Обработка ответа на действие по нажатию кнопки
        console.log(`Выполнено действие: ${msg.key}`);
        break;
    }
  });

  socket.addEventListener("close", () => {
    alert("Соединение с сервером потеряно!");
    window.location.reload();
  });
  
  // Добавляем обработчики к существующим кнопкам меню
  document.querySelectorAll('#game-menu button').forEach(button => {
    button.addEventListener('click', () => {
      const cellId = button.id.replace('grid-', '');
      socket.send(JSON.stringify({
        type: 'actionKey',
        key: cellId
      }));
    });
  });
}

// Функция для запуска игрового цикла
function startGameLoop() {
  gameLoop();
}

// Функция для определения текущей ячейки сетки по координатам игрока
function determineGridCell(x, y) {
  if (!gameParams.fieldWidth || !gameParams.fieldHeight) return 'A3';
  
  // Делим игровое поле на 5x5 секций
  const cellWidth = gameParams.fieldWidth / 5;
  const cellHeight = gameParams.fieldHeight / 5;
  
  const col = Math.min(Math.floor(x / cellWidth) + 1, 5);
  const row = Math.min(Math.floor(y / cellHeight) + 1, 5);
  
  // Преобразуем числовые координаты в формат A1, B2, итд.
  const rowLabels = ['A', 'B', 'C', 'D', 'E'];
  return `${rowLabels[row - 1]}${col}`;
}

// Вычисление уровня зума в зависимости от размера игрока
function calculateZoom(size) {
  if (size <= gameParams.initialPlayerSize) return 1;

  // Линейная интерполяция между 1 и maxZoom в зависимости от размера
  const normalizedSize = Math.min(size, maxPlayerSize);
  const zoomFactor = (normalizedSize - gameParams.initialPlayerSize) / 
                    (maxPlayerSize - gameParams.initialPlayerSize);
  
  return 1 + zoomFactor * (maxZoom - 1);
}

let minSpeed = 0.5;
let maxSpeed = 5;

// Основная функция обновления состояния игры
function update() {
  if (!playerId || !otherPlayers[playerId]) return;
  
  // Получаем нашего игрока из объекта игроков
  const me = otherPlayers[playerId];
  
  // Ограничение максимального размера игрока
  me.size = Math.min(me.size, maxPlayerSize);
  playerSize = me.size;
  
  // Обновляем размер визуального представления игрока
  player.style.width = playerSize + "px";
  player.style.height = playerSize + "px";
  
  // Определяем текущую ячейку сетки по позиции игрока
  const gridCell = determineGridCell(me.x, me.y);
  if (gridCell !== currentGridCell) {
    // Обновляем активную ячейку в меню
    setActiveCell(gridCell);
    currentGridCell = gridCell;
    
    // Уведомляем сервер о смене активной ячейки
    socket.send(JSON.stringify({
      type: 'gridCellChange',
      cell: gridCell
    }));
  }
  
  // Рассчитываем уровень зума в зависимости от размера игрока
  const targetZoom = calculateZoom(me.size);
  
  // Плавно изменяем текущий зум (интерполяция)
  zoomLevel += (targetZoom - zoomLevel) * 0.05;
  
  // Рассчитываем направление движения на основе положения мыши
  let dx = mouseX - window.innerWidth / 2;
  let dy = mouseY - window.innerHeight / 2;
  let distance = Math.sqrt(dx * dx + dy * dy);

  if (distance > 1) {
    // Вычисляем базовую скорость
    let baseSpeedX = dx * gameParams.speedFactor;
    let baseSpeedY = dy * gameParams.speedFactor;
    
    // Находим текущую скорость движения
    let currentSpeed = Math.sqrt(baseSpeedX * baseSpeedX + baseSpeedY * baseSpeedY);
    
    // Корректируем скорость
    if (currentSpeed > maxSpeed) {
      baseSpeedX = (baseSpeedX / currentSpeed) * maxSpeed;
      baseSpeedY = (baseSpeedY / currentSpeed) * maxSpeed;
    } else if (currentSpeed < minSpeed && distance > minSpeed) {
      baseSpeedX = (baseSpeedX / currentSpeed) * minSpeed;
      baseSpeedY = (baseSpeedY / currentSpeed) * minSpeed;
    }
    
    // Замедляем крупных игроков (чем больше игрок, тем медленнее он движется)
    const sizeFactor = Math.max(0.3, 1 - (me.size - gameParams.initialPlayerSize) / 1000);
    baseSpeedX *= sizeFactor;
    baseSpeedY *= sizeFactor;
    
    // Отправляем новую позицию на сервер
    const newX = me.x + baseSpeedX;
    const newY = me.y + baseSpeedY;
    
    socket.send(JSON.stringify({
      type: "playerMove",
      x: newX,
      y: newY
    }));
  }
  
  // Обновляем камеру чтобы следовать за игроком с учетом зума
  updateCamera();
}

// Функция для обновления положения камеры с учетом зума
function updateCamera() {
  if (!playerId || !otherPlayers[playerId]) return;
  
  // Получаем позицию нашего игрока
  const playerX = otherPlayers[playerId].x;
  const playerY = otherPlayers[playerId].y;
  
  // Установка камеры с учетом зума
  viewportX = playerX - window.innerWidth / (2 * zoomLevel);
  viewportY = playerY - window.innerHeight / (2 * zoomLevel);
  
  // Обновляем положение игрового поля для создания эффекта камеры с зумом
  gameField.style.transform = `translate(${-viewportX}px, ${-viewportY}px) scale(${zoomLevel})`;
  gameField.style.transformOrigin = '0 0';
}

// Функция для отрисовки игрока на экране
function render() {
  // Игрок всегда в центре экрана
  player.style.left = (window.innerWidth / 2 - playerSize / 2) + "px";
  player.style.top = (window.innerHeight / 2 - playerSize / 2) + "px";
  
  // Масштабируем шрифт в зависимости от размера игрока
  const fontSize = Math.min(16, Math.max(10, playerSize / 4));
  player.style.fontSize = `${fontSize}px`;
}

// Функция для обновления других игроков
function updateOtherPlayers(players) {
  // Удаляем игроков, которых больше нет
  for (const id in otherPlayers) {
    if (!players[id]) {
      if (id !== playerId) { 
        otherPlayers[id].element?.remove();
      }
      delete otherPlayers[id];
    }
  }
  
  // Обновляем/создаем других игроков
  for (const id in players) {
    const p = players[id];
    
    // Ограничиваем размер для всех игроков
    p.size = Math.min(p.size, maxPlayerSize);
    
    if (!otherPlayers[id]) {
      // Создаем нового игрока
      if (id !== playerId) { 
        const elem = document.createElement('div');
        elem.className = 'other-player';
        elem.style.position = 'absolute';
        elem.style.borderRadius = '50%';
        elem.style.backgroundColor = getRandomColor();
        elem.style.zIndex = '100';
        elem.textContent = p.name;
        gameField.appendChild(elem);
        
        otherPlayers[id] = {
          element: elem,
          name: p.name,
          x: p.x,
          y: p.y,
          size: p.size,
          score: p.score
        };
      } else {
        // Для нашего игрока запоминаем только данные
        otherPlayers[id] = {
          name: p.name,
          x: p.x,
          y: p.y,
          size: p.size,
          score: p.score
        };
        
        // Обновляем счет
        document.getElementById("score").innerText = `Счёт: ${p.score}`;
      }
    } else {
      // Обновляем данные игрока
      otherPlayers[id].x = p.x;
      otherPlayers[id].y = p.y;
      otherPlayers[id].size = p.size;
      otherPlayers[id].score = p.score;
      
      // Если это наш игрок, обновляем счет
      if (id === playerId) {
        document.getElementById("score").innerText = `Счёт: ${p.score}`;
      } else {
        // Для других игроков обновляем их положение на поле
        const elem = otherPlayers[id].element;
        elem.style.width = p.size + 'px';
        elem.style.height = p.size + 'px';
        elem.style.left = (p.x - p.size / 2) + 'px';
        elem.style.top = (p.y - p.size / 2) + 'px';
        
        // Масштабируем шрифт в зависимости от размера игрока
        const fontSize = Math.min(16, Math.max(10, p.size / 4));
        elem.style.fontSize = `${fontSize}px`;
      }
    }
  }
}

// Оптимизированная функция для обновления еды с немедленным удалением элементов
function updateFood(serverFoods) {
  const serverFoodIds = new Set(serverFoods.map(food => food.id));
  
  // Быстрое удаление еды, которой больше нет
  const foodToRemove = foods.filter(food => !serverFoodIds.has(food.id));
  foodToRemove.forEach(food => {
    food.element.remove(); // Немедленно удаляем элемент из DOM
  });
  
  // Фильтруем массив еды (оставляем только существующую)
  foods = foods.filter(food => serverFoodIds.has(food.id));
  
  // Создаем Map для быстрого доступа к существующей еде
  const foodMap = new Map(foods.map(food => [food.id, food]));
  
  // Обрабатываем серверный список еды
  serverFoods.forEach(foodData => {
    const existingFood = foodMap.get(foodData.id);
    
    if (existingFood) {
      // Обновляем позицию существующей еды
      existingFood.x = foodData.x;
      existingFood.y = foodData.y;
      
      // Обновляем визуальное представление
      existingFood.element.style.left = (foodData.x - foodData.size / 2) + "px";
      existingFood.element.style.top = (foodData.y - foodData.size / 2) + "px";
    } else {
      // Создаем новую еду
      const food = document.createElement("div");
      food.className = "food";
      food.style.position = "absolute";
      food.style.borderRadius = "50%";
      food.style.width = foodData.size + "px";
      food.style.height = foodData.size + "px";
      food.style.left = (foodData.x - foodData.size / 2) + "px";
      food.style.top = (foodData.y - foodData.size / 2) + "px";
      food.style.backgroundColor = foodData.color;
      
      gameField.appendChild(food);
      
      foods.push({
        id: foodData.id,
        element: food,
        x: foodData.x,
        y: foodData.y,
        size: foodData.size
      });
    }
  });
}

// Функция для обновления таблицы лидеров
function updateLeaderboard(data) {
  const list = document.getElementById("leaders");
  list.innerHTML = "";
  
  data.forEach((p, index) => {
    const li = document.createElement("li");
    li.textContent = `${index + 1}. ${p.name}: ${p.score}`;
    
    // Выделяем наше имя в списке лидеров
    if (p.name === playerName) {
      li.classList.add('current-player');
    }
    
    list.appendChild(li);
  });
}

// Функция для генерации случайного цвета
function getRandomColor() {
  const colors = ["#FF5733", "#33FF57", "#3357FF", "#F333FF", "#FF33A1", "#33FFF6"];
  return colors[Math.floor(Math.random() * colors.length)];
}

// Основной игровой цикл
function gameLoop() {
  update();
  render();
  requestAnimationFrame(gameLoop);
}

// Инициализация кнопок меню после загрузки DOM
document.addEventListener('DOMContentLoaded', () => {
  // Добавляем обработчики к кнопкам в главном меню
  document.getElementById('instructions-button').addEventListener('click', showInstructions);
  document.getElementById('back-to-menu').addEventListener('click', closeInstructions);
  document.getElementById('start-form').addEventListener('submit', (e) => {
    e.preventDefault();
    startGame();
  });
});