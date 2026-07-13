#!/usr/bin/env python3
"""
Solar Panel Cleaning - YOLO World Stream
Detects contamination & streams to Node.js backend
"""

import cv2
import base64
import socketio
import numpy as np
import time
import sys

try:
    import supervision as sv
    from inference.models.yolo_world.yolo_world import YOLOWorld
    YOLO_AVAILABLE = True
except ImportError:
    print("⚠️ YOLO World not installed")
    YOLO_AVAILABLE = False

# ==================== CONFIG ====================
SOCKET_SERVER = 'http://localhost:5000'
CAMERA_INDEX = 0
FRAME_WIDTH = 640
FRAME_HEIGHT = 480
FPS_TARGET = 30
CONFIDENCE_THRESHOLD = 0.5
JPEG_QUALITY = 90

# ==================== GLOBALS ====================
sio = socketio.Client(reconnection=True, reconnection_delay=1, reconnection_attempts=10)
model = None
frame_counter = 0
fps_timer = time.time()
current_fps = 0

# ==================== SOCKET EVENTS ====================
@sio.event
def connect():
    print("✅ Connected to Node.js server")

@sio.event
def disconnect():
    print("❌ Disconnected from Node.js server")

@sio.event
def connect_error(data):
    print(f"⚠️ Connection error: {data}")

# ==================== FUNCTIONS ====================
def connect_server():
    print(f"🔌 Connecting to {SOCKET_SERVER}...")
    try:
        sio.connect(SOCKET_SERVER, wait_timeout=10, transports=['websocket', 'polling'])
        return True
    except Exception as e:
        print(f"❌ Connection failed: {e}")
        return False

def load_model():
    global model
    if not YOLO_AVAILABLE:
        print("⚠️ YOLO not available - running in camera-only mode")
        return False

    try:
        print("🔄 Loading YOLO World model (this may take 1-2 minutes)...")
        model = YOLOWorld(model_id="yolo_world/l")

        classes = [
            "hand", "face", "phone",
            "dust", "debris", "dirt", "snow",
            "bird dropping", "water droplet",
            "algae", "leaves", "sand", "person"
        ]
        model.set_classes(classes)
        print(f"✅ YOLO Model loaded - Tracking {len(classes)} classes")
        return True
    except Exception as e:
        print(f"❌ Model failed: {e}")
        return False

def detect(frame):
    """Run YOLO detection + draw class & confidence"""
    if model is None:
        return frame, 0, 0, 0, []

    try:
        results = model.infer(frame, confidence=CONFIDENCE_THRESHOLD)
        detections = sv.Detections.from_inference(results)

        count = len(detections)
        confidence = float(np.max(detections.confidence)) if len(detections.confidence) > 0 else 0

        # Draw bounding box with class names + confidence
        for i, box in enumerate(detections.xyxy):
            x1, y1, x2, y2 = map(int, box)
            class_name = detections.data['class_name'][i]
            conf = detections.confidence[i]
            label = f"{class_name} {conf:.2f}"

            cv2.rectangle(frame, (x1, y1), (x2, y2), (255, 255, 0), 2)
            cv2.putText(frame, label, (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX,
                        0.6, (0, 255, 0), 2)

        contamination = min(100, count * 15)
        return frame, count, confidence, contamination, []

    except Exception as e:
        print(f"❌ Detection error: {e}")
        return frame, 0, 0, 0, []

def draw_info(frame, count, confidence, contamination, fps_val):
    cv2.rectangle(frame, (10, 10), (420, 120), (0, 0, 0), -1)
    cv2.rectangle(frame, (10, 10), (420, 120), (0, 255, 0), 2)
    cv2.putText(frame, f"Detections: {count}", (20, 35),
                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
    cv2.putText(frame, f"Contamination: {contamination:.1f}%", (20, 60),
                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
    cv2.putText(frame, f"Confidence: {confidence*100:.0f}% | FPS: {fps_val}", (20, 85),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (150, 150, 150), 1)
    return frame

def send_frame_and_detection(frame, count, confidence, contamination):
    try:
        _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
        b64 = base64.b64encode(buffer).decode('utf-8')

        if sio.connected:
            sio.emit('frame', b64)
            data = {
                'dirt_count': count,
                'confidence': float(confidence),
                'contamination_level': float(contamination),
                'classes_detected': []
            }
            sio.emit('detection', data)
            return True
    except Exception as e:
        print(f"❌ Send error: {e}")
    return False

# ==================== MAIN ====================
def main():
    global frame_counter, fps_timer, current_fps
    print("\n" + "="*60)
    print("SOLAR PANEL CLEANING - YOLO DETECTOR")
    print("="*60)

    if not connect_server():
        print("❌ Cannot reach Node.js server at", SOCKET_SERVER)
        print("💡 Make sure Node.js is running: node server.js")
        return

    time.sleep(1)
    load_model()

    print("\n🎥 Initializing camera...")
    cap = cv2.VideoCapture(CAMERA_INDEX)

    if not cap.isOpened():
        print("❌ Cannot open camera")
        return

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, FRAME_WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, FRAME_HEIGHT)
    cap.set(cv2.CAP_PROP_FPS, FPS_TARGET)

    print(f"✅ Camera: {FRAME_WIDTH}x{FRAME_HEIGHT} @ {FPS_TARGET}fps")
    print("📡 Streaming to http://localhost:5000\n")
    print("="*60)

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                print("❌ Failed to read frame")
                break

            frame_counter += 1
            frame, count, confidence, contamination = detect(frame)[:4]
            frame = draw_info(frame, count, confidence, contamination, current_fps)
            send_frame_and_detection(frame, count, confidence, contamination)

            now = time.time()
            if now - fps_timer >= 1.0:
                current_fps = frame_counter
                frame_counter = 0
                fps_timer = now
                print(f"📊 FPS: {current_fps} | Objects: {count} | Contamination: {contamination:.1f}%")
            time.sleep(0.001)

    except KeyboardInterrupt:
        print("\n✅ Stopping...")
    finally:
        cap.release()
        if sio.connected:
            sio.disconnect()
        print("✅ Done")

if __name__ == "__main__":
    main()
