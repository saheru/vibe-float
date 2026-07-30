import Foundation

let input = FileHandle.standardInput.readDataToEndOfFile()
let cache = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Application Support/Vibe Float/claude-status.json")
try? FileManager.default.createDirectory(at: cache.deletingLastPathComponent(), withIntermediateDirectories: true)
try? input.write(to: cache, options: .atomic)

guard let index = CommandLine.arguments.firstIndex(of: "--next-base64"),
      CommandLine.arguments.indices.contains(index + 1),
      let commandData = Data(base64Encoded: CommandLine.arguments[index + 1]),
      let command = String(data: commandData, encoding: .utf8),
      !command.isEmpty else {
    exit(0)
}

let process = Process()
let pipeIn = Pipe()
let pipeOut = Pipe()
process.executableURL = URL(fileURLWithPath: "/bin/zsh")
process.arguments = ["-lc", command]
process.standardInput = pipeIn
process.standardOutput = pipeOut
process.standardError = FileHandle.standardError
try? process.run()
try? pipeIn.fileHandleForWriting.write(contentsOf: input)
try? pipeIn.fileHandleForWriting.close()
let output = pipeOut.fileHandleForReading.readDataToEndOfFile()
FileHandle.standardOutput.write(output)
process.waitUntilExit()
exit(process.terminationStatus)
