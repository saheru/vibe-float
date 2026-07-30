import AppKit
import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var codex: CodexService

    var body: some View {
        GeometryReader { geometry in
            // 留出安全边距，避免无标题栏窗口在缩小时裁掉最右侧用量卡片。
            let scale = min(geometry.size.width / 800, geometry.size.height / 220)
            ZStack(alignment: .bottomTrailing) {
                panel
                    .frame(width: 650, height: 180)
                    .scaleEffect(scale)
                    .frame(width: 650 * scale, height: 180 * scale)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                ResizeHandle()
                    .frame(width: 30, height: 30)
                    .padding(5)
                    .help("拖动这里调整大小")
            }
        }
        .frame(minWidth: 390, idealWidth: 520, minHeight: 108, idealHeight: 144)
        .background(WindowConfigurator())
        .onAppear { codex.start() }
    }

    private var panel: some View {
        HStack(spacing: 10) {
            ForEach(0..<3, id: \.self) { index in
                if index < codex.tasks.count {
                    TaskTile(task: codex.tasks[index], index: index) {
                        codex.openTask(codex.tasks[index])
                    }
                } else {
                    EmptyTaskTile(index: index)
                }
            }

            EffortTile(effort: codex.solEffort, connected: codex.connected) {
                codex.cycleSolEffort()
            }

            UsageTile(usage: codex.weeklyUsage, connected: codex.connected)
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(.ultraThinMaterial)
                .overlay(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .stroke(Color.white.opacity(0.13), lineWidth: 1)
                )
                .shadow(color: .black.opacity(0.38), radius: 24, y: 10)
        )
        .padding(20)
        .contextMenu {
            Button("立即刷新") { codex.refresh() }
            Divider()
            Button("退出 Codex Float") { NSApplication.shared.terminate(nil) }
        }
    }
}

private struct TaskTile: View {
    let task: CodexTask
    let index: Int
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            TileShell(accent: task.state.color, hovering: hovering) {
                ZStack(alignment: .topTrailing) {
                    VStack(spacing: 7) {
                        StatusIcon(state: task.state)
                        Text(task.state.label)
                            .font(.system(size: 19, weight: .black, design: .rounded))
                            .foregroundStyle(.white)
                        Text(task.projectCode)
                            .font(.system(size: 17, weight: .black, design: .rounded))
                            .tracking(1)
                            .foregroundStyle(task.state.color)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    Text("#\(index + 1)")
                        .font(.system(size: 9, weight: .bold, design: .rounded))
                        .foregroundStyle(task.state.color.opacity(0.8))
                        .padding(8)
                }
            }
        }
        .buttonStyle(.plain)
        .help(task.title)
        .onHover { hovering = $0 }
    }
}

private struct EmptyTaskTile: View {
    let index: Int
    var body: some View {
        TileShell(accent: Color.gray, hovering: false) {
            VStack(spacing: 10) {
                Image(systemName: "circle")
                    .font(.system(size: 30, weight: .bold))
                    .foregroundStyle(.gray)
                Text("空闲")
                    .font(.system(size: 19, weight: .black, design: .rounded))
                    .foregroundStyle(.white)
                Text("#\(index + 1)")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.gray)
            }
        }
    }
}

private struct StatusIcon: View {
    let state: TaskState
    var body: some View {
        ZStack {
            Circle()
                .fill(state.color.opacity(0.16))
                .overlay(Circle().stroke(state.color, lineWidth: 3))
                .shadow(color: state.color.opacity(0.6), radius: 7)
            Image(systemName: state.symbol)
                .font(.system(size: 25, weight: .black))
                .foregroundStyle(state.color)
        }
        .frame(width: 52, height: 52)
    }
}

private struct EffortTile: View {
    let effort: String
    let connected: Bool
    let action: () -> Void
    @State private var hovering = false

    var color: Color { Color.effort(effort) }

    var body: some View {
        Button(action: action) {
            TileShell(accent: color, hovering: hovering) {
                VStack(spacing: 11) {
                    Text("SOL")
                        .font(.system(size: 25, weight: .black, design: .rounded))
                        .foregroundStyle(.white)
                    Text(connected ? effort.uppercased() : "离线")
                        .font(.system(size: effort.count > 6 ? 15 : 18, weight: .black, design: .rounded))
                        .foregroundStyle(color)
                        .padding(.horizontal, 10)
                        .frame(height: 33)
                        .background(color.opacity(0.16), in: Capsule())
                        .overlay(Capsule().stroke(color.opacity(0.9), lineWidth: 1.5))
                    Text("点击切换")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(.secondary)
                }
            }
        }
        .buttonStyle(.plain)
        .help("切换 Sol 推理强度")
        .onHover { hovering = $0 }
    }
}

private struct UsageTile: View {
    let usage: UsageWindow?
    let connected: Bool

    private var percent: Double { usage?.usedPercent ?? 0 }
    private var color: Color {
        percent >= 90 ? .red : percent >= 70 ? .orange : Color(red: 0.33, green: 0.84, blue: 0.54)
    }

    var body: some View {
        TileShell(accent: color, hovering: false) {
            VStack(spacing: 5) {
                Text("周")
                    .font(.system(size: 15, weight: .black, design: .rounded))
                    .foregroundStyle(.white.opacity(0.85))
                ZStack {
                    Circle()
                        .stroke(Color.white.opacity(0.1), lineWidth: 9)
                    Circle()
                        .trim(from: 0, to: min(1, percent / 100))
                        .stroke(color, style: StrokeStyle(lineWidth: 9, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .shadow(color: color.opacity(0.65), radius: 5)
                    Text(usage == nil ? (connected ? "N/A" : "离线") : "\(Int(percent.rounded()))%")
                        .font(.system(size: usage == nil ? 15 : 20, weight: .black, design: .rounded))
                        .foregroundStyle(.white)
                }
                .frame(width: 72, height: 72)
            }
        }
    }
}

private struct TileShell<Content: View>: View {
    let accent: Color
    let hovering: Bool
    @ViewBuilder let content: Content

    var body: some View {
        content
            .frame(width: 108, height: 120)
            .background(
                LinearGradient(
                    colors: [
                        Color(red: 0.09, green: 0.13, blue: 0.20),
                        Color(red: 0.03, green: 0.05, blue: 0.08)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ),
                in: RoundedRectangle(cornerRadius: 18, style: .continuous)
            )
            .overlay(alignment: .top) {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .trim(from: 0.02, to: 0.49)
                    .stroke(accent.opacity(0.8), lineWidth: 2)
            }
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(Color.white.opacity(hovering ? 0.25 : 0.08), lineWidth: 1)
            )
            .scaleEffect(hovering ? 1.025 : 1)
            .animation(.easeOut(duration: 0.15), value: hovering)
    }
}

private struct WindowConfigurator: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        DispatchQueue.main.async { configure(view.window) }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        DispatchQueue.main.async { configure(nsView.window) }
    }

    private func configure(_ window: NSWindow?) {
        guard let window else { return }
        window.level = .floating
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        window.isMovableByWindowBackground = true
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.standardWindowButton(.closeButton)?.isHidden = true
        window.standardWindowButton(.miniaturizeButton)?.isHidden = true
        window.standardWindowButton(.zoomButton)?.isHidden = true
        window.styleMask.insert(.resizable)
        window.minSize = NSSize(width: 390, height: 140)
        window.backgroundColor = .clear
        window.isOpaque = false
        window.hasShadow = false
    }
}

private struct ResizeHandle: NSViewRepresentable {
    func makeNSView(context: Context) -> ResizeHandleView {
        ResizeHandleView()
    }

    func updateNSView(_ nsView: ResizeHandleView, context: Context) {}
}

private final class ResizeHandleView: NSView {
    private var initialMouse = NSPoint.zero
    private var initialFrame = NSRect.zero

    override var acceptsFirstResponder: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        let badge = NSBezierPath(roundedRect: bounds.insetBy(dx: 2, dy: 2), xRadius: 8, yRadius: 8)
        NSColor.black.withAlphaComponent(0.55).setFill()
        badge.fill()

        NSColor.white.withAlphaComponent(0.9).setStroke()
        for offset in stride(from: CGFloat(7), through: 19, by: 6) {
            let line = NSBezierPath()
            line.lineWidth = 2
            line.lineCapStyle = .round
            line.move(to: NSPoint(x: bounds.maxX - offset, y: 5))
            line.line(to: NSPoint(x: bounds.maxX - 5, y: offset))
            line.stroke()
        }
    }

    override func resetCursorRects() {
        addCursorRect(bounds, cursor: .crosshair)
    }

    override func mouseDown(with event: NSEvent) {
        guard let window else { return }
        initialFrame = window.frame
        initialMouse = window.convertPoint(toScreen: event.locationInWindow)
    }

    override func mouseDragged(with event: NSEvent) {
        guard let window else { return }
        let mouse = window.convertPoint(toScreen: event.locationInWindow)
        let width = max(390, initialFrame.width + mouse.x - initialMouse.x)
        let height = max(140, initialFrame.height - mouse.y + initialMouse.y)
        let frame = NSRect(
            x: initialFrame.minX,
            y: initialFrame.maxY - height,
            width: width,
            height: height
        )
        window.setFrame(frame, display: true)
    }
}
