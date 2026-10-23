#!/usr/bin/env python3
"""
EVE-Alert style detector for MIL Local Monitor.
Uses mss for region capture and OpenCV for template matching.
Communicates via JSON lines on stdin/stdout.
"""

import sys
import json
import base64

import numpy as np
import cv2
import mss

# Protocol:
# stdin:  {"cmd": "load_templates", "templates": [{"name": "...", "data": "base64", "scale": 200}, ...], "threshold": 0.6}
# stdin:  {"cmd": "detect", "region": {"x": 0, "y": 0, "width": 100, "height": 100}}
# stdout: {"status": "ok", "templates_loaded": 5}
# stdout: {"status": "ok", "matches": [{"name": "...", "score": 0.95, "x": 10, "y": 20, "w": 30, "h": 30}, ...]}

class Template:
    def __init__(self, name, img_data, width, height):
        self.name = name
        self.img = img_data
        self.width = width
        self.height = height
        # Precompute for TM_CCOEFF_NORMED
        self.mean, self.std = cv2.meanStdDev(img_data)
        self.mean = float(np.asarray(self.mean).reshape(-1)[0])
        self.std = float(np.asarray(self.std).reshape(-1)[0])

class Detector:
    def __init__(self):
        self.templates = []
        self.threshold = 0.6
        self.sct = None

    def load_templates(self, templates_data, threshold, target_scale):
        self.templates = []
        self.threshold = threshold
        for t in templates_data:
            img_bytes = base64.b64decode(t['data'])
            nparr = np.frombuffer(img_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is not None:
                h, w = img.shape[:2]
                master_scale = int(t.get('scale', 100))
                scales = [90, 100, 110, 125, 150, 175, 200] if target_scale == 'all' else [int(target_scale)]
                for scale in scales:
                    ratio = scale / master_scale
                    sw, sh = round(w * ratio), round(h * ratio)
                    if sw < 4 or sh < 4:
                        continue
                    scaled = img if sw == w and sh == h else cv2.resize(
                        img, (sw, sh), interpolation=cv2.INTER_AREA if ratio < 1 else cv2.INTER_LINEAR
                    )
                    self.templates.append(Template(f"{t['name']}@{scale}%", scaled, sw, sh))
        return {"status": "ok", "templates_loaded": len(self.templates)}

    def detect(self, region):
        if self.sct is None:
            self.sct = mss.MSS()
        # Electron reports logical display coordinates. Map them to the
        # corresponding physical MSS monitor so DPI scaling is respected.
        displays = region.get('displays') or []
        display_index = max(0, min(int(region.get('displayIndex', 0)), len(displays) - 1)) if displays else 0
        display = displays[display_index] if displays else {
            'x': 0, 'y': 0, 'width': region['width'], 'height': region['height'], 'scaleFactor': 1
        }
        monitors = self.sct.monitors[1:]
        monitor = monitors[min(display_index, len(monitors) - 1)] if monitors else self.sct.monitors[0]
        scale = float(display.get('scaleFactor', 1)) or 1
        left = int(monitor['left'] + round((region['x'] - display['x']) * scale))
        top = int(monitor['top'] + round((region['y'] - display['y']) * scale))
        width = int(round(region['width'] * scale))
        height = int(round(region['height'] * scale))
        monitor = {"top": top, "left": left, "width": width, "height": height}
        try:
            screenshot = self.sct.grab(monitor)
            # Convert to numpy array (BGRA -> BGR)
            img = np.array(screenshot)
            img = img[:, :, :3]  # Drop alpha
        except Exception as e:
            return {"status": "error", "message": f"Capture failed: {e}"}

        matches = []
        for tpl in self.templates:
            if tpl.width > img.shape[1] or tpl.height > img.shape[0]:
                continue
            try:
                result = cv2.matchTemplate(img, tpl.img, cv2.TM_CCOEFF_NORMED)
                locations = np.where(result >= self.threshold)
                locations = list(zip(*locations[::-1]))  # (x, y)

                # Group overlapping rectangles (simple version)
                rectangles = []
                for (x, y) in locations:
                    rectangles.append([int(x), int(y), tpl.width, tpl.height])
                    rectangles.append([int(x), int(y), tpl.width, tpl.height])  # Duplicate for groupRectangles

                if rectangles:
                    rectangles, _ = cv2.groupRectangles(
                        rectangles, groupThreshold=1, eps=0.5
                    )
                    for (x, y, w, h) in rectangles:
                        # Get the best score for this grouped rectangle
                        score = float(result[y:y+h, x:x+w].max())
                        matches.append({
                            "name": tpl.name,
                            "score": round(score, 4),
                            "x": x,
                            "y": y,
                            "w": w,
                            "h": h
                        })
            except Exception as e:
                continue

        # Sort by score descending
        matches.sort(key=lambda m: m['score'], reverse=True)
        return {"status": "ok", "matches": matches}

def main():
    detector = Detector()
    print(json.dumps({"ready": True, "status": "ok"}), flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            print(json.dumps({"status": "error", "message": "Invalid JSON"}), flush=True)
            continue

        cmd = msg.get('cmd')
        if cmd == 'load_templates':
            result = detector.load_templates(msg.get('templates', []), msg.get('threshold', 0.6), msg.get('scale', '100'))
        elif cmd == 'detect':
            result = detector.detect(msg.get('region', {}))
        elif cmd == 'ping':
            result = {"status": "ok", "pong": True}
        else:
            result = {"status": "error", "message": f"Unknown command: {cmd}"}

        result['request_id'] = msg.get('request_id')
        result['status'] = result.get('status', 'ok')
        print(json.dumps(result), flush=True)

if __name__ == '__main__':
    main()
