// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "CodexFloat",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "CodexFloat", targets: ["CodexFloat"]),
        .executable(name: "VibeFloatStatus", targets: ["VibeFloatStatus"])
    ],
    targets: [
        .executableTarget(
            name: "CodexFloat",
            path: "Sources/CodexFloat"
        ),
        .executableTarget(
            name: "VibeFloatStatus",
            path: "Sources/VibeFloatStatus"
        )
    ]
)
