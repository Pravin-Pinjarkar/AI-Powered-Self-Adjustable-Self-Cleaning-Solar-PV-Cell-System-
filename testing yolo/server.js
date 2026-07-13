const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

let SerialPort, ReadlineParser;
try {
  SerialPort = require("serialport").SerialPort;
  ReadlineParser = require("@serialport/parser-readline").ReadlineParser;
} catch (e) {
  console.warn("⚠️ serialport module not found. Install: npm install serialport");
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.static("."));
app.use(express.json());

// ==================== CONFIGURATION ====================
let serialPort = null;
let parser = null;
let isArduinoConnected = false;

// 🔧 CHANGE THIS TO YOUR ARDUINO COM PORT
const ARDUINO_CONFIG = {
  path: "COM5",  // ✅ Windows: COM3, COM4, COM5, etc. | Linux: /dev/ttyUSB0, /dev/ttyACM0
  baudRate: 9600,
  autoOpen: false
};

const AUTO_CONNECT_ARDUINO = true;  // ✅ Set to TRUE to auto-connect on startup

// ==================== SERIAL PORT CONNECTION ====================
function connectArduino() {
  if (!SerialPort) {
    console.log("❌ SerialPort module not available. Arduino connection disabled.");
    return;
  }

  try {
    console.log(`🔌 Connecting to Arduino on ${ARDUINO_CONFIG.path}...`);
    
    serialPort = new SerialPort(ARDUINO_CONFIG);
    parser = serialPort.pipe(new ReadlineParser({ delimiter: "\n" }));

    serialPort.open((err) => {
      if (err) {
        console.log(`❌ Failed to open ${ARDUINO_CONFIG.path}: ${err.message}`);
        isArduinoConnected = false;
        io.emit("arduino_status", { connected: false, error: err.message });
        setTimeout(connectArduino, 5000);  // Retry after 5 seconds
        return;
      }

      console.log(`✅ Arduino connected on ${ARDUINO_CONFIG.path}`);
      isArduinoConnected = true;
      io.emit("arduino_status", { connected: true });
    });

    // Parse incoming Arduino data
    parser.on("data", (line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("=")) return;  // Skip headers

      console.log(`[ARDUINO] ${trimmed}`);

      // Parse flexible LDR format
      let arduinoData = {
        rawData: trimmed,
        timestamp: new Date().toISOString()
      };

      // Match various LDR formats
      const ldr1Match = trimmed.match(/LDR1[:\s]+(\d+)/i);
      const ldr2Match = trimmed.match(/LDR2[:\s]+(\d+)/i);
      const diffMatch = trimmed.match(/[Dd]ifference[:\s]+([+-]?\d+)/i);
      const avgMatch = trimmed.match(/[Aa]verage[:\s]+(\d+)/i);
      const threshMatch = trimmed.match(/[Tt]hreshold[:\s]+±?(\d+)/i);

      if (ldr1Match) arduinoData.ldr1 = parseInt(ldr1Match[1]);
      if (ldr2Match) arduinoData.ldr2 = parseInt(ldr2Match[1]);
      if (diffMatch) arduinoData.difference = parseInt(diffMatch[1]);
      if (avgMatch) arduinoData.averageLight = parseInt(avgMatch[1]);
      if (threshMatch) arduinoData.threshold = parseInt(threshMatch[1]);

      // Detect motor movements
      if (trimmed.includes("CLOCKWISE") || trimmed.includes("COUNTER-CLOCKWISE")) {
        arduinoData.motorMoving = true;
        if (trimmed.includes("Y-axis")) arduinoData.motorAxis = "Y";
        if (trimmed.includes("Z-axis")) arduinoData.motorAxis = "Z";
        if (trimmed.includes("CLOCKWISE")) arduinoData.direction = "CLOCKWISE";
        if (trimmed.includes("COUNTER")) arduinoData.direction = "COUNTER_CLOCKWISE";
      }

      // Detect balance status
      if (trimmed.includes("BALANCED")) {
        arduinoData.balanceStatus = "BALANCED";
      } else if (trimmed.includes("BRIGHTER")) {
        arduinoData.balanceStatus = "ADJUSTING";
      } else if (trimmed.includes("LOCKED")) {
        arduinoData.balanceStatus = "LOCKED";
      } else if (trimmed.includes("STABLE")) {
        arduinoData.balanceStatus = "BALANCED";
      }

      // Emit only if we extracted useful data
      if (Object.keys(arduinoData).length > 2) {
        io.emit("arduino_data", arduinoData);
      }
    });

    serialPort.on("error", (err) => {
      console.log(`⚠️ Serial port error: ${err.message}`);
      isArduinoConnected = false;
      io.emit("arduino_status", { connected: false, error: err.message });
    });

    serialPort.on("close", () => {
      console.log("⚠️ Arduino serial port closed. Attempting reconnection...");
      isArduinoConnected = false;
      io.emit("arduino_status", { connected: false });
      setTimeout(connectArduino, 5000);
    });

  } catch (error) {
    console.log(`❌ Error setting up serial port: ${error.message}`);
    setTimeout(connectArduino, 5000);
  }
}

// ==================== SOCKET.IO HANDLING ====================
let connectedClients = new Map();

io.on("connection", (socket) => {
  connectedClients.set(socket.id, { connected_at: new Date() });
  console.log(`🔌 Browser connected: ${socket.id} (Total: ${connectedClients.size})`);

  // Send current status
  socket.emit("arduino_status", { connected: isArduinoConnected });

  socket.on("disconnect", () => {
    connectedClients.delete(socket.id);
    console.log(`🔌 Browser disconnected: ${socket.id} (Total: ${connectedClients.size})`);
  });

  // YOLO Frame data - broadcast to all
  socket.on("frame", (data) => {
    if (data && data.length > 1000) {  // Sanity check
      console.log(`📹 Frame received (${(data.length/1024).toFixed(1)}KB) → broadcasting to ${connectedClients.size} clients`);
      io.emit("frame", data);
    }
  });

  // YOLO Detection data - broadcast to all
  socket.on("detection", (data) => {
    if (data) {
      console.log(`🎯 Detection: Objects=${data.dirt_count}, Conf=${(data.confidence*100).toFixed(0)}%, Contamination=${data.contamination_level?.toFixed(1)}%`);
      io.emit("detection", data);
    }
  });

  // Handle commands (for future use)
  socket.on("command", (cmd) => {
    console.log(`📨 Command received: ${cmd}`);
    if (serialPort && serialPort.isOpen) {
      serialPort.write(cmd + "\n");
    }
  });
});

// ==================== REST ENDPOINTS ====================
app.get("/health", (req, res) => {
  res.json({
    status: "online",
    timestamp: new Date().toISOString(),
    connectedClients: connectedClients.size,
    arduinoConnected: isArduinoConnected,
    arduinoPort: ARDUINO_CONFIG.path
  });
});

app.get("/status", (req, res) => {
  res.json({
    yolo: true,
    arduino: isArduinoConnected,
    clients: connectedClients.size
  });
});

// ==================== START SERVER ====================
const PORT = 5000;

server.listen(PORT, () => {
  console.log("\n" + "=".repeat(60));
  console.log("🚀 SERVER RUNNING");
  console.log("=".repeat(60));
  console.log(`📍 URL: http://localhost:${PORT}`);
  console.log(`✅ CORS: Enabled`);
  console.log(`📡 WebSocket: Active`);
  console.log(`🔌 Arduino Config: ${ARDUINO_CONFIG.path} @ ${ARDUINO_CONFIG.baudRate} baud`);
  console.log(`⚙️ Auto-connect Arduino: ${AUTO_CONNECT_ARDUINO ? "YES" : "NO"}`);
  console.log("=".repeat(60) + "\n");

  // Auto-connect to Arduino if enabled
  if (AUTO_CONNECT_ARDUINO) {
    connectArduino();
  } else {
    console.log("⏭️ Arduino auto-connect disabled. To enable, set AUTO_CONNECT_ARDUINO = true in server.js\n");
  }
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down...");
  if (serialPort && serialPort.isOpen) {
    serialPort.close();
  }
  process.exit(0);
});