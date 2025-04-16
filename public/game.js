let player = document.querySelector("#player");
let playerSize = 48;
let speedFactor = 0.02;
let mouseX = 0;
let mouseY = 0;
let score = 0;
let socket;
let playerName = "";
let playerId = null;
let gameParams = {};
let otherPlayers = {}; // Хранит информацию о других игроках
let foods = []; // Хранит информацию о всей еде
let viewportX = 0;
let viewportY = 0;
let cameraX = window.innerWidth / 2;
let cameraY = window.innerHeight / 2;
let playerX = cameraX;
let playerY = cameraY;

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

// Функция для старта игры
async function startGame() {
  const input = document.getElementById("username");
  playerName = input.value.trim();
  if (!playerName) return alert("Введите имя!");

  document.getElementById("menu").style.display = "none";
  document.getElementById("score").style.display = "block";
  document.getElementById("leaderboard").style.display = "block";

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
        speedFactor = gameParams.speedFactor;
        playerSize = gameParams.initialPlayerSize;
        player.style.width = playerSize + "px";
        player.style.height = playerSize + "px";
        playerId = msg.playerId; // Сохраняем ID игрока
        
        // Устанавливаем размеры игрового поля на основе данных с сервера
        gameField.style.width = gameParams.fieldWidth + "px";
        gameField.style.height = gameParams.fieldHeight + "px";
        gameField.style.border = "2px solid #ccc";
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
          alert(`Игра окончена! Ваш счет: ${score}`);
          window.location.reload(); // Перезагружаем страницу после смерти
        }
        break;
    }
  });

  socket.addEventListener("close", () => {
    alert("Соединение с сервером потеряно!");
    window.location.reload();
  });
}

// Функция для запуска игрового цикла
function startGameLoop() {
  gameLoop();
}

let minSpeed = 0.5;
let maxSpeed = 5;

// Основная функция обновления состояния игры
function update() {
  if (!playerId || !otherPlayers[playerId]) return;
  
  // Получаем нашего игрока из объекта игроков
  const me = otherPlayers[playerId];
  playerX = me.x;
  playerY = me.y;
  playerSize = me.size;
  
  // Обновляем размер визуального представления игрока
  player.style.width = playerSize + "px";
  player.style.height = playerSize + "px";
  
  // Рассчитываем направление движения
  let dx = mouseX - window.innerWidth / 2;
  let dy = mouseY - window.innerHeight / 2;
  let distance = Math.sqrt(dx * dx + dy * dy);

  if (distance > 1) {
    // Вычисляем базовую скорость
    let baseSpeedX = dx * speedFactor;
    let baseSpeedY = dy * speedFactor;
    
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
  // Игрок всегда в центре экрана
  player.style.left = (window.innerWidth / 2 - playerSize / 2) + "px";
  player.style.top = (window.innerHeight / 2 - playerSize / 2) + "px";
}

// Функция для обновления других игроков
function updateOtherPlayers(players) {
  // Удаляем игроков, которых больше нет
  for (const id in otherPlayers) {
    if (!players[id]) {
      if (id !== playerId) { // Не удаляем собственного игрока
        otherPlayers[id].element.remove();
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
        
        // Обновляем счет
        score = p.score;
        document.getElementById("score").innerText = `Счёт: ${score}`;
      }
    } else {
      // Обновляем данные игрока
      otherPlayers[id].x = p.x;
      otherPlayers[id].y = p.y;
      otherPlayers[id].size = p.size;
      otherPlayers[id].score = p.score;
      
      // Если это наш игрок, обновляем счет
      if (id === playerId) {
        score = p.score;
        document.getElementById("score").innerText = `Счёт: ${score}`;
      } else {
        // Для других игроков обновляем их положение на поле
        const elem = otherPlayers[id].element;
        elem.style.width = p.size + 'px';
        elem.style.height = p.size + 'px';
        elem.style.left = (p.x - p.size / 2) + 'px';
        elem.style.top = (p.y - p.size / 2) + 'px';
      }
    }
  }
}

// Функция для обновления еды
function updateFood(serverFoods) {
  // Очищаем предыдущие элементы еды
  foods.forEach(food => {
    if (food.element) {
      food.element.remove();
    }
  });
  foods = [];
  
  // Добавляем новую еду с сервера
  serverFoods.forEach(foodData => {
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
      li.style.fontWeight = "bold";
      li.style.color = "#FF5733";
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