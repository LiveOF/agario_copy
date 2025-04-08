// game.js
let player = document.querySelector("#player");
let playerX = 500;
let playerY = 500;
let playerSize = 48;
let speedFactor = 0.02; // меньше = медленнее
let mouseX = 0;
let mouseY = 0;
let score = 0;
let socket;
let playerName = "";

window.addEventListener("mousemove", (event) => {
  mouseX = event.clientX;
  mouseY = event.clientY;
});

function startGame() {
  const input = document.getElementById("username");
  playerName = input.value.trim();
  if (!playerName) return alert("Введите имя!");

  document.getElementById("menu").style.display = "none";
  document.getElementById("score").style.display = "block";

  socket = new WebSocket("ws://" + window.location.host);

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ type: "join", name: playerName }));
  });

  socket.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "leaderboard") {
      updateLeaderboard(msg.data);
    }
  });

  spawnFood();
  gameLoop();
}

function update() {
  let dx = mouseX - playerX;
  let dy = mouseY - playerY;
  let distance = Math.sqrt(dx * dx + dy * dy);

  if (distance > 1) {
    playerX += dx * speedFactor;
    playerY += dy * speedFactor;
  }

  const foods = document.querySelectorAll(".food");
  foods.forEach(food => {
    const rect = food.getBoundingClientRect();
    const foodX = rect.left + rect.width / 2;
    const foodY = rect.top + rect.height / 2;
    const distance = Math.sqrt((playerX - foodX) ** 2 + (playerY - foodY) ** 2);

    if (distance < playerSize / 2 + parseInt(food.dataset.size) / 2) {
      food.remove();
      playerSize += 1;
      player.style.width = playerSize + "px";
      player.style.height = playerSize + "px";
      score++;
      document.getElementById("score").innerText = `Счёт: ${score}`;

      socket?.send(JSON.stringify({ type: "score", name: playerName, score }));
    }
  });
}

function render() {
  player.style.left = playerX + "px";
  player.style.top = playerY + "px";
}

function distanceBetween(x1, y1, x2, y2) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

function getRandomNumber(min, max) {
  return Math.random() * (max - min) + min;
}

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min) + min);
}

function getRandomElement(array) {
  return array[Math.floor(Math.random() * array.length)];
}

const colors = ["#FFB3BA", "#FFDFBA", "#FFFFBA", "#BAFFC9", "#BAE1FF", "#FFC6FF"];

function createFood(x, y) {
  const food = document.createElement("div");
  const size = getRandomInt(24, 36);
  food.className = "food";
  food.dataset.size = size;
  food.style.width = size + "px";
  food.style.height = size + "px";
  food.style.left = x + "px";
  food.style.top = y + "px";
  food.style.backgroundColor = getRandomElement(["#FFB3BA","#FFDFBA","#FFFFBA","#BAFFC9","#BAE1FF","#FFC6FF"]);
  document.body.appendChild(food);
}

function spawnFood() {
  for (let i = 0; i < 100; i++) {
    createFood(getRandomNumber(0, window.innerWidth), getRandomNumber(0, window.innerHeight));
  }
}

function updateLeaderboard(data) {
  const list = document.getElementById("leaders");
  list.innerHTML = "";
  data.forEach(p => {
    const li = document.createElement("li");
    li.textContent = `${p.name}: ${p.score}`;
    list.appendChild(li);
  });
}

let fps = 60;
let start = Date.now();
let frameDuration = 1000 / fps;
let lag = 0;

function gameLoop() {
  requestAnimationFrame(gameLoop);

  const current = Date.now();
  const elapsed = current - start;
  start = current;
  lag += elapsed;

  while (lag >= frameDuration) {
    update();
    lag -= frameDuration;
  }

  render();
}
