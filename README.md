# 🥷 Shinobi Signs – Ultimate Edition

A gesture-controlled ninja fighting game where players use real-time hand-sign combinations to perform combat techniques.

## 🎮 About the Project

Shinobi Signs is an interactive browser-based fighting game that combines computer vision, hand tracking, multiplayer networking, and game development.

Instead of relying on traditional keyboard combat controls, players use webcam-recognized hand gestures and combinations to execute different fighting techniques.

The project explores gesture-based interaction by transforming real-world hand movements into in-game combat actions.

## ✨ Features

- Real-time webcam-based hand tracking
- Hand-sign and gesture recognition
- Combination-based combat system
- Signature attacks and ultimate techniques
- Defense and counter mechanics
- Two-player multiplayer functionality
- Character selection
- Interactive fighting arena
- Visual combat effects and sound effects
- Real-time player interaction

## 🤟 Hand Signs & Combinations

Shinobi Signs recognises **four hand signs** through your webcam. You chain them in order to attack or defend. There is no keyboard combat: everything is done with your hands.

### The four signs

- 🐍 **Snake:** all four fingers straight and held together, like a flat blade.
- 🐯 **Tiger:** index and middle fingers up and together; ring and pinky curled.
- 🐴 **Horse:** only the index finger up; all other fingers curled.
- 🐏 **Ram:** index and pinky up like horns; middle and ring fingers curled.

### Attack combos

Make the signs in order. Each sign must come within about 3.6 seconds of the previous one, or the sequence resets.

- **Echo Clone Technique** (25 damage): Snake → Tiger → Horse → Ram
- **Spiral Energy Orb** (30 damage): Tiger → Ram → Snake
- **Ancient Toad Guardian** (34 damage): Horse → Snake → Tiger

### Defense combos

- **Guard** (lasts 1.5 s): Ram → Tiger. Blocks 75% of the next attack.
- **Counter** (lasts 1.8 s): Tiger → Snake → Ram. Blocks the next attack and sends 40% of its damage back to the attacker.

Only one defense is active at a time.

### Game rules

- Each fighter starts with 100 HP.
- Hitting your opponent charges your chakra. A full chakra meter is needed for ultimate attacks.
- A match is best of three rounds. The first fighter to win two rounds wins.

### Online two-player play

1. Both players open the game and allow their webcam.
2. Player 1 creates a room and shares the six-character code.
3. Player 2 enters the code and joins.
4. Each player sees their own camera under **YOU** and the opponent's camera under **OPPONENT**.

### How recognition works

1. MediaPipe finds the hand landmarks in each webcam frame.
2. The game measures how curled each finger is and how far apart the fingers are.
3. The best matching sign is chosen if the game is confident enough.
4. The sign must stay steady for about 0.2 seconds to count.
5. Signs are collected in order and matched against the combos above.
6. A matched combo launches an attack or a defense.

Sign rules are in `src/input/gestureConfig.js`, attacks in `src/game/jutsuSystem.js`, and defenses in `src/game/combatActionRouter.js`.

## 🛠️ Tech Stack

| Technology | Purpose |
|---|---|
| HTML5 | Game structure |
| CSS3 | Styling and animations |
| JavaScript (ES6+) | Game logic |
| MediaPipe | Hand tracking |
| WebRTC | Peer-to-peer communication |
| Canvas API | Game rendering |
| Python | Local HTTP server |
| Git & GitHub | Version control |

## 🏗️ Project Structure

```text
shinobi-signs/
│
├── assets/
│   ├── arena-hyrule.jpg
│   ├── energy-orb.png
│   ├── fighter-crimson.png
│   ├── fighter-shadow.png
│   └── ...
│
├── css/
│   └── style.css
│
├── src/
│   ├── game/
│   ├── input/
│   ├── network/
│   ├── render/
│   ├── ui/
│   └── main.js
│
├── tests/
│
├── index.html
├── README.md
└── ...
```

## 🚀 Getting Started

Follow these steps to run Shinobi Signs locally.

### 1. Clone the Repository

```bash
git clone https://github.com/cs25bt024-7777/shinobi-signs-ultimate.git
```

### 2. Navigate to the Project Directory

```bash
cd shinobi-signs-ultimate
```

### 3. Start the Python HTTP Server

Make sure Python is installed on your system.

Run the following command:

```bash
python -m http.server 8000
```

### 4. Open the Game

Open your browser and visit:

```text
http://localhost:8000
```

### 5. Allow Webcam Access

- Grant camera permissions when prompted.
- Make sure your webcam is connected and working.
- Keep the Python server running while playing.

To stop the server, press `Ctrl + C` in the terminal.

## 🎯 Core Concepts

This project explores the combination of:

- Computer Vision
- Real-time Hand Tracking
- Gesture Recognition
- Combination-based Input Systems
- Interactive Game Development
- Multiplayer Networking
- Event-driven Architecture

## 🧪 Testing

The project includes automated tests covering different components of the game, including:

- Gesture recognition
- Hand tracking
- Combat engine
- Defense system
- Jutsu system
- Multiplayer functionality
- Sequence recognition

## 🔮 Future Improvements

- Additional playable characters
- More hand-sign combinations and fighting techniques
- Improved gesture recognition accuracy
- Enhanced multiplayer experience
- Additional arenas and visual effects
- Performance optimization
