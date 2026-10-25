#!/usr/bin/env python3
"""
EVE-Alert style detector for MIL Local Monitor.
Uses mss for region capture and OpenCV for template matching.
Communicates via JSON lines on stdin/stdout.
"""

import sys
import json
import base64
import time

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
        # When the app asks for "auto", no single scale fits every machine:
        # the same 200%-captured master is 12x7 at 90% and 26x15 at 200%,
        # and the right one is whatever the EVE client is actually rendering at.
        # Auto measures which one keeps the same contact in the same place
        # across two captures and uses it from then on.
        self.auto_scale = None

    def load_templates(self, templates_data, threshold, target_scale):
        self.templates = []
        self.templates_by_scale = {}
        self.threshold = threshold
        self.target_scale = target_scale
        self.auto_scale = None
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
                    tpl = Template(f"{t['name']}@{scale}%", scaled, sw, sh)
                    self.templates.append(tpl)
                    self.templates_by_scale.setdefault(scale, []).append(tpl)
        return {"status": "ok", "templates_loaded": len(self.templates)}

    def capture(self, region):
        """Grab the region in logical display pixels.

        mss hands back physical pixels, so the capture is scaled down to the
        logical size the app asked for. Every template and every preview and
        snapshot lives in that same space, and leaving the detector on the
        physical frame made it see a 1.25x image that no scale variant matched
        while the preview still reported hits - the two paths were looking at
        different pixels.
        """
        if self.sct is None:
            self.sct = mss.MSS()
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
        screenshot = self.sct.grab(monitor)
        img = np.array(screenshot)
        img = img[:, :, :3]  # Drop alpha
        if width and height and (img.shape[1] != width or img.shape[0] != height):
            img = cv2.resize(img, (width, height), interpolation=cv2.INTER_AREA)
        return img

    def detect(self, region):
        self.last_region = region
        try:
            img = self.capture(region)
        except Exception as e:
            return {"status": "error", "message": f"Capture failed: {e}"}

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        frame_mean, frame_stddev = cv2.meanStdDev(gray)
        frame_mean = float(frame_mean[0][0])
        frame_stddev = float(frame_stddev[0][0])

        # "auto" calibrates once: a wrong scale scatters noise, the right one
        # keeps the same contact in the same place between captures. The first
        # two captures score every scale and remember the winner; after that
        # only that scale is matched, so the calibration cost is paid once.
        if self.target_scale == 'all' and self.auto_scale is None:
            self.auto_scale = self.calibrate(img)
        if self.auto_scale is not None:
            active = self.templates_by_scale.get(self.auto_scale, [])
        else:
            active = self.templates

        matches = self.match_image(img, active)

        # Sort by score descending
        matches.sort(key=lambda m: m['score'], reverse=True)
        return {
            "status": "ok",
            "matches": matches,
            "frame_mean": frame_mean,
            "frame_stddev": frame_stddev,
        }

    def calibrate(self, img):
        """Pick the interface scale whose hits are stable between captures.

        Every scale variant is scored against this frame and the next one. The
        winner is the scale that moves the least between them: real contacts
        stay put, while a wrong scale is just noise scattered across the
        correlation map, so its hits land in different places each time.
        """
        scores = {}
        for scale, templates in self.templates_by_scale.items():
            hits = []
            for t in self.match_image(img, templates):
                hits.append((t['x'], t['y']))
            scores[scale] = hits
        if not scores:
            return None
        # A second capture settles the noise question.
        time.sleep(0.15)
        try:
            next_img = self.capture(region=self.last_region) if getattr(self, 'last_region', None) else None
        except Exception:
            next_img = None
        if next_img is None:
            return max(scores, key=lambda s: len(scores[s]))
        stable = {}
        for scale, hits in scores.items():
            nxt = [(t['x'], t['y']) for t in self.match_image(next_img, self.templates_by_scale.get(scale, []))]
            keep = 0
            for x, y in hits:
                if any(abs(x - nx) <= 3 and abs(y - ny) <= 3 for nx, ny in nxt):
                    keep += 1
            stable[scale] = keep
        winner = max(stable, key=lambda s: (stable[s], len(scores[s])))
        return winner

    def match_image(self, img, templates=None):
        """Slide every template across the image and group the hits.

        OpenCV 5 removed cv2.groupRectangles, so the old call lived inside a
        broad except and that version silently dropped every valid template hit
        - Local Monitor never alarmed even though the preview showed matches.
        Connected components over the threshold map do the same grouping, and
        the strongest score is kept per component.
        """
        matches = []
        for tpl in (templates if templates is not None else self.templates):
            if tpl.width > img.shape[1] or tpl.height > img.shape[0]:
                continue
            try:
                result = cv2.matchTemplate(img, tpl.img, cv2.TM_CCOEFF_NORMED)
                threshold_map = (result >= self.threshold).astype(np.uint8)
                count, labels, _, _ = cv2.connectedComponentsWithStats(
                    threshold_map, connectivity=8
                )
                if count > 1:
                    flat_labels = labels.reshape(-1)
                    flat_scores = result.reshape(-1)
                    best_scores = np.full(count, -np.inf, dtype=np.float32)
                    best_indexes = np.full(count, flat_scores.size, dtype=np.int64)
                    valid = flat_labels > 0
                    np.maximum.at(best_scores, flat_labels[valid], flat_scores[valid])
                    candidate_indexes = np.flatnonzero(
                        valid & (flat_scores == best_scores[flat_labels])
                    )
                    # Keep the first (smallest) candidate index in each
                    # component. minimum.at needs a large sentinel, not -1:
                    # min(-1, index) is -1, which silently dropped every hit.
                    np.minimum.at(
                        best_indexes,
                        flat_labels[candidate_indexes],
                        candidate_indexes,
                    )
                    for label in range(1, count):
                        index = int(best_indexes[label])
                        if index >= flat_scores.size:
                            continue
                        y, x = divmod(index, result.shape[1])
                        matches.append({
                            "name": tpl.name,
                            "score": round(float(best_scores[label]), 4),
                            "x": int(x),
                            "y": int(y),
                            "w": tpl.width,
                            "h": tpl.height
                        })
            except Exception as e:
                return {
                    "status": "error",
                    "message": f"Template match failed for {tpl.name}: {e}"
                }
        return matches

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
