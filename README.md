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
