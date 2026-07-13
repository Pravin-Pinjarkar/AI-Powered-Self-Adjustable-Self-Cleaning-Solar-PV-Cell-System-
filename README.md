# AI-Powered Self-Adjustable & Self-Cleaning Solar PV Cell System

An intelligent solar energy optimization system that uses **Computer Vision** and **Artificial Intelligence** to maximize solar panel efficiency. The system automatically adjusts the panel orientation based on sunlight direction and detects dust or debris on the panel surface to initiate an automated cleaning process.

---

##  Project Overview

Traditional solar panels often suffer from reduced efficiency due to improper orientation and dust accumulation. This project addresses these challenges by integrating AI-based object detection and computer vision techniques to automate panel tracking and cleaning.

The system:
- Automatically detects the direction of maximum sunlight.
- Adjusts the solar panel angle for optimal energy generation.
- Detects dust, leaves, bird droppings, and other debris using YOLOv8.
- Triggers a cleaning mechanism when contaminants are detected.
- Improves overall solar panel performance while reducing manual maintenance.

---

## Features

- Automatic Solar Panel Angle Adjustment
- AI-Based Dust & Debris Detection
- Real-Time Object Detection using YOLOv8
- Automated Cleaning Mechanism
- Increased Solar Energy Efficiency
- Real-Time Monitoring
- Continuous Performance Optimization

---

## Tech Stack

- Python
- YOLOv8
- OpenCV
- Computer Vision
- IoT Sensors
- Embedded Systems

---

## Project Structure

```
AI_Project/
│
├── testing_yolo/
│   ├── images/
│   ├── models/
│   ├── script.py
│   ├── server.js
│   ├── style.css
│   ├── package.json
│   ├── test_yolo.py
│   ├── yolov3-tiny.weights
│   └── yolov8n.pt
│
└── README.md
```

---

## Working

1. Capture real-time images from the camera.
2. Process images using OpenCV.
3. Detect dust or debris using the YOLOv8 object detection model.
4. Analyze sunlight direction.
5. Automatically rotate the solar panel toward the optimal angle.
6. Activate the cleaning mechanism if dust or debris is detected.
7. Repeat the monitoring process continuously.

---

## Applications

- Smart Solar Farms
- Residential Solar Systems
- Commercial Solar Plants
- Industrial Renewable Energy Systems
- Remote Solar Installations

---

##  Future Enhancements

- IoT Dashboard for Remote Monitoring
- Mobile Application Integration
- Weather Forecast-Based Optimization
- Solar Power Generation Analytics
- Cloud-Based Data Storage
- Predictive Maintenance using AI

---

## Contributors

- **Pravin Pinjarkar**
- **Arnav Sowale**

---

## 📜 License

This project is developed for educational and research purposes.
