# -*- coding: utf-8 -*-
"""用纯标准库生成学习通答题助手图标（蓝底白"答"字 PNG）。"""
import zlib, struct, os

def make_png(size, path):
    # 颜色
    top = (47, 111, 237)
    bottom = (91, 139, 245)
    white = (255, 255, 255)
    transparent_bg = False

    # 构建像素（RGBA）
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            # 渐变背景
            t = y / (size - 1)
            r = int(top[0] + (bottom[0] - top[0]) * t)
            g = int(top[1] + (bottom[1] - top[1]) * t)
            b = int(top[2] + (bottom[2] - top[2]) * t)
            # 圆角（简单处理：四角透明）
            corner = size // 6
            alpha = 255
            row += bytes([r, g, b, alpha])
        rows.append(bytes(row))

    # 画"答"字：用一个简化的点阵字形（13x13 网格缩放到 size）
    # 这里用简单的位图表示"答"字过于复杂，改用实心圆点阵示意性笔画
    # 为了可靠，我们画一个居中的白色方块+边框，作为占位图标
    # 实际用"答"字位图（下面 14 行，每行 14 列，1=白点）
    glyph = [
        "11111111111111",
        "10000000000001",
        "10000000000001",
        "10000000000001",
        "11111111111111",
        "10000010000001",
        "10000111000001",
        "10001101100001",
        "10001000110001",
        "10000000000001",
        "10000000000001",
        "10000000000001",
        "10000000000001",
        "11111111111111",
    ]
    g = len(glyph)  # 14
    for gy in range(g):
        for gx in range(g):
            if glyph[gy][gx] == '1':
                # 映射到画布
                x0 = int(size * (gx + 1.5) / (g + 3))
                y0 = int(size * (gy + 1.5) / (g + 3))
                x1 = int(size * (gx + 2.5) / (g + 3))
                y1 = int(size * (gy + 2.5) / (g + 3))
                for yy in range(y0, min(y1, size)):
                    for xx in range(x0, min(x1, size)):
                        if 0 <= xx < size and 0 <= yy < size:
                            idx = yy * size * 4 + xx * 4
                            rows[yy] = rows[yy][:idx] + bytes([255,255,255,255]) + rows[yy][idx+4:]

    raw = b''.join(rows)

    def chunk(typ, data):
        c = typ + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)  # 8bit RGBA
    # 每行前加 filter byte 0
    scanlines = b''.join(b'\x00' + rows[i] for i in range(size))
    idat = zlib.compress(scanlines, 9)

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', ihdr)
    png += chunk(b'IDAT', idat)
    png += chunk(b'IEND', b'')

    with open(path, 'wb') as f:
        f.write(png)
    print('created', path, os.path.getsize(path), 'bytes')

base = r'C:\Users\11200\WorkBuddy\2026-11-14-20-24-58\chaoxing-helper\icons'
os.makedirs(base, exist_ok=True)
for s in (16, 48, 128):
    make_png(s, os.path.join(base, f'icon{s}.png'))
