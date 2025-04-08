const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let players = [];

app.use(express.static('public')); // Статика из public/

wss.on('connection', (ws) => {
  let player = { id: null, name: "", score: 0 };

  ws.on('message', (data) => {
    const msg = JSON.parse(data);

    if (msg.type === 'join') {
      player.id = Date.now() + Math.random();
      player.name = msg.name;
      player.score = 0;
      players.push(player);
      broadcastLeaderboard();
    }

    if (msg.type === 'score') {
      const p = players.find(p => p.name === msg.name);
      if (p) {
        p.score = msg.score;
        broadcastLeaderboard();
      }
    }
  });

  ws.on('close', () => {
    players = players.filter(p => p !== player);
    broadcastLeaderboard();
  });
});

function broadcastLeaderboard() {
  const leaderboard = players
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const message = JSON.stringify({
    type: 'leaderboard',
    data: leaderboard
  });

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

const PORT = 8080;
server.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`);
});
