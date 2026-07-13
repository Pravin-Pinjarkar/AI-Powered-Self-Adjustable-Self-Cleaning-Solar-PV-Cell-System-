/* ==================== GLOBAL STATE ==================== */
let socket = null;
let state = {
  backendConnected: false,
  yoloConnected: false,
  arduinoConnected: false,
  frameCount: 0,
  totalFrames: 0,
  fps: 0,
  dirtCount: 0,
  confidence: 0,
  contamination: 0,
  cleanCycles: 0,
  autoMode: false,
  isCleaning: false,
  startTime: Date.now(),
  contaminationHistory: [],
  detectionHistory: [],
  classesDetected: [],
  ldr1: 0,
  ldr2: 0,
  hasReceivedData: false
};

let charts = { history: null, distribution: null };
let lastFrameTime = Date.now();
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// ==================== DEBUG LOGGER ==================== 
function log(title, message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const color = type === 'error' ? 'color:red' : type === 'success' ? 'color:green' : 'color:cyan';
  console.log(
    `%c[${timestamp}] ${title}`,
    color + ';font-weight:bold;',
    message
  );
}

// ==================== SOCKET.IO CONNECTION ==================== 
function connectSocket() {
  if (typeof io === 'undefined') {
    log('SOCKET.IO', 'Library not loaded yet, retrying in 500ms', 'error');
    setTimeout(connectSocket, 500);
    return;
  }

  log('SOCKET.IO', 'Attempting to connect to http://localhost:5000', 'info');
  
  socket = io('http://localhost:5000', {
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 10,
    transports: ['websocket', 'polling']
  });

  // ==================== SOCKET EVENTS ==================== 
  
  socket.on('connect', () => {
    reconnectAttempts = 0;
    log('✅ BACKEND', 'Connected to server with ID: ' + socket.id, 'success');
    state.backendConnected = true;
    updateBackendStatus(true);
    addTimeline('✅ Backend Server Connected');
  });

  socket.on('disconnect', () => {
    log('❌ BACKEND', 'Disconnected from server', 'error');
    state.backendConnected = false;
    state.yoloConnected = false;
    state.arduinoConnected = false;
    updateBackendStatus(false);
    updateYOLOStatus(false);
    updateArduinoStatus(false);
    addTimeline('❌ Backend Server Disconnected');
  });

  socket.on('connect_error', (error) => {
    reconnectAttempts++;
    log('⚠️ CONNECTION ERROR', `Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}: ${error.message}`, 'error');
    
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      log('🔴 FATAL', 'Failed to connect after ' + MAX_RECONNECT_ATTEMPTS + ' attempts', 'error');
      addTimeline('⚠️ Connection failed - Check if backend is running on port 5000');
    }
  });

  // Arduino Status Event
  socket.on('arduino_status', (data) => {
    log('📡 ARDUINO STATUS', `Connected: ${data.connected}${data.error ? ' | Error: ' + data.error : ''}`, 'info');
    updateArduinoStatus(data.connected);
    if (!data.connected && data.error) {
      addTimeline('⚠️ Arduino Error: ' + data.error);
    } else if (data.connected) {
      addTimeline('✅ Arduino Connected');
    }
  });

  // Arduino Data Event - MAIN DATA RECEPTION
  socket.on('arduino_data', (data) => {
    log('📊 ARDUINO DATA', JSON.stringify(data).substring(0, 100), 'info');
    processArduinoData(data);
  });

  // Video Frame Event - LIVE FEED
  socket.on('frame', (frameData) => {
    try {
      let b64data = frameData;
      
      // Handle different data formats
      if (typeof frameData === 'object') {
        b64data = frameData.frame || frameData.data || frameData;
      }
      
      // Ensure proper base64 prefix
      if (typeof b64data === 'string' && !b64data.startsWith('data:image')) {
        b64data = 'data:image/jpeg;base64,' + b64data;
      }

      const canvas = document.getElementById('videoFeed');
      const ctx = canvas.getContext('2d');
      const img = new Image();

      img.onload = () => {
        // Set canvas to match image dimensions
        if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
        }
        
        // Clear and draw
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        
        // Mark YOLO as connected and update video status
        if (!state.yoloConnected) {
          state.yoloConnected = true;
          updateYOLOStatus(true);
          addTimeline('✅ YOLO Engine Connected - Feed Streaming');
        }
        
        updateVideoStatus(true);
        updateFPS();
        state.frameCount++;
      };

      img.onerror = () => {
        log('❌ FRAME ERROR', 'Failed to load frame image', 'error');
      };

      img.src = b64data;
      
    } catch (e) {
      log('❌ FRAME EXCEPTION', e.message, 'error');
    }
  });

  // Detection Event - YOLO DETECTION DATA
  socket.on('detection', (data) => {
    log('🎯 DETECTION', `Objects: ${data.dirt_count}, Confidence: ${(data.confidence*100).toFixed(0)}%, Contamination: ${data.contamination_level?.toFixed(1)}%`, 'info');
    processDetection(data);
  });

  // Connection Error Handlers
  socket.on('error', (error) => {
    log('❌ SOCKET ERROR', error, 'error');
  });

  socket.on('reconnect', (attemptNum) => {
    log('🔄 RECONNECTING', 'Attempt ' + attemptNum, 'info');
  });

  socket.on('reconnect_failed', () => {
    log('❌ RECONNECT FAILED', 'Unable to reconnect to backend', 'error');
  });
}

// ==================== ARDUINO DATA PROCESSING ==================== 
function processArduinoData(data) {
  // Update LDR1
  if (data.ldr1 !== undefined) {
    state.ldr1 = data.ldr1;
    document.getElementById('ldr1Value').textContent = data.ldr1;
    updateLDRDisplay('ldr1', data.ldr1);
  }

  // Update LDR2
  if (data.ldr2 !== undefined) {
    state.ldr2 = data.ldr2;
    document.getElementById('ldr2Value').textContent = data.ldr2;
    updateLDRDisplay('ldr2', data.ldr2);
  }

  // Update average light level
  if (data.averageLight !== undefined) {
    document.getElementById('avgLight').textContent = data.averageLight;
  }

  // Update difference
  if (data.difference !== undefined) {
    const diffVal = data.difference;
    const diffStr = diffVal > 0 ? '+' + diffVal : diffVal;
    document.getElementById('difference').textContent = diffStr;
  }

  // Update balance status with visual feedback
  if (data.balanceStatus) {
    const statusEl = document.getElementById('balanceStatus');
    let statusText = '';
    let statusColor = '#00ff88';

    if (data.balanceStatus === 'BALANCED') {
      statusText = '✓ Balanced - Locked on brightest light';
      statusColor = '#00ff88';
    } else if (data.balanceStatus === 'ADJUSTING') {
      statusText = '⚡ Adjusting - Tracking light source';
      statusColor = '#ffaa00';
    } else if (data.balanceStatus === 'LOCKED') {
      statusText = '🎯 Locked - Optimal position';
      statusColor = '#00ff88';
    } else if (data.balanceStatus === 'STABLE') {
      statusText = '✓ Stable - Panel aligned';
      statusColor = '#00ff88';
    }

    statusEl.textContent = statusText;
    statusEl.style.color = statusColor;
  }

  // Detect motor activity
  if (data.motorMoving) {
    const brushMotor = document.getElementById('brushMotor');
    brushMotor.classList.add('active');
    setTimeout(() => brushMotor.classList.remove('active'), 1000);

    let direction = '';
    if (data.rawData.includes('CLOCKWISE')) direction = 'Clockwise';
    else if (data.rawData.includes('COUNTER')) direction = 'Counter-Clockwise';

    document.getElementById('brushDir').textContent = direction;
    document.getElementById('brushStatus').textContent = 'Moving';

    let axis = '';
    if (data.motorAxis === 'Y') axis = 'Y-Axis (Horizontal)';
    else if (data.motorAxis === 'Z') axis = 'Z-Axis (Vertical)';

    if (axis) {
      addTimeline(`⚙️ Motor: ${axis} - ${direction}`);
    }
  }
}

// Update LDR display with brightness interpretation
function updateLDRDisplay(sensor, value) {
  // LDR behavior: HIGH (>1000) = dark, LOW (<200) = bright
  let brightness = 'Dark';
  let color = '#ff4444';

  if (value > 1000) {
    brightness = 'Very Dark';
    color = '#ff4444';
  } else if (value > 800) {
    brightness = 'Low Light';
    color = '#ffaa00';
  } else if (value > 500) {
    brightness = 'Medium';
    color = '#ffeb3b';
  } else if (value < 200) {
    brightness = 'Very Bright';
    color = '#00ff88';
  } else {
    brightness = 'Bright';
    color = '#4ecdc4';
  }

  const deltaEl = document.getElementById(sensor + 'Delta');
  deltaEl.style.color = color;
  deltaEl.textContent = `(${brightness})`;
}

// ==================== DETECTION PROCESSING ==================== 
function processDetection(data) {
  const { dirt_count, confidence, contamination_level, classes_detected } = data;

  state.dirtCount = dirt_count || 0;
  state.confidence = (confidence * 100).toFixed(1) || 0;
  state.contamination = contamination_level || 0;
  state.totalFrames++;
  state.classesDetected = classes_detected || [];
  state.frameCount++;

  // Update detection display
  document.getElementById('dirtCount').textContent = state.dirtCount;
  document.getElementById('confidence').textContent = state.confidence + '%';
  document.getElementById('contaminationPercent').textContent = state.contamination.toFixed(1) + '%';
  document.getElementById('cleanlinessPercent').textContent = (100 - state.contamination).toFixed(1) + '%';
  document.getElementById('totalFrames').textContent = state.totalFrames;

  // Update progress bars
  document.getElementById('detectionBar').style.width = Math.min(state.dirtCount * 15, 100) + '%';
  document.getElementById('confidenceBar').style.width = state.confidence + '%';
  document.getElementById('contaminationBar').style.width = state.contamination + '%';

  // Color coding for contamination level
  const detectionBox = document.getElementById('detectionBox');
  const contaminationBox = document.getElementById('contaminationBox');
  
  if (state.contamination > 50) {
    detectionBox.classList.add('critical');
    contaminationBox.classList.add('critical');
  } else {
    detectionBox.classList.remove('critical');
    contaminationBox.classList.remove('critical');
  }

  // Update detected objects list
  updateDetectedObjects();

  // Store in history for charts
  state.contaminationHistory.push(state.contamination);
  state.detectionHistory.push(state.dirtCount);
  
  // Keep history to last 50 readings
  if (state.contaminationHistory.length > 50) {
    state.contaminationHistory.shift();
    state.detectionHistory.shift();
  }

  // Update charts
  if (charts.history) updateHistoryChart();
  if (charts.distribution) updateDistributionChart();
}

// Update detected objects display
function updateDetectedObjects() {
  const container = document.getElementById('objectsList');
  if (state.classesDetected.length === 0) {
    container.innerHTML = '<span style="color: #888;">No detections</span>';
    return;
  }

  // Remove duplicates and display
  const unique = [...new Set(state.classesDetected)];
  container.innerHTML = unique.map(obj => `<span class="object-tag">${obj}</span>`).join('');
}

// ==================== STATUS UPDATE FUNCTIONS ==================== 

function updateBackendStatus(connected) {
  const card = document.getElementById('backendStatusCard');
  const text = document.getElementById('backendStatusText');
  const dot = card.querySelector('.status-dot');

  if (connected) {
    card.style.borderColor = '#00ff88';
    card.classList.remove('disconnected');
    text.textContent = 'Connected';
    dot.classList.add('online');
    dot.classList.remove('offline');
  } else {
    card.classList.add('disconnected');
    card.style.borderColor = '#ff4444';
    text.textContent = 'Connecting...';
    dot.classList.add('offline');
    dot.classList.remove('online');
  }
}

function updateYOLOStatus(connected) {
  state.yoloConnected = connected;
  const card = document.getElementById('yoloStatusCard');
  const text = document.getElementById('yoloStatusText');
  const dot = card.querySelector('.status-dot');

  if (connected) {
    card.style.borderColor = '#00ff88';
    card.classList.remove('disconnected');
    text.textContent = 'Connected';
    dot.classList.add('online');
    dot.classList.remove('offline');
  } else {
    card.classList.add('disconnected');
    card.style.borderColor = '#ff4444';
    text.textContent = 'Offline';
    dot.classList.add('offline');
    dot.classList.remove('online');
  }
}

function updateArduinoStatus(connected) {
  state.arduinoConnected = connected;
  const card = document.getElementById('arduinoStatusCard');
  const text = document.getElementById('arduinoStatusText');
  const dot = card.querySelector('.status-dot');

  if (connected) {
    card.style.borderColor = '#00ff88';
    card.classList.remove('disconnected');
    text.textContent = 'Connected';
    dot.classList.add('online');
    dot.classList.remove('offline');
  } else {
    card.classList.add('disconnected');
    card.style.borderColor = '#ff4444';
    text.textContent = 'Disconnected';
    dot.classList.add('offline');
    dot.classList.remove('online');
  }
}

function updateVideoStatus(streaming) {
  const status = document.getElementById('videoStatus');
  if (streaming) {
    status.className = 'video-overlay streaming';
    status.textContent = '🟢 Streaming';
  } else {
    status.className = 'video-overlay offline';
    status.textContent = '🔴 No Feed';
  }
}

function updateFPS() {
  const now = Date.now();
  const delta = now - lastFrameTime;
  if (delta > 0) {
    state.fps = Math.round(1000 / delta);
  }
  lastFrameTime = now;
  document.getElementById('currentFPS').textContent = state.fps;
  document.getElementById('frameCounter').textContent = `Frame: ${state.totalFrames} | FPS: ${state.fps}`;
}

function updateUptime() {
  const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;
  const uptimeStr = `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  document.getElementById('uptimeDisplay').textContent = uptimeStr;
}

// ==================== CHART INITIALIZATION ==================== 

function initCharts() {
  // Contamination History Chart
  const histCtx = document.getElementById('historyChart').getContext('2d');
  charts.history = new Chart(histCtx, {
    type: 'line',
    data: {
      labels: Array(50).fill(0).map((_, i) => i),
      datasets: [{
        label: 'Contamination %',
        data: state.contaminationHistory,
        borderColor: '#ff6b6b',
        backgroundColor: 'rgba(255, 107, 107, 0.1)',
        tension: 0.4,
        borderWidth: 3,
        fill: true,
        pointRadius: 0,
        pointHoverRadius: 5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          min: 0,
          max: 100,
          ticks: { color: '#888' },
          grid: { color: 'rgba(255, 255, 255, 0.05)' }
        },
        x: {
          ticks: { color: '#888' },
          grid: { color: 'rgba(255, 255, 255, 0.05)' }
        }
      }
    }
  });

  // Detection Distribution Chart
  const distCtx = document.getElementById('distributionChart').getContext('2d');
  charts.distribution = new Chart(distCtx, {
    type: 'doughnut',
    data: {
      labels: ['Clean', 'Contaminated'],
      datasets: [{
        data: [100, 0],
        backgroundColor: ['#00ff88', '#ff6b6b'],
        borderColor: '#0a0e27',
        borderWidth: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#e0e0e0', font: { size: 12 } }
        }
      }
    }
  });

  log('📊 CHARTS', 'Initialized history and distribution charts', 'success');
}

function updateHistoryChart() {
  if (!charts.history) return;
  charts.history.data.datasets[0].data = state.contaminationHistory;
  charts.history.update('none');
}

function updateDistributionChart() {
  if (!charts.distribution) return;
  const clean = 100 - state.contamination;
  charts.distribution.data.datasets[0].data = [clean, state.contamination];
  charts.distribution.update('none');
}

// ==================== CONTROL FUNCTIONS ==================== 

function triggerClean() {
  if (state.isCleaning) {
    alert('Cleaning already in progress');
    return;
  }
  state.isCleaning = true;
  state.cleanCycles++;
  document.getElementById('cleanCycles').textContent = state.cleanCycles;
  addTimeline('🧹 Cleaning cycle started (#' + state.cleanCycles + ')');
  log('🧹 CLEANING', 'Cleaning cycle #' + state.cleanCycles + ' started', 'success');
}

function stopClean() {
  if (!state.isCleaning) {
    alert('No cleaning in progress');
    return;
  }
  state.isCleaning = false;
  addTimeline('⏹ Cleaning cycle stopped');
  log('⏹ CLEANING', 'Cleaning cycle stopped', 'info');
}

function toggleAutoMode() {
  state.autoMode = !state.autoMode;
  const mode = state.autoMode ? 'ENABLED' : 'DISABLED';
  addTimeline('🔄 Auto-Clean Mode: ' + mode);
  log('🔄 AUTO MODE', mode, 'info');
}

// ==================== TIMELINE MANAGEMENT ==================== 

function addTimeline(message) {
  const timeline = document.getElementById('timeline');
  const item = document.createElement('div');
  item.className = 'timeline-item';
  
  const now = new Date();
  const timeStr = now.toLocaleTimeString();
  
  item.innerHTML = `
    <div class="timeline-dot"></div>
    <div class="timeline-content">
      <div class="timeline-time">${timeStr}</div>
      <div class="timeline-text">${message}</div>
    </div>
  `;
  
  timeline.insertBefore(item, timeline.firstChild);
  
  // Keep only last 15 items
  const items = timeline.querySelectorAll('.timeline-item');
  if (items.length > 15) {
    items[items.length - 1].remove();
  }
}

// ==================== DATA EXPORT ==================== 

function exportData() {
  const report = {
    timestamp: new Date().toISOString(),
    uptime: document.getElementById('uptimeDisplay').textContent,
    totalFrames: state.totalFrames,
    cleaningCycles: state.cleanCycles,
    avgContamination: (state.contaminationHistory.reduce((a, b) => a + b, 0) / state.contaminationHistory.length || 0).toFixed(2),
    contaminationHistory: state.contaminationHistory,
    detectionHistory: state.detectionHistory,
    connectionStatus: {
      backend: state.backendConnected,
      yolo: state.yoloConnected,
      arduino: state.arduinoConnected
    }
  };
  
  const blob = new Blob([JSON.stringify(report, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `solar-report-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  addTimeline('💾 Report exported');
  log('💾 EXPORT', 'Report exported successfully', 'success');
}

function clearData() {
  if (confirm('Clear all data? This cannot be undone!')) {
    state.contaminationHistory = [];
    state.detectionHistory = [];
    state.totalFrames = 0;
    state.frameCount = 0;
    state.startTime = Date.now();
    state.classesDetected = [];
    state.cleanCycles = 0;
    
    document.getElementById('totalFrames').textContent = '0';
    document.getElementById('cleanCycles').textContent = '0';
    document.getElementById('uptimeDisplay').textContent = '0:00:00';
    
    if (charts.history) updateHistoryChart();
    if (charts.distribution) updateDistributionChart();
    
    addTimeline('🗑️ All data cleared');
    log('🗑️ CLEAR', 'All data cleared', 'info');
  }
}

// ==================== INITIALIZATION ==================== 

window.addEventListener('load', () => {
  log('🚀 SYSTEM', 'Dashboard loading...', 'info');
  
  // Initialize charts
  initCharts();
  
  // Initialize socket connection
  connectSocket();
  
  // Verify connection after a short delay
  setTimeout(() => {
    if (socket?.connected) {
      log('✅ SOCKET', 'WebSocket connected and ready', 'success');
      addTimeline('✓ WebSocket Connected - Ready to receive data');
    } else {
      log('⚠️ SOCKET', 'WebSocket not connected - Attempting to reconnect', 'error');
      addTimeline('⚠️ Connecting to backend server...');
    }
  }, 2000);
  
  // Update uptime every second
  setInterval(updateUptime, 1000);

  // Show initial status
  updateBackendStatus(false);
  log('🚀 SYSTEM', 'Dashboard initialized - Waiting for backend connection', 'info');
  addTimeline('🚀 System initialized - Connecting to server...');
});