let player = document.querySelector("#player");
let mouseX = 0;
let mouseY = 0;
let socket;
let playerName = "";
let playerId = null;
let gameParams = {}; // Здесь будут храниться настройки игры с сервера
let otherPlayers = {}; // Хранит информацию о других игроках
let foods = []; // Хранит информацию о всей еде
let viewportX = 0;
let viewportY = 0;
let cameraX = window.innerWidth / 2;
let cameraY = window.innerHeight / 2;
let playerX = cameraX;
let playerY = cameraY;
let currentGrid = null; // Текущий сектор на карте

// Настройка игрового поля (визуально для клиента)
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

// Инициализация событий для меню и инструкций
document.addEventListener("DOMContentLoaded", () => {
  const startForm = document.getElementById("start-form");
  const instructionsButton = document.getElementById("instructions-button");
  const backToMenuButton = document.getElementById("back-to-menu");
  const playAgainButton = document.getElementById("play-again");
  
  startForm.addEventListener("submit", (e) => {
    e.preventDefault();
    startGame();
  });
  
  instructionsButton.addEventListener("click", () => {
    document.getElementById("menu").style.display = "none";
    document.getElementById("instructions").style.display = "flex";
  });
  
  backToMenuButton.addEventListener("click", () => {
    document.getElementById("instructions").style.display = "none";
    document.getElementById("menu").style.display = "flex";
  });
  
  playAgainButton.addEventListener("click", () => {
    document.getElementById("game-over").style.display = "none";
    document.getElementById("menu").style.display = "flex";
  });
});

// Функция для старта игры
async function startGame() {
  const input = document.getElementById("username");
  playerName = input.value.trim();
  if (!playerName) return alert("Введите имя!");

  document.getElementById("menu").style.display = "none";
  document.getElementById("score").style.display = "block";
  document.getElementById("leaderboard").style.display = "block";
  document.getElementById("minimap").style.display = "block";

  // Инициализируем мини-карту (без индикатора)
  initMinimap();

  // Устанавливаем имя игрока
  player.textContent = playerName;

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
        playerId = msg.playerId; // Сохраняем ID игрока
        
        // Устанавливаем размеры игрового поля на основе данных с сервера
        gameField.style.width = gameParams.fieldWidth + "px";
        gameField.style.height = gameParams.fieldHeight + "px";
        gameField.style.border = "2px solid #ccc";
        gameField.style.backgroundColor = "#F0F0F0";
        
        // Добавляем линии сетки на игровое поле (4x4)
        addGridLines();
        
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
          showGameOver(msg.finalScore);
        }
        break;
    }
  });

  socket.addEventListener("close", () => {
    alert("Соединение с сервером потеряно!");
    window.location.reload();
  });
}

// Функция для добавления линий сетки на поле
function addGridLines() {
  // Разделяем поле на 4x4 сектора
  const gridSize = 4;
  const cellWidth = gameParams.fieldWidth / gridSize;
  const cellHeight = gameParams.fieldHeight / gridSize;
  
  // Очищаем существующие линии
  document.querySelectorAll(".grid-line, .grid-label").forEach(el => el.remove());
  
  // Добавляем вертикальные линии
  for (let i = 1; i < gridSize; i++) {
    const line = document.createElement("div");
    line.className = "grid-line vertical";
    line.style.position = "absolute";
    line.style.top = "0";
    line.style.left = (cellWidth * i) + "px";
    line.style.width = "1px";
    line.style.height = "100%";
    line.style.backgroundColor = "rgba(200, 200, 200, 0.5)";
    line.style.zIndex = "5";
    gameField.appendChild(line);
  }
  
  // Добавляем горизонтальные линии
  for (let i = 1; i < gridSize; i++) {
    const line = document.createElement("div");
    line.className = "grid-line horizontal";
    line.style.position = "absolute";
    line.style.left = "0";
    line.style.top = (cellHeight * i) + "px";
    line.style.height = "1px";
    line.style.width = "100%";
    line.style.backgroundColor = "rgba(200, 200, 200, 0.5)";
    line.style.zIndex = "5";
    gameField.appendChild(line);
  }
}

// Функция для инициализации мини-карты (без индикатора)
function initMinimap() {
  // Настраиваем обработчики для кнопок мини-карты
  const gridButtons = document.querySelectorAll("#minimap button");
  gridButtons.forEach(button => {
    button.addEventListener("click", () => {
      // Получаем координаты сектора на основе его ID
      const gridId = button.id.replace("grid-", "");
      const letter = gridId.charAt(0);
      const number = parseInt(gridId.charAt(1));
      
      // Вычисляем координаты центра сектора (для сетки 4x4)
      const letterIndex = letter.charCodeAt(0) - 'A'.charCodeAt(0);
      const x = (number - 1) * (gameParams.fieldWidth / 4) + (gameParams.fieldWidth / 8);
      const y = letterIndex * (gameParams.fieldHeight / 4) + (gameParams.fieldHeight / 8);
      
      // Отправляем запрос на телепортацию игрока
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: "teleport",
          x: x,
          y: y
        }));
      }
    });
  });
}

// Функция для запуска игрового цикла
function startGameLoop() {
  gameLoop();
}

// Основная функция обновления состояния игры
function update() {
  if (!playerId || !otherPlayers[playerId]) return;
  
  // Получаем нашего игрока из объекта игроков
  const me = otherPlayers[playerId];
  playerX = me.x;
  playerY = me.y;
  
  // Проверяем, что у нас есть необходимые параметры с сервера
  if (!gameParams.speedFactor) {
    console.error("speedFactor не получен с сервера");
    return;
  }
  
  // Рассчитываем направление движения
  let dx = mouseX - window.innerWidth / 2;
  let dy = mouseY - window.innerHeight / 2;
  let distance = Math.sqrt(dx * dx + dy * dy);

  if (distance > 1) {
    // Вычисляем скорость движения на основе параметров сервера
    let baseSpeedX = dx * gameParams.speedFactor;
    let baseSpeedY = dy * gameParams.speedFactor;
    
    // Находим текущую скорость движения
    let currentSpeed = Math.sqrt(baseSpeedX * baseSpeedX + baseSpeedY * baseSpeedY);
    
    // Отправляем новую позицию на сервер
    const newX = playerX + baseSpeedX;
    const newY = playerY + baseSpeedY;
    
    socket.send(JSON.stringify({
      type: "playerMove",
      x: newX,
      y: newY
    }));
  }
  
  // Обновляем камеру чтобы следовать за игроком
  updateCamera();
  
  // Обновляем активный сектор на мини-карте (без индикатора)
  updateMinimapPosition();
}

// Функция для обновления активного сектора на мини-карте
function updateMinimapPosition() {
  if (!gameParams.fieldWidth || !gameParams.fieldHeight) return;
  
  // Вычисляем относительное положение игрока на карте (0-1)
  const relX = playerX / gameParams.fieldWidth;
  const relY = playerY / gameParams.fieldHeight;
  
  // Определяем, в каком секторе находится игрок (для сетки 4x4)
  const gridSizeX = 4;
  const gridSizeY = 4;
  const gridX = Math.min(Math.floor(relX * gridSizeX), gridSizeX - 1);
  const gridY = Math.min(Math.floor(relY * gridSizeY), gridSizeY - 1);
  const letters = ["A", "B", "C", "D"];
  const newGrid = letters[gridY] + (gridX + 1);
  
  // Если игрок перешел в новый сектор, обновляем активный сектор
  if (newGrid !== currentGrid) {
    // Сбрасываем выделение предыдущего сектора
    if (currentGrid) {
      const prevButton = document.getElementById(`grid-${currentGrid}`);
      if (prevButton) {
        prevButton.classList.remove("active");
      }
    }
    
    // Выделяем новый сектор
    const newButton = document.getElementById(`grid-${newGrid}`);
    if (newButton) {
      newButton.classList.add("active");
    }
    
    currentGrid = newGrid;
  }
}

// Функция для обновления положения камеры
function updateCamera() {
  // Установка камеры в центр вокруг игрока
  viewportX = playerX - window.innerWidth / 2;
  viewportY = playerY - window.innerHeight / 2;
  
  // Обновляем положение игрового поля для создания эффекта камеры
  gameField.style.transform = `translate(${-viewportX}px, ${-viewportY}px)`;
}

// Функция для отрисовки игрока на экране
function render() {
  if (!playerId || !otherPlayers[playerId]) return;
  
  // Получаем размер игрока с сервера
  const playerSize = otherPlayers[playerId].size;
  
  // Игрок всегда в центре экрана
  player.style.width = playerSize + "px";
  player.style.height = playerSize + "px";
  player.style.left = (window.innerWidth / 2 - playerSize / 2) + "px";
  player.style.top = (window.innerHeight / 2 - playerSize / 2) + "px";
}

// Функция для обновления других игроков
function updateOtherPlayers(players) {
  // Удаляем игроков, которых больше нет
  for (const id in otherPlayers) {
    if (!players[id]) {
      if (id !== playerId) { // Не удаляем собственного игрока
        if (otherPlayers[id].element) {
          otherPlayers[id].element.remove();
        }
      }
      delete otherPlayers[id];
    }
  }
  
  // Обновляем/создаем других игроков
  for (const id in players) {
    const p = players[id];
    
    if (!otherPlayers[id]) {
      // Создаем нового игрока
      if (id !== playerId) { // Не создаем визуальный элемент для себя
        const elem = document.createElement('div');
        elem.className = 'other-player';
        elem.style.position = 'absolute';
        elem.style.borderRadius = '50%';
        elem.style.display = 'flex';
        elem.style.justifyContent = 'center';
        elem.style.alignItems = 'center';
        elem.style.backgroundColor = getRandomColor();
        elem.style.color = 'white';
        elem.style.fontSize = '14px';
        elem.style.fontWeight = 'bold';
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
        
        // Обновляем счет из данных с сервера
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
        if (elem) {
          elem.style.width = p.size + 'px';
          elem.style.height = p.size + 'px';
          elem.style.left = (p.x - p.size / 2) + 'px';
          elem.style.top = (p.y - p.size / 2) + 'px';
        }
      }
    }
  }
}

// Функция для обновления еды
function updateFood(serverFoods) {
  // Удаляем предыдущую еду, которая больше не видна
  const visibleFoodIds = new Set(serverFoods.map(f => f.id));
  
  foods = foods.filter(food => {
    if (!visibleFoodIds.has(food.id)) {
      if (food.element) {
        food.element.remove();
      }
      return false;
    }
    return true;
  });
  
  // Обработка новой еды
  serverFoods.forEach(foodData => {
    // Проверяем, есть ли уже такая еда в нашем массиве
    const existingFood = foods.find(f => f.id === foodData.id);
    
    if (existingFood) {
      // Обновляем позицию существующей еды, если нужно
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
      li.classList.add("current-player");
    }
    
    list.appendChild(li);
  });
}

// Функция для отображения экрана окончания игры
function showGameOver(finalScore) {
  const gameOverModal = document.getElementById("game-over");
  const finalScoreElement = document.querySelector(".final-score");
  
  finalScoreElement.textContent = `Ваш счёт: ${finalScore}`;
  gameOverModal.style.display = "flex";
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