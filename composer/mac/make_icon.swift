// Draws the Crosslink Composer icon into an .iconset folder (build.sh turns it into AppIcon.icns).
// A white newspaper-crossword square on an Aqua-blue tile, with one answer lit up as a link.
import AppKit

let out = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "AppIcon.iconset")
try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

func draw(size: CGFloat) -> NSBitmapImageRep {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size), bitsPerSample: 8,
                               samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let s = size / 1024
    let ink = NSColor(red: 0.043, green: 0.043, blue: 0.043, alpha: 1)

    // Aqua tile with the site's shimmer blues
    let tile = NSRect(x: 100 * s, y: 100 * s, width: 824 * s, height: 824 * s)
    let tilePath = NSBezierPath(roundedRect: tile, xRadius: 185 * s, yRadius: 185 * s)
    NSGradient(colors: [NSColor(red: 0.05, green: 0.28, blue: 0.63, alpha: 1), NSColor(red: 0.26, green: 0.65, blue: 0.96, alpha: 1),
                        NSColor(red: 0.56, green: 0.88, blue: 0.94, alpha: 1)])!.draw(in: tilePath, angle: 60)
    // glossy top half, 2005 style
    NSGraphicsContext.saveGraphicsState()
    tilePath.addClip()
    NSGradient(colors: [NSColor(white: 1, alpha: 0.45), NSColor(white: 1, alpha: 0.05)])!
        .draw(in: NSBezierPath(ovalIn: NSRect(x: 40 * s, y: 520 * s, width: 944 * s, height: 560 * s)), angle: -90)
    NSGraphicsContext.restoreGraphicsState()

    // the printed grid
    let n = 5, cell = 112 * s
    let gx = 232 * s, gy = 232 * s
    let blocks: Set<Int> = [0, 24, 8, 16]
    let linked = Set([5, 6, 7, 8, 9]).subtracting(blocks)
    NSColor.white.setFill()
    NSRect(x: gx, y: gy, width: cell * CGFloat(n), height: cell * CGFloat(n)).fill()
    for i in 0..<(n * n) {
        let r = i / n, c = i % n
        let rect = NSRect(x: gx + CGFloat(c) * cell, y: gy + CGFloat(n - 1 - r) * cell, width: cell, height: cell)
        if blocks.contains(i) { ink.setFill(); rect.fill() }
        else if linked.contains(i) {
            NSColor(red: 0.16, green: 0.38, blue: 0.96, alpha: 1).setFill()
            NSRect(x: rect.minX + 16 * s, y: rect.minY + 16 * s, width: rect.width - 32 * s, height: 12 * s).fill()
        }
    }
    ink.setStroke()
    for i in 0...n {
        let p = NSBezierPath(); p.lineWidth = (i == 0 || i == n ? 14 : 5) * s
        p.move(to: NSPoint(x: gx + CGFloat(i) * cell, y: gy)); p.line(to: NSPoint(x: gx + CGFloat(i) * cell, y: gy + cell * CGFloat(n))); p.stroke()
        let q = NSBezierPath(); q.lineWidth = p.lineWidth
        q.move(to: NSPoint(x: gx, y: gy + CGFloat(i) * cell)); q.line(to: NSPoint(x: gx + cell * CGFloat(n), y: gy + CGFloat(i) * cell)); q.stroke()
    }
    // a little ink letter in the linked row
    let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.boldSystemFont(ofSize: 78 * s), .foregroundColor: NSColor(red: 0.16, green: 0.38, blue: 0.96, alpha: 1)]
    for (i, ch) in ["L", "I", "N"].enumerated() {
        let str = NSAttributedString(string: ch, attributes: attrs)
        let sz = str.size()
        let x = gx + CGFloat(i) * cell + (cell - sz.width) / 2, y = gy + 3 * cell + (cell - sz.height) / 2 + 6 * s
        str.draw(at: NSPoint(x: x, y: y))
    }
    NSGraphicsContext.restoreGraphicsState()
    return rep
}

for (name, px) in [("16x16", 16), ("16x16@2x", 32), ("32x32", 32), ("32x32@2x", 64), ("128x128", 128), ("128x128@2x", 256),
                   ("256x256", 256), ("256x256@2x", 512), ("512x512", 512), ("512x512@2x", 1024)] {
    let png = draw(size: CGFloat(px)).representation(using: .png, properties: [:])!
    try! png.write(to: out.appendingPathComponent("icon_\(name).png"))
}
print("wrote \(out.path)")
