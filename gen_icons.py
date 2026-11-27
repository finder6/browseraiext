#!/usr/bin/env python3
# 生成扩展图标：放大镜盾牌风格（纯 Python，无第三方依赖）
import struct, zlib, os

def clamp(v):
    return 0 if v < 0 else (255 if v > 255 else int(v))

def make_icon(size):
    px = bytearray()
    for y in range(size):
        px.append(0)  # filter byte
        for x in range(size):
            fx, fy = x / size, y / size
            # 圆角矩形背景（对角渐变 蓝->紫）
            r = 0.16
            cx = min(max(fx, r), 1 - r)
            cy = min(max(fy, r), 1 - r)
            inside = ((fx - cx) ** 2 + (fy - cy) ** 2) ** 0.5 <= r
            t = (fx + fy) / 2
            br, bg, bb = int(79 + (124 - 79) * t), int(110 + (92 - 110) * t), int(247 + (240 - 247) * t)
            # 白色放大镜：圆环 + 手柄
            mx, my, mr, mw = 0.42, 0.40, 0.20, 0.075
            d = ((fx - mx) ** 2 + (fy - my) ** 2) ** 0.5
            ring = abs(d - mr) <= mw / 2 and d <= mr + mw
            # 手柄：线段 (0.56,0.54)->(0.78,0.76)
            def dist_seg(pxa, pya, pxb, pyb, pxp, pyp):
                apx, apy = pxp - pxa, pyp - pya
                bpx, bpy = pxb - pxa, pyb - pya
                ab = apx * bpx + apy * bpy
                bb2 = bpx * bpx + bpy * bpy
                tt = 0 if bb2 == 0 else max(0, min(1, ab / bb2))
                dx, dy = pxp - (pxa + tt * bpx), pyp - (pya + tt * bpy)
                return (dx * dx + dy * dy) ** 0.5
            handle = dist_seg(0.56, 0.54, 0.78, 0.76, fx, fy) <= 0.045
            if inside and (ring or handle):
                px += bytes((255, 255, 255, 255))
            elif inside:
                px += bytes((br, bg, bb, 255))
            else:
                px += bytes((0, 0, 0, 0))
    raw = bytes(px)
    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c))
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    return png

out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'extension', 'icons')
os.makedirs(out_dir, exist_ok=True)
for s in (16, 48, 128):
    with open(os.path.join(out_dir, f'icon{s}.png'), 'wb') as f:
        f.write(make_icon(s))
    print(f'icon{s}.png OK')
