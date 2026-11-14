"""Regenerate tests/fixtures/marker.y4m (the fake-camera video used by tests/browser_phase3.py).

640x480, dark-green background, a 90x90 magenta square whose centre is at x=0.2, y=0.5 of the RAW frame
(i.e. on the LEFT). Because the game mirrors its preview, the square must appear on the RIGHT of the panel.
"""
import os
W, H, N, S, CX, CY = 640, 480, 8, 90, 128, 240
def yuv(r, g, b):
    return (int(0.257*r + 0.504*g + 0.098*b + 16), int(-0.148*r - 0.291*g + 0.439*b + 128), int(0.439*r - 0.368*g - 0.071*b + 128))
bg, mk = yuv(10, 70, 20), yuv(255, 0, 255)
out = bytearray(b"YUV4MPEG2 W%d H%d F30:1 Ip A1:1 C420jpeg\n" % (W, H))
for _ in range(N):
    Y = bytearray([bg[0]]) * (W*H); U = bytearray([bg[1]]) * (W*H//4); V = bytearray([bg[2]]) * (W*H//4)
    x0, x1, y0, y1 = CX - S//2, CX + S//2, CY - S//2, CY + S//2
    for y in range(y0, y1):
        Y[y*W + x0: y*W + x1] = bytes([mk[0]]) * (x1 - x0)
    for y in range(y0//2, y1//2):
        U[y*(W//2) + x0//2: y*(W//2) + x1//2] = bytes([mk[1]]) * ((x1 - x0)//2)
        V[y*(W//2) + x0//2: y*(W//2) + x1//2] = bytes([mk[2]]) * ((x1 - x0)//2)
    out += b"FRAME\n" + Y + U + V
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "marker.y4m")
open(path, "wb").write(out)
print("wrote", path)
